/**
 * Off-main-thread painter. Fetching + parsing GeoJSON and rasterising 4096 × 2048 canvases takes
 * tens to hundreds of milliseconds, which would stutter playback if done on the main thread.
 */
import type { BandJob, BitmapJob, WorkerRequest, WorkerResponse } from './rasterJobs';
import { isFeatureCollection, type FeatureCollection } from './paint/geo';
import { paintSchematic } from './paint/schematicPaint';
import { paintPaleo } from './paint/paleoPaint';
import { paintBorders } from './paint/bordersPaint';
import { paintIce } from './paint/icePaint';

/** The slice of DedicatedWorkerGlobalScope we use (the project compiles with the DOM lib only). */
interface WorkerScope {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, options?: { transfer?: Transferable[] }): void;
}
const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const { id, job } = e.data;
  run(job).then(
    (res) => scope.postMessage({ id, ok: true, ...res }, { transfer: res.transfer }),
    (err: unknown) => scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
};

type Result = Omit<Extract<WorkerResponse, { ok: true }>, 'id' | 'ok'> & { transfer: Transferable[] };

async function run(job: BitmapJob | BandJob): Promise<Result> {
  switch (job.type) {
    case 'band': {
      const pixels = paintSchematic(job.kind, job.width, job.height, job.row0, job.row1).buffer;
      return { pixels, transfer: [pixels] };
    }
    case 'ice': {
      const pixels = new ImageData(paintIce(job.width, job.height, job.latitude), job.width, job.height);
      const bitmap = await toBitmap(pixels);
      return { bitmap, transfer: [bitmap] };
    }
    case 'paleo': {
      const [coast, plates] = await Promise.all([
        fetchCollection(job.coastlinesUrl),
        // Plate boundaries are decoration: a missing file must not lose the coastlines.
        job.platesUrl ? fetchCollection(job.platesUrl).catch(() => null) : null,
      ]);
      const canvas = new OffscreenCanvas(job.width, job.height);
      paintPaleo(canvas, coast, plates, job.landColor, job.oceanColor); // already flipped for WebGL
      const bitmap = canvas.transferToImageBitmap(); // hands over the pixels without a copy
      return { bitmap, transfer: [bitmap] };
    }
    case 'borders': {
      const fc = await fetchCollection(job.url);
      const canvas = new OffscreenCanvas(job.width, job.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2D canvas unavailable');
      const labels = paintBorders(ctx, job.width, job.height, fc, job.maxLabels);
      const bitmap = await toBitmap(canvas);
      return { bitmap, labels, transfer: [bitmap] };
    }
  }
}

async function fetchCollection(url: string): Promise<FeatureCollection> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const json: unknown = await res.json();
  if (!isFeatureCollection(json)) throw new Error(`Not a GeoJSON FeatureCollection: ${url}`);
  return json;
}

/**
 * Cesium uploads imagery with UNPACK_FLIP_Y_WEBGL, which WebGL ignores for ImageBitmaps, so the
 * bitmap is flipped here (Cesium's own loaders do the same; the opaque paleo raster is painted
 * flipped instead). Translucent rasters keep straight (un-premultiplied) alpha because imagery
 * layers blend with straight alpha, which forces a slow CPU upload path (~20–250 ms at 4096 × 2048).
 */
function toBitmap(source: OffscreenCanvas | ImageData): Promise<ImageBitmap> {
  return createImageBitmap(source, { imageOrientation: 'flipY', premultiplyAlpha: 'none' });
}
