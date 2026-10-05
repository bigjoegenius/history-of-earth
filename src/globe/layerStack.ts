/**
 * Cross-fading raster overlays. The globe stacks a few logical "slots" (surface, ice, borders)
 * above the satellite imagery; each slot shows one bitmap at a time and cross-fades to the next.
 */
import * as Cesium from 'cesium';
import { BitmapImageryProvider } from './bitmapProvider';
import { tween } from './tween';

const FADE_MS = 400;
/** Layers allowed in one slot at once (the incoming one plus leftovers of interrupted fades). */
const MAX_LAYERS_PER_SLOT = 3;

interface Entry {
  key: string;
  layer: Cesium.ImageryLayer;
  bitmap: ImageBitmap;
}

export class LayerStack {
  private readonly slots: LayerSlot[] = [];

  constructor(
    readonly layers: Cesium.ImageryLayerCollection,
    readonly requestRender: () => void,
    /** Layers that always stay below every slot (satellite imagery). */
    private readonly baseLayers: Cesium.ImageryLayer[],
  ) {}

  /** Adds a slot drawn above all previously added slots. */
  addSlot(opts: { fadeOutUnder: boolean }): LayerSlot {
    const slot = new LayerSlot(this, opts.fadeOutUnder);
    this.slots.push(slot);
    return slot;
  }

  /** Collection index for a new top layer of `slot`: above its own layers and all lower slots. */
  insertIndex(slot: LayerSlot): number {
    for (let i = this.slots.indexOf(slot); i >= 0; i--) {
      const top = this.slots[i].topLayer();
      if (top) return this.layers.indexOf(top) + 1;
    }
    return Math.max(0, ...this.baseLayers.map((l) => this.layers.indexOf(l) + 1));
  }

  /** True while any slot still displays (or is about to display) this bitmap. */
  isDisplaying(bitmap: ImageBitmap): boolean {
    return this.slots.some((s) => s.uses(bitmap));
  }

  destroy(): void {
    for (const s of this.slots) s.destroy();
  }
}

export class LayerSlot {
  /** Bottom → top. The top entry is the one being shown (or fading in). */
  private entries: Entry[] = [];
  /** Key of the bitmap this slot is showing or about to show; null when cleared. */
  private target: string | null = null;
  private queued: { key: string; bitmap: ImageBitmap } | null = null;
  private stopTween: (() => void) | null = null;
  private clearing = false;

  constructor(
    private readonly stack: LayerStack,
    /** Overlays with transparency fade the old layer out; opaque surfaces just cover it. */
    private readonly fadeOutUnder: boolean,
  ) {}

  topLayer(): Cesium.ImageryLayer | undefined {
    return this.entries[this.entries.length - 1]?.layer;
  }

  uses(bitmap: ImageBitmap): boolean {
    return this.queued?.bitmap === bitmap || this.entries.some((e) => e.bitmap === bitmap);
  }

  /**
   * Cross-fades to `bitmap`. While a fade is running the request is queued (latest wins), which
   * rate-limits texture uploads when the caller changes snapshots every frame.
   */
  show(key: string, bitmap: ImageBitmap): void {
    if (key === this.target) return;
    this.target = key;
    if (!this.clearing && this.entries[this.entries.length - 1]?.key === key) {
      this.queued = null; // back to the layer that is already fading in
      return;
    }
    if (this.stopTween && !this.clearing) {
      this.queued = { key, bitmap };
      return;
    }
    this.start(key, bitmap);
  }

  /** Fades everything out and removes it. */
  clear(): void {
    this.target = null;
    this.queued = null;
    if (this.entries.length === 0 || this.clearing) return;
    this.stopTween?.();
    this.clearing = true;
    const fading = this.entries.map((e) => ({ e, from: e.layer.alpha }));
    this.stopTween = tween(
      FADE_MS,
      (t) => {
        for (const { e, from } of fading) e.layer.alpha = from * (1 - t);
        this.stack.requestRender();
      },
      () => {
        this.stopTween = null;
        this.clearing = false;
        for (const { e } of fading) this.remove(e);
      },
    );
  }

  destroy(): void {
    this.stopTween?.();
    this.stopTween = null;
    this.queued = null;
    for (const e of [...this.entries]) this.remove(e);
  }

  private start(key: string, bitmap: ImageBitmap): void {
    this.stopTween?.();
    this.clearing = false;
    const layer = new Cesium.ImageryLayer(new BitmapImageryProvider(bitmap), { alpha: 0 });
    this.stack.layers.add(layer, this.stack.insertIndex(this));
    const entry: Entry = { key, layer, bitmap };
    this.entries.push(entry);
    while (this.entries.length > MAX_LAYERS_PER_SLOT) this.remove(this.entries[0]);
    const under = this.entries.slice(0, -1).map((e) => ({ e, from: e.layer.alpha }));
    this.stopTween = tween(
      FADE_MS,
      (t) => {
        layer.alpha = t;
        if (this.fadeOutUnder) for (const { e, from } of under) e.layer.alpha = from * (1 - t);
        this.stack.requestRender();
      },
      () => {
        this.stopTween = null;
        for (const { e } of under) this.remove(e);
        const next = this.queued;
        this.queued = null;
        if (next) this.start(next.key, next.bitmap);
      },
    );
  }

  private remove(e: Entry): void {
    const i = this.entries.indexOf(e);
    if (i < 0) return;
    this.entries.splice(i, 1);
    this.stack.layers.remove(e.layer, true);
    this.stack.requestRender();
  }
}
