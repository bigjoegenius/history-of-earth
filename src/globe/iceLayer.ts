/** Polar ice caps as a translucent overlay slot (all modes), one cached bitmap per latitude. */
import type { LayerSlot } from './layerStack';
import type { RasterClient } from './rasterClient';
import { LruCache } from './lru';
import { FailureBackoff } from './backoff';

/** The cap is smooth, so a modest raster is plenty. */
const ICE_SIZE = { width: 1024, height: 512 };
const RETRY_MS = 5000;

export class IceLayer {
  private readonly cache: LruCache<number, ImageBitmap>;
  private readonly pending = new Set<number>();
  private wanted: number | null = null;
  private readonly failures = new FailureBackoff<number>(RETRY_MS);

  constructor(private readonly slot: LayerSlot, private readonly raster: RasterClient, isDisplaying: (b: ImageBitmap) => boolean) {
    this.cache = new LruCache(8, (b) => { if (!isDisplaying(b)) b.close(); });
  }

  /** `latitude` from GlobeStyle.iceCapLatitude: 90 (or missing) = no ice, 0 = snowball. */
  update(latitude: number | undefined): void {
    const lat = Math.round(Math.min(90, Math.max(0, latitude ?? 90)));
    if (lat >= 90) {
      this.wanted = null;
      this.slot.clear();
      return;
    }
    if (lat === this.wanted || this.failures.blocked(lat)) return;
    this.wanted = lat;
    const cached = this.cache.get(lat);
    if (cached) {
      this.slot.show(`ice:${lat}`, cached);
      return;
    }
    if (this.pending.has(lat)) return;
    this.pending.add(lat);
    this.raster
      .bitmap({ type: 'ice', latitude: lat, ...ICE_SIZE })
      .then(({ bitmap }) => {
        this.cache.set(lat, bitmap);
        if (this.wanted === lat) this.slot.show(`ice:${lat}`, bitmap);
      })
      .catch((err: unknown) => {
        console.warn('[globe] ice cap raster failed:', err);
        this.failures.fail(lat);
        if (this.wanted === lat) this.wanted = null; // asked for again once the backoff expires
      })
      .finally(() => this.pending.delete(lat));
  }

  destroy(): void {
    this.cache.clear();
  }
}
