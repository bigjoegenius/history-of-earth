/** Main-thread side of raster.worker.ts: request/response bookkeeping and a small worker pool. */
import RasterWorker from './raster.worker?worker';
import type { SchematicKind } from '../types';
import type { BandJob, BitmapJob, BorderLabel, WorkerRequest, WorkerResponse } from './rasterJobs';

export type { BorderLabel };

export interface RasterResult {
  bitmap: ImageBitmap;
  labels?: BorderLabel[];
}

type Done = Extract<WorkerResponse, { ok: true }>;

/**
 * Procedural textures are only generated when a schematic era is first reached (four kinds in all),
 * so the band workers are shut down after this long without work and respawned on demand.
 */
const BAND_IDLE_MS = 10_000;

export class RasterClient {
  private nextId = 1;
  private readonly pending = new Map<number, { worker: Worker; resolve: (r: Done) => void; reject: (e: Error) => void }>();
  /** Vector jobs (paleo, borders, ice) get their own worker so they never queue behind noise. */
  private vectorWorker: Worker | null = null;
  /** Procedural textures are split into row bands across this pool (≈1 s instead of ≈4 s). */
  private bandWorkers: Worker[] = [];
  private bandJobs = 0;
  private bandIdleTimer: ReturnType<typeof setTimeout> | undefined;

  /** Paints a vector/ice raster off the main thread. Rejects on fetch or paint failure. */
  async bitmap(job: BitmapJob): Promise<RasterResult> {
    this.vectorWorker ??= this.spawn();
    const res = await this.post(this.vectorWorker, job);
    if (!res.bitmap) throw new Error(`Raster worker returned no bitmap for ${job.type}`);
    return { bitmap: res.bitmap, labels: res.labels };
  }

  /** Generates a w × h procedural texture as a pre-flipped ImageBitmap. */
  async schematic(kind: SchematicKind, width: number, height: number): Promise<ImageBitmap> {
    clearTimeout(this.bandIdleTimer);
    if (this.bandWorkers.length === 0) {
      const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 2));
      this.bandWorkers = Array.from({ length: n }, () => this.spawn());
    }
    const workers = this.bandWorkers;
    const n = workers.length;
    const bands: BandJob[] = Array.from({ length: n }, (_, i) => ({
      type: 'band', kind, width, height,
      row0: Math.floor((i * height) / n), row1: Math.floor(((i + 1) * height) / n),
    }));
    this.bandJobs++;
    let results: Done[];
    try {
      results = await Promise.all(bands.map((b, i) => this.post(workers[i], b)));
    } finally {
      if (--this.bandJobs === 0) this.bandIdleTimer = setTimeout(() => this.stopBandWorkers(), BAND_IDLE_MS);
    }
    const image = new ImageData(width, height);
    results.forEach((r, i) => {
      if (!r.pixels) throw new Error('Raster worker returned no pixels');
      image.data.set(new Uint8ClampedArray(r.pixels), bands[i].row0 * width * 4);
    });
    // Pre-flipped for the same reason as in raster.worker.ts (WebGL ignores FLIP_Y for bitmaps).
    return createImageBitmap(image, { imageOrientation: 'flipY' });
  }

  destroy(): void {
    clearTimeout(this.bandIdleTimer);
    this.vectorWorker?.terminate();
    for (const w of this.bandWorkers) w.terminate();
    this.vectorWorker = null;
    this.bandWorkers = [];
    for (const p of this.pending.values()) p.reject(new Error('RasterClient destroyed'));
    this.pending.clear();
  }

  /** Only called with no band job in flight, so no caller is left waiting on a terminated worker. */
  private stopBandWorkers(): void {
    for (const w of this.bandWorkers) w.terminate();
    this.bandWorkers = [];
  }

  private spawn(): Worker {
    const worker = new RasterWorker();
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data);
      else p.reject(new Error(e.data.error));
    };
    // A worker that fails to load or crashes would otherwise leave its callers waiting forever.
    worker.onerror = (e) => {
      console.error('[globe] raster worker error', e.message);
      for (const [id, p] of this.pending) {
        if (p.worker !== worker) continue;
        this.pending.delete(id);
        p.reject(new Error(e.message || 'raster worker error'));
      }
    };
    return worker;
  }

  private post(worker: Worker, job: BitmapJob | BandJob): Promise<Done> {
    const id = this.nextId++;
    return new Promise<Done>((resolve, reject) => {
      this.pending.set(id, { worker, resolve, reject });
      const msg: WorkerRequest = { id, job };
      worker.postMessage(msg);
    });
  }
}
