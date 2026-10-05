/** Messages exchanged with raster.worker.ts (shared by the worker and RasterClient). */
import type { SchematicKind } from '../types';
import type { BorderLabel } from './paint/bordersPaint';

export type { BorderLabel };

/** Jobs whose result is a finished, pre-flipped ImageBitmap. */
export type BitmapJob =
  | {
      type: 'paleo';
      coastlinesUrl: string;
      platesUrl?: string;
      landColor: string;
      oceanColor: string;
      width: number;
      height: number;
    }
  | { type: 'borders'; url: string; maxLabels: number; width: number; height: number }
  | { type: 'ice'; latitude: number; width: number; height: number };

/** One horizontal band of a procedural texture; the result is raw RGBA rows. */
export interface BandJob {
  type: 'band';
  kind: SchematicKind;
  width: number;
  height: number;
  row0: number;
  row1: number;
}

export interface WorkerRequest {
  id: number;
  job: BitmapJob | BandJob;
}

export type WorkerResponse =
  | { id: number; ok: true; bitmap?: ImageBitmap; pixels?: ArrayBuffer; labels?: BorderLabel[] }
  | { id: number; ok: false; error: string };
