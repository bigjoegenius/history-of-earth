/**
 * Shared helpers for the data-pipeline scripts (fetch-paleo.mjs, fetch-borders.mjs):
 * resilient fetching, a small concurrency pool, polygon/line clean-up, atomic writes
 * and the final summary table. Plain ESM so the scripts run with `node` and no build step.
 */
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { simplify } from '@turf/simplify';

/* ───────────────────────── CLI / misc ───────────────────────── */

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Reads `--name` (boolean) and `--name=value` flags from process.argv. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (const arg of argv) {
    const m = /^--([\w-]+)(?:=(.*))?$/.exec(arg);
    if (m) out[m[1]] = m[2] ?? true;
  }
  return out;
}

/* ───────────────────────── Network ───────────────────────── */

class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status}`);
    this.status = status;
    this.url = url;
  }
}

/** 4xx means "this request will never work" — except rate limiting / request timeouts. */
function isRetryable(err) {
  if (!(err instanceof HttpError)) return true; // network errors, timeouts, truncated JSON
  return err.status >= 500 || err.status === 408 || err.status === 429;
}

/**
 * GET + JSON.parse with a per-attempt timeout (covers headers *and* body) and exponential
 * backoff with jitter: 2 s, 4 s, 8 s, 16 s for the default 4 retries.
 */
export async function fetchJson(url, { timeoutMs = 60_000, retries = 4, label = url, headers } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers });
      if (!res.ok) throw new HttpError(res.status, url);
      return await res.json();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) {
        throw new Error(`${label}: ${err.message} (gave up after ${attempt + 1} attempt(s))`);
      }
      const delay = 2000 * 2 ** attempt + Math.random() * 1000;
      console.warn(`  ! ${label}: ${err.message} — retry ${attempt + 1}/${retries} in ${(delay / 1000).toFixed(1)} s`);
      await sleep(delay);
    }
  }
}

/** Runs `worker` over `items` with at most `concurrency` in flight; results keep input order. */
export async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
  return results;
}

/* ───────────────────────── Files ───────────────────────── */

export async function fileExists(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Writes `text` via a temp file + rename, so an interrupted run never leaves a truncated
 * file that the "skip existing" logic would later trust. Returns the size in bytes.
 */
export async function writeFileAtomic(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, path);
  return Buffer.byteLength(text);
}

/** Parsed content + byte size of an existing output file (for the summary of skipped files). */
export async function readExisting(path) {
  const text = await readFile(path, 'utf8');
  return { json: JSON.parse(text), bytes: Buffer.byteLength(text) };
}

/* ───────────────────────── Geometry ───────────────────────── */

/** Planar shoelace area in square degrees — a cheap "is this speck worth drawing" measure. */
export function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return Math.abs(sum) / 2;
}

const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];

/** Rounds every coordinate and removes consecutive duplicates that rounding creates. */
function roundPath(points, decimals) {
  const f = 10 ** decimals;
  const out = [];
  for (const p of points) {
    const q = [Math.round(p[0] * f) / f, Math.round(p[1] * f) / f];
    if (!out.length || !samePoint(out[out.length - 1], q)) out.push(q);
  }
  return out;
}

function closeRing(ring) {
  return samePoint(ring[0], ring[ring.length - 1]) ? ring : [...ring, ring[0]];
}

/**
 * Simplify (Douglas–Peucker via @turf/simplify, highQuality off) and round one ring.
 * Each ring is simplified on its own so a single degenerate hole cannot throw away the whole
 * polygon (turf throws on rings that collapse below 4 points). Returns null if unusable.
 */
function cleanRing(ring, tolerance, decimals) {
  if (ring.length < 3) return null;
  try {
    const geom = { type: 'Polygon', coordinates: [closeRing(ring)] };
    simplify(geom, { tolerance, highQuality: false, mutate: true });
    const rounded = closeRing(roundPath(geom.coordinates[0], decimals));
    return rounded.length >= 4 ? rounded : null;
  } catch {
    return null;
  }
}

/**
 * Cleans one polygon (array of rings, outer first). Rings with < 4 points or an area below
 * `minArea` deg² are dropped; a polygon whose outer ring goes is dropped entirely (null).
 */
export function cleanPolygon(rings, { tolerance, decimals, minArea = 0 }) {
  const [outer, ...holes] = rings;
  if (!outer || outer.length < 4 || ringArea(outer) < minArea) return null;
  const cleanOuter = cleanRing(outer, tolerance, decimals);
  if (!cleanOuter) return null;
  const cleanHoles = holes
    .filter((h) => h.length >= 4 && ringArea(h) >= minArea)
    .map((h) => cleanRing(h, tolerance, decimals))
    .filter(Boolean);
  return [cleanOuter, ...cleanHoles];
}

/** Polygon | MultiPolygon geometry → list of polygons (each an array of rings). */
export function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

/** Simplify + round a line; null if fewer than 2 distinct points survive. */
export function cleanLine(points, { tolerance, decimals }) {
  if (points.length < 2) return null;
  try {
    const geom = { type: 'LineString', coordinates: points };
    simplify(geom, { tolerance, highQuality: false, mutate: true });
    const rounded = roundPath(geom.coordinates, decimals);
    return rounded.length >= 2 ? rounded : null;
  } catch {
    return null;
  }
}

/**
 * Serialises `build(tolerance)` and, while the result exceeds `maxBytes`, rebuilds with a
 * 1.25× coarser tolerance (never beyond `maxTolerance`). Small steps keep each file as
 * detailed as its budget allows. Returns the JSON text and the tolerance actually used.
 */
export function encodeWithinBudget(build, { tolerance, maxBytes, maxTolerance }) {
  let tol = tolerance;
  let text = JSON.stringify(build(tol));
  while (Buffer.byteLength(text) > maxBytes && tol * 1.25 <= maxTolerance) {
    tol *= 1.25;
    text = JSON.stringify(build(tol));
  }
  return { text, tolerance: tol };
}

/* ───────────────────────── Reporting ───────────────────────── */

/**
 * Prints `rows` ({file, count, bytes, note}) as an aligned table with a total line.
 * `countLabel` names the count column ("features", or "polygons" for merged geometries).
 */
export function printSummary(title, rows, countLabel = 'features') {
  const kb = (b) => (b / 1024).toFixed(1);
  const fileW = Math.max(4, ...rows.map((r) => r.file.length));
  const line = (file, count, size, note = '') =>
    `${file.padEnd(fileW)}  ${String(count).padStart(8)}  ${String(size).padStart(9)}  ${note}`;
  const total = rows.reduce((s, r) => s + (r.bytes ?? 0), 0);
  console.log(`\n${title}`);
  console.log(line('file', countLabel, 'KB', 'note'));
  console.log('-'.repeat(fileW + 40));
  for (const r of rows) console.log(line(r.file, r.count ?? '-', r.bytes != null ? kb(r.bytes) : '-', r.note));
  console.log('-'.repeat(fileW + 40));
  console.log(line(`${rows.filter((r) => r.bytes != null).length} files`, '', kb(total)));
  console.log(`total ${(total / 1024 / 1024).toFixed(2)} MB`);
}
