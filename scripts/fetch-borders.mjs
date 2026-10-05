#!/usr/bin/env node
/**
 * Historical borders pipeline: every world_<tag>.geojson snapshot of aourednik/historical-basemaps
 * plus a present-day snapshot from Natural Earth 110m admin-0, normalised and simplified into
 * public/data/borders/:
 *
 *   world_<year>.json  FeatureCollection of MultiPolygon features with BorderFeatureProps
 *                      (src/types.ts): { name, subject?, partOf?, precision? }
 *   index.json         BordersIndex (src/types.ts), listing only years that exist on disk
 *
 * <year> follows the YEAR CONVENTION: world_bc3000 → world_-3000.json, world_1492 → world_1492.json.
 *
 * Usage: node scripts/fetch-borders.mjs [--force]
 *   --force  re-download and overwrite files that already exist
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanPolygon,
  encodeWithinBudget,
  fetchJson,
  fileExists,
  parseArgs,
  polygonsOf,
  printSummary,
  readExisting,
  ringArea,
  runPool,
  writeFileAtomic,
} from './lib/geo-pipeline.mjs';

const OUT_DIR = fileURLToPath(new URL('../public/data/borders/', import.meta.url));
const LISTING_URL = 'https://api.github.com/repos/aourednik/historical-basemaps/contents/geojson';
const RAW_URL = (tag) => `https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson/world_${tag}.geojson`;
const NATURAL_EARTH_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';
const PRESENT_YEAR = 2026; // the Natural Earth snapshot stands in for "today"
const CONCURRENCY = 3;
const ATTRIBUTION = 'historical-basemaps by aourednik (GPL-3.0); Natural Earth (public domain)';

/**
 * Snapshot tags as listed by the GitHub contents API (October 2026). Used when the API is
 * unreachable or rate-limited (60 unauthenticated requests per hour).
 */
const FALLBACK_TAGS = [
  'bc123000', 'bc10000', 'bc8000', 'bc5000', 'bc4000', 'bc3000', 'bc2000', 'bc1500', 'bc1000',
  'bc700', 'bc500', 'bc400', 'bc323', 'bc300', 'bc200', 'bc100', 'bc1',
  '100', '200', '300', '400', '500', '600', '700', '800', '900', '1000', '1100', '1200', '1279',
  '1300', '1400', '1492', '1500', '1530', '1600', '1650', '1700', '1715', '1783', '1800', '1815',
  '1878', '1880', '1900', '1914', '1920', '1930', '1938', '1945', '1960', '1994', '2000', '2010',
];

/**
 * Light simplification (0.05°, 3-decimal coordinates ≈ 100 m). Files that still exceed the
 * budget (world_1492 maps ~1300 indigenous nations) get a coarser tolerance per file.
 * Parts below MIN_PART_AREA deg² are dropped, except each feature's largest part, so
 * micro-states such as Monaco or Vatican City survive while slivers and islets go.
 */
const SIMPLIFY = { tolerance: 0.05, maxTolerance: 0.4, decimals: 3, maxBytes: 400 * 1024 };
const MIN_PART_AREA = 0.001;

const fileFor = (year) => `world_${year}.json`;

/** 'bc3000' → -3000, '1492' → 1492 (YEAR CONVENTION; no year-zero shifting). */
function tagToYear(tag) {
  const m = /^(bc)?(\d+)$/.exec(tag);
  if (!m) throw new Error(`Unrecognised snapshot tag: ${tag}`);
  return m[1] ? -Number(m[2]) : Number(m[2]);
}

async function listTags() {
  try {
    const entries = await fetchJson(LISTING_URL, {
      label: 'GitHub listing',
      retries: 1,
      timeoutMs: 20_000,
      headers: { Accept: 'application/vnd.github+json' },
    });
    const tags = entries
      .map((e) => /^world_((?:bc)?\d+)\.geojson$/.exec(e.name)?.[1])
      .filter(Boolean);
    if (!tags.length) throw new Error('listing contained no world_* files');
    console.log(`GitHub listing: ${tags.length} snapshots`);
    return tags;
  } catch (err) {
    console.warn(`GitHub listing unavailable (${err.message}); using the built-in list of ${FALLBACK_TAGS.length} snapshots`);
    return FALLBACK_TAGS;
  }
}

/* ───────────────────────── Normalisation ───────────────────────── */

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * historical-basemaps properties → BorderFeatureProps. `subject` / `partOf` are omitted when
 * they merely repeat `name` (true for most features), which keeps the large files lean;
 * consumers treat a missing value as "same as name".
 */
function historicalProps(p) {
  const name = str(p?.NAME);
  if (!name) return null;
  const props = { name };
  const subject = str(p.SUBJECTO);
  const partOf = str(p.PARTOF);
  if (subject && subject !== name) props.subject = subject;
  if (partOf && partOf !== name) props.partOf = partOf;
  if (typeof p.BORDERPRECISION === 'number') props.precision = p.BORDERPRECISION;
  return props;
}

/**
 * Natural Earth properties → BorderFeatureProps. NAME is NE's short display name; `subject`
 * is the sovereign state for dependencies (Greenland → Denmark), mirroring SUBJECTO above.
 * ADMIN (not NAME) is compared with SOVEREIGNT so that e.g. "Tanzania" vs "United Republic
 * of Tanzania" does not count as a dependency. Territories NE classes as "Indeterminate"
 * (Palestine, Western Sahara) get no subject: NE's SOVEREIGNT there records de facto
 * control, not an accepted ruling state, and the app should not imply one.
 */
function naturalEarthProps(p) {
  const name = str(p?.NAME);
  if (!name) return null;
  const sovereign = str(p.SOVEREIGNT);
  const isDependency = sovereign && sovereign !== str(p.ADMIN) && p.TYPE !== 'Indeterminate';
  return isDependency ? { name, subject: sovereign } : { name };
}

function buildCollection(raw, toProps, tolerance) {
  const features = [];
  for (const f of raw.features) {
    const properties = toProps(f.properties);
    if (!properties) continue;
    const parts = polygonsOf(f.geometry)
      .map((poly) => ({ poly, area: ringArea(poly[0]) }))
      .sort((a, b) => b.area - a.area)
      .filter((part, i) => i === 0 || part.area >= MIN_PART_AREA)
      .map(({ poly }) => cleanPolygon(poly, { tolerance, decimals: SIMPLIFY.decimals }))
      .filter(Boolean);
    if (parts.length) features.push({ type: 'Feature', properties, geometry: { type: 'MultiPolygon', coordinates: parts } });
  }
  return { type: 'FeatureCollection', features };
}

/* ───────────────────────── Fetch one snapshot ───────────────────────── */

/** Ensures world_<year>.json exists (reused unless --force). Never throws; failures → ok=false rows. */
async function ensure(year, url, toProps, force) {
  const file = fileFor(year);
  const path = join(OUT_DIR, file);
  if (!force && (await fileExists(path))) {
    const { json, bytes } = await readExisting(path);
    return { file, year, count: json.features.length, bytes, note: 'existing', ok: true };
  }
  const started = Date.now();
  try {
    const raw = await fetchJson(url, { label: file });
    if (raw?.type !== 'FeatureCollection' || !Array.isArray(raw.features)) {
      throw new Error(`${file}: response is not a GeoJSON FeatureCollection`);
    }
    const { text, tolerance } = encodeWithinBudget((tol) => buildCollection(raw, toProps, tol), SIMPLIFY);
    const bytes = await writeFileAtomic(path, text);
    const count = JSON.parse(text).features.length;
    const note = `tol ${+tolerance.toFixed(3)}, ${raw.features.length - count} unnamed/empty dropped`;
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`  ✓ ${file.padEnd(20)} ${String(count).padStart(5)}  ${(bytes / 1024).toFixed(0).padStart(4)} KB  ${note}  (${secs} s)`);
    return { file, year, count, bytes, note, ok: true };
  } catch (err) {
    console.error(`  ✗ ${err.message}`);
    return { file, year, note: `FAILED: ${err.message}`, ok: false };
  }
}

/* ───────────────────────── Main ───────────────────────── */

async function main() {
  const force = Boolean(parseArgs().force);
  const tags = await listTags();
  const jobs = [
    ...tags.map((tag) => ({ year: tagToYear(tag), url: RAW_URL(tag), toProps: historicalProps })),
    { year: PRESENT_YEAR, url: NATURAL_EARTH_URL, toProps: naturalEarthProps },
  ].sort((a, b) => a.year - b.year);

  console.log(`Borders: ${jobs.length} snapshots, ${CONCURRENCY} concurrent downloads${force ? ', --force' : ''} → ${OUT_DIR}`);
  const rows = await runPool(jobs, CONCURRENCY, (job) => ensure(job.year, job.url, job.toProps, force));
  printSummary('Borders', rows, 'features');

  // Only snapshots that exist on disk go into the index, so a partial run is still consistent.
  const years = rows.filter((r) => r.ok).map((r) => r.year);
  await writeFileAtomic(join(OUT_DIR, 'index.json'),
    JSON.stringify({ years, file: 'borders/world_{year}.json', attribution: ATTRIBUTION }, null, 1));
  console.log(`\nindex.json: ${years.length}/${jobs.length} snapshots (${years[0]} … ${years[years.length - 1]})`);

  const failed = rows.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`${failed.length} snapshot(s) failed: ${failed.map((r) => r.file).join(', ')} — re-run to retry just those.`);
    process.exitCode = 1;
  }
}

await main();
