// Validates every src/data/events/*.json against the HistoryEvent contract (src/types.ts).
// Usage: node scripts/validate-events.mjs [file ...]   (defaults to all files)
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

const CATEGORIES = new Set(['cosmic','geology','climate','life','extinction','human-evolution','civilization','empire','war','politics','religion','science','technology','exploration','culture','economy','disaster','fringe']);
const CONSENSUS = new Set(['established','majority','debated','fringe']);
const TIMELINE_START = -4_567_000_000, PRESENT = 2026.75;

const dir = resolve('src/data/events');
const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f));

let errors = 0, total = 0;
const ids = new Map();
const err = (f, msg) => { errors++; console.error(`${basename(f)}: ${msg}`); };

for (const f of files) {
  let data;
  try { data = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { err(f, `invalid JSON: ${e.message}`); continue; }
  if (!Array.isArray(data)) { err(f, 'top level must be an array'); continue; }
  const prefix = basename(f, '.json');
  for (const [i, e] of data.entries()) {
    total++;
    const where = `#${i} (${e?.id ?? e?.title ?? '?'})`;
    if (!e || typeof e !== 'object') { err(f, `${where}: not an object`); continue; }
    if (typeof e.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id)) err(f, `${where}: id must be kebab-case`);
    else if (!e.id.startsWith(prefix + '-')) err(f, `${where}: id must start with "${prefix}-"`);
    if (ids.has(e.id)) err(f, `${where}: duplicate id (also in ${ids.get(e.id)})`); else ids.set(e.id, basename(f));
    if (typeof e.title !== 'string' || e.title.length === 0 || e.title.length > 60) err(f, `${where}: title must be 1–60 chars`);
    if (typeof e.year !== 'number' || !Number.isFinite(e.year)) err(f, `${where}: year must be a finite number`);
    else if (e.year < TIMELINE_START || e.year > PRESENT) err(f, `${where}: year ${e.year} outside timeline`);
    if (e.endYear !== undefined) {
      if (typeof e.endYear !== 'number' || e.endYear < e.year) err(f, `${where}: endYear must be a number >= year`);
      if (e.endYear > PRESENT + 1) err(f, `${where}: endYear in the future`);
    }
    if (e.uncertainty !== undefined && (typeof e.uncertainty !== 'number' || e.uncertainty < 0)) err(f, `${where}: uncertainty must be >= 0`);
    if (typeof e.lat !== 'number' || e.lat < -90 || e.lat > 90) err(f, `${where}: lat out of range`);
    if (typeof e.lon !== 'number' || e.lon < -180 || e.lon > 180) err(f, `${where}: lon out of range`);
    if (e.global !== undefined && typeof e.global !== 'boolean') err(f, `${where}: global must be boolean`);
    if ((e.paleoLat === undefined) !== (e.paleoLon === undefined)) err(f, `${where}: paleoLat and paleoLon must be set together`);
    if (e.paleoLat !== undefined && (typeof e.paleoLat !== 'number' || e.paleoLat < -90 || e.paleoLat > 90)) err(f, `${where}: paleoLat out of range`);
    if (e.paleoLon !== undefined && (typeof e.paleoLon !== 'number' || e.paleoLon < -180 || e.paleoLon > 180)) err(f, `${where}: paleoLon out of range`);
    if (!CATEGORIES.has(e.category)) err(f, `${where}: bad category "${e.category}"`);
    if (![1,2,3,4,5].includes(e.importance)) err(f, `${where}: importance must be 1–5`);
    if (typeof e.summary !== 'string' || e.summary.length === 0 || e.summary.length > 170) err(f, `${where}: summary must be 1–170 chars (got ${e.summary?.length})`);
    if (typeof e.description !== 'string' || e.description.length < 80) err(f, `${where}: description too short (need 2–6 sentences)`);
    if (e.wikipedia !== undefined && (typeof e.wikipedia !== 'string' || e.wikipedia.includes('http') || e.wikipedia.includes('_'))) err(f, `${where}: wikipedia must be an article TITLE with spaces, not a URL or underscores`);
    if (!CONSENSUS.has(e.consensus)) err(f, `${where}: bad consensus "${e.consensus}"`);
    if ((e.consensus === 'fringe' || e.consensus === 'debated') && (typeof e.mainstreamView !== 'string' || e.mainstreamView.length < 40)) err(f, `${where}: fringe/debated events need a mainstreamView (≥ 40 chars)`);
    if (e.consensus === 'fringe' && e.category !== 'fringe') err(f, `${where}: fringe consensus must use category "fringe"`);
    if (e.category === 'fringe' && e.consensus !== 'fringe') err(f, `${where}: category "fringe" must have consensus "fringe"`);
    if (e.dateLabel !== undefined && typeof e.dateLabel !== 'string') err(f, `${where}: dateLabel must be a string`);
    if (e.tags !== undefined && (!Array.isArray(e.tags) || e.tags.some((t) => typeof t !== 'string'))) err(f, `${where}: tags must be string[]`);
    const allowed = new Set(['id','title','year','endYear','dateLabel','uncertainty','lat','lon','global','paleoLat','paleoLon','category','importance','summary','description','wikipedia','consensus','mainstreamView','tags']);
    for (const k of Object.keys(e)) if (!allowed.has(k)) err(f, `${where}: unknown field "${k}"`);
  }
  // Era range check from file name convention (optional ranges in RANGES)
  const RANGES = {
    hadean: [-4_567_000_000, -4_031_000_000], archean: [-4_031_000_000, -2_500_000_000], proterozoic: [-2_500_000_000, -538_800_000],
    paleozoic: [-538_800_000, -251_902_000], mesozoic: [-251_902_000, -66_000_000], cenozoic: [-66_000_000, -300_000],
    prehistory: [-300_000, -3500], ancient: [-3500, -500], classical: [-500, 500], postclassical: [500, 1500],
    earlymodern: [1500, 1800], modern1: [1800, 1914], modern2: [1914, 2000], modern3: [2000, PRESENT],
  };
  const r = RANGES[prefix];
  if (r) for (const e of data) if (typeof e.year === 'number' && (e.year < r[0] - 1 || e.year >= r[1] + 1)) err(f, `(${e.id}): year ${e.year} outside this file's era range [${r[0]}, ${r[1]})`);
}
console.log(`${total} events in ${files.length} files, ${errors} error(s)`);
process.exit(errors ? 1 : 0);
