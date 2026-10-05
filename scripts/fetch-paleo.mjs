#!/usr/bin/env node
/**
 * Palaeogeography pipeline: reconstructed coastlines (and plate boundaries) for the
 * Merdith et al. (2021) plate model, fetched from the GPlates Web Service, simplified for
 * a whole-globe view and written to public/data/paleo/:
 *
 *   coastlines_<age>.json   FeatureCollection with ONE MultiPolygon feature (properties {})
 *   boundaries_<age>.json   FeatureCollection of (Multi)LineStrings, properties { type }
 *                           (GPlates topology type: MidOceanRidge, SubductionZone, Transform, …)
 *   index.json              PaleoIndex (src/types.ts), listing only ages that exist on disk
 *
 * Usage: node scripts/fetch-paleo.mjs [--force] [--ages=0,5,200] [--no-boundaries]
 *   --force          re-download and overwrite files that already exist
 *   --ages=…         only process these ages (index.json still lists every age on disk)
 *   --no-boundaries  skip the plate-boundary requests
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanLine,
  cleanPolygon,
  encodeWithinBudget,
  fetchJson,
  fileExists,
  parseArgs,
  polygonsOf,
  printSummary,
  readExisting,
  runPool,
  writeFileAtomic,
} from './lib/geo-pipeline.mjs';

const MODEL = 'MERDITH2021';
const GWS = 'https://gws.gplates.org';
const OUT_DIR = fileURLToPath(new URL('../public/data/paleo/', import.meta.url));
const CONCURRENCY = 3; // be polite to a free academic service
const ATTRIBUTION = 'Merdith et al. 2021 plate model via GPlates Web Service (gws.gplates.org)';

const range = (from, to, step) => Array.from({ length: (to - from) / step + 1 }, (_, i) => from + i * step);
/** Every 5 Myr through the Phanerozoic, then every 20 Myr back to the model's 1000 Ma limit. */
const ALL_AGES = [...range(0, 540, 5), ...range(560, 1000, 20)];

/**
 * Coastlines: 0.15° Douglas–Peucker, 2-decimal coordinates (~1 km), specks < 0.05 deg² dropped.
 * GPlates returns ~2 MB per age, mostly hundreds of small terrane fragments, so files that
 * still exceed the byte budget get a coarser tolerance (1.25× steps, at most 0.6°).
 */
const COAST = { tolerance: 0.15, maxTolerance: 0.6, decimals: 2, minArea: 0.05, maxBytes: 150 * 1024 };
const BOUNDS = { tolerance: 0.15, decimals: 2 };

const coastFile = (age) => `coastlines_${age}.json`;
const boundsFile = (age) => `boundaries_${age}.json`;

/* ───────────────────────── Transforms ───────────────────────── */

const polygonCount = (fc) => fc.features.reduce((n, f) => n + polygonsOf(f.geometry).length, 0);

/**
 * GPlates emits one property-less Polygon feature per fragment; merging them into a single
 * MultiPolygon carries the same information without ~80 bytes of wrapper per polygon
 * (a third of the file at 200 Ma).
 */
function buildCoastlines(raw, tolerance) {
  const polygons = [];
  for (const feature of raw.features) {
    for (const poly of polygonsOf(feature.geometry)) {
      const clean = cleanPolygon(poly, { tolerance, decimals: COAST.decimals, minArea: COAST.minArea });
      if (clean) polygons.push(clean);
    }
  }
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: polygons } }],
  };
}

function encodeCoastlines(raw) {
  const { text, tolerance } = encodeWithinBudget((tol) => buildCoastlines(raw, tol), COAST);
  return { text, count: polygonCount(JSON.parse(text)), note: `tol ${+tolerance.toFixed(3)}` };
}

function encodeBoundaries(raw) {
  const features = [];
  for (const f of raw.features) {
    const g = f.geometry;
    const lines = g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : [];
    const clean = lines.map((l) => cleanLine(l, BOUNDS)).filter(Boolean);
    if (!clean.length) continue;
    features.push({
      type: 'Feature',
      properties: { type: f.properties?.type ?? 'Unknown' },
      geometry: clean.length === 1
        ? { type: 'LineString', coordinates: clean[0] }
        : { type: 'MultiLineString', coordinates: clean },
    });
  }
  return { text: JSON.stringify({ type: 'FeatureCollection', features }), count: features.length, note: `tol ${BOUNDS.tolerance}` };
}

/* ───────────────────────── Fetch one file ───────────────────────── */

/**
 * Ensures `file` exists: reuses it unless --force, otherwise downloads `url`, transforms it
 * with `encode` and writes it atomically. Never throws; failures come back as rows with ok=false.
 */
async function ensure(file, url, encode, countExisting, force) {
  const path = join(OUT_DIR, file);
  if (!force && (await fileExists(path))) {
    const { json, bytes } = await readExisting(path);
    return { file, count: countExisting(json), bytes, note: 'existing', ok: true };
  }
  const started = Date.now();
  try {
    const raw = await fetchJson(url, { label: file });
    if (raw?.type !== 'FeatureCollection' || !Array.isArray(raw.features)) {
      throw new Error(`${file}: response is not a GeoJSON FeatureCollection`);
    }
    // An empty answer means the service could not reconstruct this age; don't cache it as data.
    if (!raw.features.length) throw new Error(`${file}: empty FeatureCollection`);
    const { text, count, note } = encode(raw);
    const bytes = await writeFileAtomic(path, text);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`  ✓ ${file.padEnd(22)} ${String(count).padStart(5)}  ${(bytes / 1024).toFixed(0).padStart(4)} KB  ${note}  (${secs} s)`);
    return { file, count, bytes, note, ok: true };
  } catch (err) {
    console.error(`  ✗ ${err.message}`);
    return { file, note: `FAILED: ${err.message}`, ok: false };
  }
}

/* ───────────────────────── Index ───────────────────────── */

/**
 * Lists only the ages whose coastline file exists, so a partial run still yields a valid
 * index. `plateBoundaries` is advertised only when every listed age has a boundaries file,
 * because the template is resolved with the same age as the coastlines.
 */
async function writeIndex() {
  const agesMa = [];
  for (const age of ALL_AGES) if (await fileExists(join(OUT_DIR, coastFile(age)))) agesMa.push(age);
  const haveBounds = await Promise.all(agesMa.map((age) => fileExists(join(OUT_DIR, boundsFile(age)))));
  const boundariesComplete = agesMa.length > 0 && haveBounds.every(Boolean);
  const index = {
    model: MODEL,
    agesMa,
    coastlines: 'paleo/coastlines_{age}.json',
    ...(boundariesComplete && { plateBoundaries: 'paleo/boundaries_{age}.json' }),
    attribution: ATTRIBUTION,
  };
  await writeFileAtomic(join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 1));
  return { index, missingBoundaries: agesMa.filter((_, i) => !haveBounds[i]) };
}

/* ───────────────────────── Main ───────────────────────── */

async function main() {
  const args = parseArgs();
  const force = Boolean(args.force);
  const withBoundaries = !args['no-boundaries'];
  let ages = ALL_AGES;
  if (typeof args.ages === 'string') {
    const wanted = args.ages.split(',').map(Number);
    const unknown = wanted.filter((a) => !ALL_AGES.includes(a));
    if (unknown.length) console.warn(`Ignoring ages not in the snapshot schedule: ${unknown.join(', ')}`);
    ages = ALL_AGES.filter((a) => wanted.includes(a));
  }

  console.log(`GPlates ${MODEL}: ${ages.length} ages${withBoundaries ? ' (+ plate boundaries)' : ''}, ` +
    `${CONCURRENCY} concurrent requests${force ? ', --force' : ''} → ${OUT_DIR}`);

  // One pool slot handles one age (coastlines, then boundaries), so at most 3 requests are in flight.
  const perAge = await runPool(ages, CONCURRENCY, async (age) => {
    const coast = await ensure(coastFile(age), `${GWS}/reconstruct/coastlines/?time=${age}&model=${MODEL}`,
      encodeCoastlines, polygonCount, force);
    const bounds = withBoundaries
      ? await ensure(boundsFile(age), `${GWS}/topology/plate_boundaries/?time=${age}&model=${MODEL}`,
        encodeBoundaries, (fc) => fc.features.length, force)
      : null;
    return { coast, bounds };
  });

  const coastRows = perAge.map((r) => r.coast);
  const boundRows = perAge.map((r) => r.bounds).filter(Boolean);
  printSummary('Coastlines', coastRows, 'polygons');
  if (boundRows.length) printSummary('Plate boundaries', boundRows, 'features');

  const { index, missingBoundaries } = await writeIndex();
  const failed = [...coastRows, ...boundRows].filter((r) => !r.ok);
  console.log(`\nindex.json: ${index.agesMa.length}/${ALL_AGES.length} ages, ` +
    `plateBoundaries ${index.plateBoundaries ? 'yes' : `no (missing for ${missingBoundaries.length} ages)`}`);
  if (failed.length) {
    console.error(`${failed.length} file(s) failed: ${failed.map((r) => r.file).join(', ')} — re-run to retry just those.`);
    process.exitCode = 1;
  }
}

await main();
