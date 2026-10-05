/**
 * The opaque "surface" slot for paleo and schematic modes (satellite mode clears it so the
 * imagery underneath shows). Paleo snapshots are rendered in the worker, cached, and the
 * neighbouring snapshots are prefetched so playback rarely waits.
 */
import type { GlobeStyle, PaleoIndex, SchematicKind, Year } from '../types';
import type { LayerSlot } from './layerStack';
import type { RasterClient } from './rasterClient';
import { LruCache } from './lru';
import { LatestOnly } from './latestOnly';
import { FailureBackoff } from './backoff';
import { globalRasterSize } from './rasterSize';
import { dataUrl, fillTemplate, isPaleoIndex, loadDataJson, nearestIndex, yearToAgeMa } from './dataIndex';
import { DEFAULT_LAND, DEFAULT_OCEAN } from './palette';

/** A quick low-res texture is shown first; the full one replaces it about a second later. */
const SCHEMATIC_PREVIEW = { width: 512, height: 256 };
const SCHEMATIC_FULL = { width: 2048, height: 1024 };
/** Paleo bitmaps are large (up to ~34 MB): keep only the current snapshot and its two neighbours. */
const PALEO_CACHE_SIZE = 3;
/** A snapshot that failed to load is tried again after this long (not on every frame). */
const RETRY_MS = 5000;

interface PaleoJob {
  key: string;
  index: number;
  style: GlobeStyle;
}

export class SurfaceLayer {
  private index: PaleoIndex | null = null;
  private indexLoading = false;
  private readonly paleo: LruCache<string, ImageBitmap>;
  private readonly paleoPending = new Map<string, Promise<ImageBitmap | null>>();
  /** Key the latest update asked for (null outside paleo mode). */
  private wantedPaleo: string | null = null;
  private lastPaleoIndex = -1;
  private direction = 1;
  private readonly paleoLoader = new LatestOnly<PaleoJob>((job) => this.loadPaleo(job));
  private readonly paleoFailures = new FailureBackoff<string>(RETRY_MS);
  private readonly paleoSize = globalRasterSize();
  private readonly schematic = new Map<SchematicKind, { preview?: ImageBitmap; full?: ImageBitmap }>();
  private readonly schematicRequested = new Set<SchematicKind>();
  private last: { year: Year; style: GlobeStyle } | null = null;

  constructor(
    private readonly slot: LayerSlot,
    private readonly raster: RasterClient,
    isDisplaying: (b: ImageBitmap) => boolean,
  ) {
    // Free evicted bitmaps right away unless a layer still shows them (then GC takes them later).
    this.paleo = new LruCache(PALEO_CACHE_SIZE, (b) => { if (!isDisplaying(b)) b.close(); });
  }

  update(year: Year, style: GlobeStyle): void {
    this.last = { year, style };
    if (style.mode === 'paleo') return this.updatePaleo(year, style);
    this.wantedPaleo = null;
    this.paleoLoader.cancel();
    // Outside paleo mode the snapshots only hold memory; bitmaps still fading out are kept alive
    // by the eviction callback and collected later.
    this.paleo.clear();
    if (style.mode === 'schematic') this.updateSchematic(style.schematic ?? 'cratons');
    else this.slot.clear();
  }

  destroy(): void {
    this.paleoLoader.cancel();
    this.paleo.clear();
  }

  /** Re-applies the last update after something finished loading. */
  private refresh(): void {
    if (this.last) this.update(this.last.year, this.last.style);
  }

  private updateSchematic(kind: SchematicKind): void {
    const tex = this.schematic.get(kind);
    if (tex?.full) this.slot.show(`schematic:${kind}`, tex.full);
    else if (tex?.preview) this.slot.show(`schematic:${kind}:preview`, tex.preview);
    if (!this.schematicRequested.has(kind)) {
      // Requested once per session; if generation fails the base colour stands in.
      this.schematicRequested.add(kind);
      void this.loadSchematic(kind);
    }
  }

  private async loadSchematic(kind: SchematicKind): Promise<void> {
    const tex: { preview?: ImageBitmap; full?: ImageBitmap } = {};
    this.schematic.set(kind, tex);
    try {
      tex.preview = await this.raster.schematic(kind, SCHEMATIC_PREVIEW.width, SCHEMATIC_PREVIEW.height);
      this.refresh();
      tex.full = await this.raster.schematic(kind, SCHEMATIC_FULL.width, SCHEMATIC_FULL.height);
      delete tex.preview; // no longer needed; the GPU copy lives on until its layer fades out
      this.refresh();
    } catch (err) {
      console.warn(`[globe] could not generate the "${kind}" surface:`, err);
    }
  }

  private updatePaleo(year: Year, style: GlobeStyle): void {
    if (!this.index) {
      this.requestIndex();
      return;
    }
    const ages = this.index.agesMa;
    const index = nearestIndex(ages, yearToAgeMa(year));
    const key = this.paleoKey(ages[index], style);
    if (key === this.wantedPaleo) return; // still inside the same snapshot: nothing to do
    if (this.paleoFailures.blocked(key)) return; // keep the stand-in until the retry is due
    this.wantedPaleo = key;
    if (index !== this.lastPaleoIndex) this.direction = index > this.lastPaleoIndex ? 1 : -1;
    this.lastPaleoIndex = index;
    const cached = this.paleo.get(key);
    if (cached) {
      this.paleoLoader.cancel(); // a render queued for a snapshot playback has since left
      this.slot.show(key, cached);
      this.prefetch(index, style);
    } else {
      this.paleoLoader.push({ key, index, style });
    }
  }

  private async loadPaleo(job: PaleoJob): Promise<void> {
    const ages = this.index?.agesMa ?? [];
    const bitmap = await this.renderPaleo(ages[job.index], job.style);
    const wanted = this.wantedPaleo;
    if (!bitmap) {
      // Let a later update ask for it again (after the backoff) while the playhead stays here.
      this.paleoFailures.fail(job.key);
      if (wanted === job.key) this.wantedPaleo = null;
      return;
    }
    if (wanted === null) return; // no longer in paleo mode
    if (job.key === wanted) {
      this.slot.show(job.key, bitmap);
      this.prefetch(job.index, job.style);
    } else if (!this.paleo.has(wanted)) {
      // Playback moved on while this rendered: show it as the nearest available stand-in
      // until the wanted snapshot (already queued) arrives.
      this.slot.show(job.key, bitmap);
    }
  }

  /** Renders the snapshots on either side, the one in the direction of travel first. */
  private prefetch(i: number, style: GlobeStyle): void {
    const ages = this.index?.agesMa ?? [];
    for (const j of [i + this.direction, i - this.direction]) {
      if (j >= 0 && j < ages.length) void this.renderPaleo(ages[j], style);
    }
  }

  /** Missing data is retried by loadDataJson after a while; until then the globe shows its base colour. */
  private requestIndex(): void {
    if (this.indexLoading) return;
    this.indexLoading = true;
    void loadDataJson('paleo/index.json', isPaleoIndex).then((index) => {
      this.indexLoading = false;
      this.index = index;
      if (index) this.refresh();
    });
  }

  private paleoKey(age: number, style: GlobeStyle): string {
    const plates = style.plateBoundaries && this.index?.plateBoundaries ? 1 : 0;
    return `paleo:${age}|${style.landColor ?? DEFAULT_LAND}|${style.oceanColor ?? DEFAULT_OCEAN}|${plates}`;
  }

  /** Cached or in-flight render of one snapshot; resolves null on failure. */
  private renderPaleo(age: number, style: GlobeStyle): Promise<ImageBitmap | null> {
    const index = this.index;
    if (!index) return Promise.resolve(null);
    const key = this.paleoKey(age, style);
    const cached = this.paleo.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = this.paleoPending.get(key);
    if (pending) return pending;
    const platesTemplate = style.plateBoundaries ? index.plateBoundaries : undefined;
    const job = this.raster
      .bitmap({
        type: 'paleo',
        coastlinesUrl: dataUrl(fillTemplate(index.coastlines, 'age', age)),
        platesUrl: platesTemplate ? dataUrl(fillTemplate(platesTemplate, 'age', age)) : undefined,
        landColor: style.landColor ?? DEFAULT_LAND,
        oceanColor: style.oceanColor ?? DEFAULT_OCEAN,
        ...this.paleoSize,
      })
      .then(({ bitmap }) => {
        this.paleo.set(key, bitmap);
        return bitmap;
      })
      .catch((err: unknown) => {
        console.warn(`[globe] paleo snapshot ${age} Ma unavailable:`, err instanceof Error ? err.message : err);
        return null;
      })
      .finally(() => this.paleoPending.delete(key));
    this.paleoPending.set(key, job);
    return job;
  }
}
