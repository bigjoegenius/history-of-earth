/**
 * Historical political borders: a translucent raster slot for the nearest snapshot at or before
 * the current year, plus a LabelCollection naming the largest polities.
 */
import * as Cesium from 'cesium';
import type { BordersIndex, Year } from '../types';
import type { LayerSlot } from './layerStack';
import type { BorderLabel, RasterClient } from './rasterClient';
import { LruCache } from './lru';
import { LatestOnly } from './latestOnly';
import { FailureBackoff } from './backoff';
import { globalRasterSize } from './rasterSize';
import { dataUrl, fillTemplate, isBordersIndex, loadDataJson, snapshotAtOrBefore } from './dataIndex';

/**
 * Label candidates per snapshot, largest polities first. Distance-based decluttering (see
 * labelRange) shows only the ~60 largest from orbit; smaller ones appear as the camera nears.
 */
const MAX_LABELS = 150;
const CACHE_SIZE = 4;
/** A snapshot that failed to load is tried again after this long (not on every frame). */
const RETRY_MS = 5000;

interface Snapshot {
  bitmap: ImageBitmap;
  labels: BorderLabel[];
}

export class BordersLayer {
  private index: BordersIndex | null = null;
  private indexLoading = false;
  private readonly cache: LruCache<Year, Snapshot>;
  private wanted: Year | null = null;
  private readonly loader = new LatestOnly<Year>((snap) => this.load(snap));
  private readonly failures = new FailureBackoff<Year>(RETRY_MS);
  private readonly size = globalRasterSize();
  private readonly labels: Cesium.LabelCollection;
  private labelsFor: Year | null = null;
  private last: { year: Year; enabled: boolean; showLabels: boolean } | null = null;

  constructor(
    private readonly scene: Cesium.Scene,
    private readonly slot: LayerSlot,
    private readonly raster: RasterClient,
    isDisplaying: (b: ImageBitmap) => boolean,
  ) {
    this.cache = new LruCache(CACHE_SIZE, (s) => { if (!isDisplaying(s.bitmap)) s.bitmap.close(); });
    this.labels = scene.primitives.add(new Cesium.LabelCollection()) as Cesium.LabelCollection;
  }

  update(year: Year, enabled: boolean, showLabels: boolean): void {
    this.last = { year, enabled, showLabels };
    this.labels.show = enabled && showLabels;
    if (!enabled) return this.hide();
    if (!this.index) return this.requestIndex();
    const snap = snapshotAtOrBefore(this.index.years, year);
    if (snap === null) return this.hide();
    if (snap === this.wanted) return; // same snapshot: nothing to reload
    if (this.failures.blocked(snap)) return; // keep the stand-in until the retry is due
    this.wanted = snap;
    const cached = this.cache.get(snap);
    if (cached) {
      this.loader.cancel();
      this.display(snap, cached);
    } else {
      this.loader.push(snap);
    }
  }

  destroy(): void {
    this.loader.cancel();
    this.cache.clear();
    this.scene.primitives.remove(this.labels);
  }

  private hide(): void {
    this.wanted = null;
    this.loader.cancel();
    this.slot.clear();
    this.setLabels(null, []);
    // Borders are off or not drawn this far back: free the snapshots (a bitmap still fading out
    // is kept alive by the eviction callback).
    this.cache.clear();
  }

  private display(snap: Year, s: Snapshot): void {
    this.slot.show(`borders:${snap}`, s.bitmap);
    this.setLabels(snap, s.labels);
  }

  /** Renders one snapshot; shows it if still wanted, or as a stand-in until the wanted one lands. */
  private async load(snap: Year): Promise<void> {
    const index = this.index;
    if (!index) return;
    try {
      const { bitmap, labels = [] } = await this.raster.bitmap({
        type: 'borders', url: dataUrl(fillTemplate(index.file, 'year', snap)), maxLabels: MAX_LABELS, ...this.size,
      });
      const s = { bitmap, labels };
      this.cache.set(snap, s);
      if (this.wanted !== null && (this.wanted === snap || !this.cache.has(this.wanted))) this.display(snap, s);
    } catch (err) {
      console.warn(`[globe] borders for ${snap} unavailable:`, err instanceof Error ? err.message : err);
      this.failures.fail(snap);
      if (this.wanted === snap) this.wanted = null; // asked for again once the backoff expires
    }
  }

  /** Missing data is retried by loadDataJson after a while. */
  private requestIndex(): void {
    if (this.indexLoading) return;
    this.indexLoading = true;
    void loadDataJson('borders/index.json', isBordersIndex).then((index) => {
      this.indexLoading = false;
      this.index = index;
      if (index && this.last) this.update(this.last.year, this.last.enabled, this.last.showLabels);
    });
  }

  private setLabels(snap: Year | null, labels: BorderLabel[]): void {
    if (snap === this.labelsFor) return;
    this.labelsFor = snap;
    this.labels.removeAll();
    for (const l of labels) {
      this.labels.add({
        position: Cesium.Cartesian3.fromDegrees(l.lon, l.lat),
        text: l.name,
        font: '600 12px sans-serif',
        fillColor: Cesium.Color.WHITE.withAlpha(0.92),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.8),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        scaleByDistance: new Cesium.NearFarScalar(2e6, 1.1, 2.5e7, 0.75),
        // Declutter: small polities are only named once the camera is close enough.
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, labelRange(l.area)),
      });
    }
    this.scene.requestRender();
  }
}

/** Camera distance (m) up to which a polity of `area` square degrees keeps its label. */
function labelRange(area: number): number {
  return Math.min(4e7, Math.max(3e6, Math.sqrt(area) * 1.1e6));
}
