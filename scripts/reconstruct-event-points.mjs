/**
 * Reconstructs every deep-time event's location to its age with the Merdith et al. 2021 plate
 * model (GPlates Web Service `reconstruct/reconstruct_points`) and writes the result back into
 * src/data/events/*.json as `paleoLat` / `paleoLon` (see SPEC.md "Events — authoring rules").
 *
 * - Events dated 1 Ma to 1000 Ma (−1e6 ≥ year ≥ −1e9, the model's range), global ones included;
 *   age = round((2026 − year) / 1e6). Older events are left untouched; younger ones never get the
 *   fields (stale ones are removed).
 * - One request per age (all events of that age in one MultiPoint), 3 in flight at most,
 *   60 s timeout, 4 retries with backoff.
 * - Points the model cannot place come back as [999.99, 999.99]: the fields are omitted and the
 *   ids reported.
 * - The files are edited as text (two lines inserted right after "lon" / "global") so their
 *   formatting, key order and everything else stay exactly as authored; every edit is checked by
 *   re-parsing before it is written.
 * - Idempotent: events that already have both fields are skipped unless --force.
 *
 * Usage: node scripts/reconstruct-event-points.mjs [--force]
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fetchJson, parseArgs, runPool, sleep, writeFileAtomic } from './lib/geo-pipeline.mjs';

const EVENTS_DIR = resolve('src/data/events');
const MODEL = 'MERDITH2021';
const ENDPOINT = 'https://gws.gplates.org/reconstruct/reconstruct_points/';
/** Event years covered by the model (1 Ma … 1000 Ma). */
const YOUNGEST_YEAR = -1_000_000;
const OLDEST_YEAR = -1_000_000_000;
const CONCURRENCY = 3;
/** Keeps request URLs short; one age rarely has more than a handful of events. */
const MAX_POINTS_PER_REQUEST = 100;
/** Pause after each request in a lane, to stay polite to a free public service. */
const POLITE_DELAY_MS = 250;
const HEADERS = { 'User-Agent': 'history-of-earth data pipeline (scripts/reconstruct-event-points.mjs)' };

const args = parseArgs();
const force = !!args.force;

const ageOf = (year) => Math.round((2026 - year) / 1e6);
const round2 = (v) => Math.round(v * 100) / 100;
const hasPaleo = (e) => typeof e.paleoLat === 'number' && typeof e.paleoLon === 'number';

/* ───────────────────────── Load ───────────────────────── */

const fileNames = (await readdir(EVENTS_DIR)).filter((f) => f.endsWith('.json')).sort();
const files = [];
for (const name of fileNames) {
  const path = join(EVENTS_DIR, name);
  const text = await readFile(path, 'utf8');
  files.push({ name, path, text, events: JSON.parse(text) });
}

/** Per-file tallies for the summary table. */
const stats = new Map(fileNames.map((n) => [n, { inRange: 0, skipped: 0, reconstructed: 0, unreconstructable: 0, failed: 0 }]));
const targets = [];
/** Ids of events outside the model's range that carry (stale) palaeo fields: removed. */
const stale = new Set();
let tooOld = 0;
for (const f of files) {
  for (const ev of f.events) {
    if (typeof ev.year !== 'number' || !Number.isFinite(ev.lat) || !Number.isFinite(ev.lon)) continue;
    if (ev.year > YOUNGEST_YEAR || ev.year < OLDEST_YEAR) {
      if (ev.year < OLDEST_YEAR) tooOld++;
      if ('paleoLat' in ev || 'paleoLon' in ev) stale.add(ev.id);
      continue;
    }
    const age = ageOf(ev.year);
    const st = stats.get(f.name);
    st.inRange++;
    if (hasPaleo(ev) && !force) { st.skipped++; continue; }
    targets.push({ file: f.name, id: ev.id, age, lat: ev.lat, lon: ev.lon });
  }
}

/* ───────────────────────── Reconstruct ───────────────────────── */

const byAge = new Map();
for (const t of targets) {
  if (!byAge.has(t.age)) byAge.set(t.age, []);
  byAge.get(t.age).push(t);
}
const batches = [];
for (const [age, list] of [...byAge].sort((a, b) => a[0] - b[0])) {
  for (let i = 0; i < list.length; i += MAX_POINTS_PER_REQUEST) batches.push({ age, points: list.slice(i, i + MAX_POINTS_PER_REQUEST) });
}

console.log(`Reconstructing ${targets.length} event location(s) at ${byAge.size} age(s) with ${MODEL} (${batches.length} request(s))${force ? ' [--force]' : ''}…`);

/** id → { paleoLat, paleoLon } | null (cannot be reconstructed). Ids of failed requests are absent. */
const results = new Map();
const failedRequests = [];
let done = 0;
await runPool(batches, CONCURRENCY, async ({ age, points }) => {
  const query = points.map((p) => `${p.lon},${p.lat}`).join(',');
  const url = `${ENDPOINT}?points=${query}&time=${age}&model=${MODEL}`;
  const label = `${age} Ma (${points.length} point${points.length === 1 ? '' : 's'})`;
  try {
    const json = await fetchJson(url, { timeoutMs: 60_000, retries: 4, label, headers: HEADERS });
    const coords = json?.coordinates;
    if (json?.type !== 'MultiPoint' || !Array.isArray(coords) || coords.length !== points.length) {
      throw new Error(`${label}: unexpected response ${JSON.stringify(json).slice(0, 200)}`);
    }
    points.forEach((p, i) => {
      const [lon, lat] = coords[i] ?? [];
      const ok = Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
      results.set(p.id, ok ? { paleoLat: round2(lat), paleoLon: round2(lon) } : null);
    });
  } catch (err) {
    console.error(`  ✗ ${err.message}`);
    failedRequests.push(age);
    for (const p of points) stats.get(p.file).failed++;
  }
  done++;
  if (done % 10 === 0 || done === batches.length) console.log(`  ${done}/${batches.length} requests done`);
  await sleep(POLITE_DELAY_MS);
});

/* ───────────────────────── Write back ───────────────────────── */

const PALEO_LINE = /^\s*"paleo(Lat|Lon)":/;

/**
 * Text-level edit of one file: in each affected top-level object (`  {` … `  }`), drop old
 * paleoLat/paleoLon lines and insert the new ones right after "lon" (or "global" when it follows).
 */
function editFile(f) {
  /** The fields to write for an event: an object, null to remove them, undefined to leave it alone. */
  const resultFor = (id) => (stale.has(id) ? null : results.get(id));
  const lines = f.text.split('\n');
  const starts = [];
  lines.forEach((l, i) => { if (l === '  {') starts.push(i); });
  if (starts.length !== f.events.length) throw new Error(`${f.name}: expected one "  {" line per event (${starts.length} vs ${f.events.length})`);

  const expected = [];
  // Walk objects back to front so earlier line indices stay valid while splicing.
  const edits = [];
  f.events.forEach((ev, i) => {
    const r = resultFor(ev.id);
    if (r === undefined) { expected.push(ev); return; }
    const { paleoLat: _a, paleoLon: _b, ...rest } = ev;
    const out = {};
    for (const [k, v] of Object.entries(rest)) {
      out[k] = v;
      const anchor = 'global' in rest ? 'global' : 'lon';
      if (k === anchor && r) { out.paleoLat = r.paleoLat; out.paleoLon = r.paleoLon; }
    }
    expected.push(out);
    edits.push({ index: i, ev, r });
  });
  if (!edits.length) return null;

  for (const { index, ev, r } of edits.reverse()) {
    const start = starts[index];
    let end = start + 1;
    while (end < lines.length && lines[end] !== '  }' && lines[end] !== '  },') end++;
    const body = lines.slice(start + 1, end);
    if (!body.some((l) => l.includes(`"id": ${JSON.stringify(ev.id)}`))) throw new Error(`${f.name}: object #${index} is not ${ev.id}`);
    const kept = body.filter((l) => !PALEO_LINE.test(l));
    if (r) {
      let at = kept.findIndex((l) => /^\s*"lon": /.test(l));
      if (at < 0) throw new Error(`${f.name}: no "lon" line in ${ev.id}`);
      if (/^\s*"global": /.test(kept[at + 1] ?? '')) at++;
      const indent = /^\s*/.exec(kept[at])[0];
      kept.splice(at + 1, 0, `${indent}"paleoLat": ${JSON.stringify(r.paleoLat)},`, `${indent}"paleoLon": ${JSON.stringify(r.paleoLon)},`);
    }
    lines.splice(start + 1, body.length, ...kept);
  }
  const text = lines.join('\n');
  // Safety net: the edited text must parse to exactly the expected data (values and key order).
  if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(expected)) throw new Error(`${f.name}: edited text does not match the expected data; not written`);
  return text;
}

const unreconstructable = [];
let writeErrors = 0;
for (const f of files) {
  const st = stats.get(f.name);
  for (const ev of f.events) {
    const r = results.get(ev.id);
    if (r === undefined) continue;
    if (r) st.reconstructed++;
    else { st.unreconstructable++; unreconstructable.push(`${ev.id} (${ageOf(ev.year)} Ma)`); }
  }
  try {
    const text = editFile(f);
    if (text !== null && text !== f.text) await writeFileAtomic(f.path, text);
  } catch (err) {
    writeErrors++;
    console.error(`  ✗ ${err.message}`);
  }
}

/* ───────────────────────── Summary ───────────────────────── */

const rows = [...stats].filter(([, s]) => s.inRange > 0);
const col = (v, w = 9) => String(v).padStart(w);
console.log(`\nPalaeo-positions (${MODEL}, 1–1000 Ma)`);
console.log(`${'file'.padEnd(18)}${col('in range')}${col('skipped')}${col('rebuilt')}${col('no fix')}${col('failed')}`);
console.log('-'.repeat(63));
for (const [name, s] of rows) console.log(`${name.padEnd(18)}${col(s.inRange)}${col(s.skipped)}${col(s.reconstructed)}${col(s.unreconstructable)}${col(s.failed)}`);
console.log('-'.repeat(63));
const sum = (k) => rows.reduce((a, [, s]) => a + s[k], 0);
console.log(`${'total'.padEnd(18)}${col(sum('inRange'))}${col(sum('skipped'))}${col(sum('reconstructed'))}${col(sum('unreconstructable'))}${col(sum('failed'))}`);
console.log(`\nprocessed ${targets.length} event(s): ${sum('reconstructed')} reconstructed, ${sum('unreconstructable')} unreconstructable, ${sum('failed')} failed`);
console.log(`skipped ${sum('skipped')} already reconstructed${force ? '' : ' (use --force to redo)'}; ${tooOld} older than 1000 Ma left untouched`);
if (stale.size) console.log(`removed stale palaeo fields from ${stale.size} event(s) outside the model's range: ${[...stale].join(', ')}`);
if (unreconstructable.length) console.log(`unreconstructable: ${unreconstructable.join(', ')}`);
if (failedRequests.length) console.log(`failed requests (ages, Ma): ${failedRequests.sort((a, b) => a - b).join(', ')}`);
if (failedRequests.length || writeErrors) process.exit(1);
