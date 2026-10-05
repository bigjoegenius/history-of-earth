/** Locating snapshot files under /data and choosing the snapshot for a given year. */
import type { BordersIndex, PaleoIndex, Year } from '../types';
import { PRESENT_YEAR } from '../types';

/** Absolute URL of a path relative to the site's /data/ folder (works under any Vite base). */
export function dataUrl(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}data/${path}`, location.href).href;
}

/** Fills "{name}" in a PaleoIndex/BordersIndex path template. */
export function fillTemplate(template: string, name: string, value: number): string {
  return template.replace(`{${name}}`, String(value));
}

/** Millions of years before present for a year on the app's axis. */
export function yearToAgeMa(year: Year): number {
  return (PRESENT_YEAR - year) / 1e6;
}

/** Index of the snapshot age closest to `ageMa` (ages ascending, non-empty). */
export function nearestIndex(ages: number[], ageMa: number): number {
  let best = 0;
  for (let i = 1; i < ages.length; i++) {
    if (Math.abs(ages[i] - ageMa) < Math.abs(ages[best] - ageMa)) best = i;
  }
  return best;
}

/** Latest snapshot year ≤ `year` (years ascending), or null before the first snapshot. */
export function snapshotAtOrBefore(years: Year[], year: Year): Year | null {
  let lo = 0, hi = years.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (years[mid] <= year) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? null : years[lo - 1];
}

const RETRY_AFTER_MS = 15_000;
const jsonCache = new Map<string, { promise: Promise<unknown>; failedAt?: number }>();

/**
 * Fetches and caches a JSON file under /data. Resolves null (never rejects) when missing or
 * malformed; failures are retried after a while because the data pipeline may still be writing.
 */
export function loadDataJson<T>(path: string, isValid: (v: unknown) => v is T): Promise<T | null> {
  const hit = jsonCache.get(path);
  if (hit && !(hit.failedAt !== undefined && Date.now() - hit.failedAt > RETRY_AFTER_MS)) {
    return hit.promise as Promise<T | null>;
  }
  const entry: { promise: Promise<T | null>; failedAt?: number } = {
    promise: fetch(dataUrl(path))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json: unknown) => {
        if (!isValid(json)) throw new Error('unexpected shape');
        return json;
      })
      .catch((err: unknown) => {
        entry.failedAt = Date.now();
        console.warn(`[globe] could not load /data/${path}:`, err instanceof Error ? err.message : err);
        return null;
      }),
  };
  jsonCache.set(path, entry);
  return entry.promise;
}

export function isPaleoIndex(v: unknown): v is PaleoIndex {
  const o = v as PaleoIndex | null;
  return !!o && Array.isArray(o.agesMa) && o.agesMa.length > 0 && typeof o.coastlines === 'string';
}

export function isBordersIndex(v: unknown): v is BordersIndex {
  const o = v as BordersIndex | null;
  return !!o && Array.isArray(o.years) && o.years.length > 0 && typeof o.file === 'string';
}
