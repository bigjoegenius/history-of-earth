// Validates src/data/chapters.json against the Chapter contract (src/types.ts) and the rules in SPEC.md,
// then prints the table of contents as a tree with pacing at 1× speed.
// Usage: node scripts/validate-chapters.mjs        (exit code 1 when any error is found)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TIMELINE_START = -4_567_000_000;
const PRESENT = 2026.75;
/** Oldest age covered by the Merdith 2021 plate model, i.e. the earliest year 'paleo' mode can draw. */
const PALEO_LIMIT = -1_000_000_000;
/** Satellite imagery only makes sense once the continents look like today's (Human Prehistory onward). */
const SATELLITE_LIMIT = -300_000;
/** Political borders start with the first states (Early Bronze Age). */
const BORDERS_LIMIT = -3500;

// Level-1 Parts are fixed by SPEC.md ("Top-level Parts"); other modules depend on these exact values.
const PARTS = [
  ['hadean', 'Hadean', -4_567_000_000, -4_031_000_000, 6, 15_000_000, 'schematic', 'orange'],
  ['archean', 'Archean', -4_031_000_000, -2_500_000_000, 7, 25_000_000, 'schematic', 'hazy'],
  ['proterozoic', 'Proterozoic', -2_500_000_000, -538_800_000, 9, 25_000_000, 'schematic', 'thin'],
  ['paleozoic', 'Paleozoic', -538_800_000, -251_902_000, 9, 5_000_000, 'paleo', 'normal'],
  ['mesozoic', 'Mesozoic', -251_902_000, -66_000_000, 9, 3_000_000, 'paleo', 'normal'],
  ['cenozoic', 'Cenozoic', -66_000_000, -300_000, 9, 1_000_000, 'paleo', 'normal'],
  ['prehistory', 'Human Prehistory', -300_000, -3_500, 7, 5_000, 'satellite', 'normal'],
  ['ancient', 'Ancient World', -3_500, -500, 8, 33, 'satellite', 'normal'],
  ['classical', 'Classical Antiquity', -500, 500, 8, 11, 'satellite', 'normal'],
  ['postclassical', 'Post-classical Era', 500, 1500, 9, 10, 'satellite', 'normal'],
  ['earlymodern', 'Early Modern', 1500, 1800, 9, 5, 'satellite', 'normal'],
  ['modern', 'Modern Era', 1800, PRESENT, 10, 2, 'satellite', 'normal'],
].map(([id, title, start, end, weight, rate, mode, atmosphere]) => ({ id, title, start, end, weight, rate, mode, atmosphere }));

const CHAPTER_KEYS = new Set(['id', 'title', 'subtitle', 'start', 'end', 'level', 'description', 'planet', 'globeStyle',
  'playbackYearsPerSecond', 'timelineWeight', 'focus', 'children', 'fringeTheories']);
const PLANET_KEYS = new Set(['o2', 'co2', 'temperature', 'seaLevel', 'dayLength', 'life', 'continents', 'humans']);
const STYLE_KEYS = new Set(['mode', 'schematic', 'landColor', 'oceanColor', 'iceCapLatitude', 'atmosphere', 'borders', 'plateBoundaries']);
const FRINGE_KEYS = new Set(['title', 'consensus', 'claim', 'mainstreamView', 'wikipedia']);
const MODES = new Set(['satellite', 'paleo', 'schematic']);
const SCHEMATICS = new Set(['magma', 'cooling', 'waterworld', 'cratons']);
const ATMOSPHERES = new Set(['normal', 'hazy', 'orange', 'thin']);
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const PLANET_MAX = 40;

const file = resolve('src/data/chapters.json');
const errors = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const isStr = (v, max = Infinity) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/**
 * Counts sentences. Common abbreviations are masked first so "c. 2500 BCE" is not a break;
 * decimals ("4.5 billion") never split because a break needs whitespace after the full stop.
 */
function countSentences(text) {
  const masked = text.replace(/\b(?:c|ca|approx|e\.g|i\.e|vs|St|Mt|Dr|Jr|Sr|No)\./g, (m) => m.replace(/\./g, '\u0000'));
  return masked.split(/(?<=[.!?]['"’”)]?)\s+(?=['"‘“(]?[A-Z0-9])/).filter((s) => s.trim()).length;
}

function checkPlanet(where, planet) {
  if (!planet || typeof planet !== 'object' || Array.isArray(planet)) return err(where, 'planet must be an object');
  if (Object.keys(planet).length === 0) err(where, 'planet must state at least one field');
  for (const [k, v] of Object.entries(planet)) {
    if (!PLANET_KEYS.has(k)) err(where, `planet: unknown field "${k}"`);
    else if (!isStr(v, PLANET_MAX)) err(where, `planet.${k} must be a non-empty string ≤ ${PLANET_MAX} chars (got ${JSON.stringify(v)})`);
  }
}

function checkStyle(where, style) {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return err(where, 'globeStyle must be an object');
  for (const [k, v] of Object.entries(style)) {
    if (!STYLE_KEYS.has(k)) err(where, `globeStyle: unknown field "${k}"`);
    else if (k === 'mode' && !MODES.has(v)) err(where, `globeStyle.mode "${v}" invalid`);
    else if (k === 'schematic' && !SCHEMATICS.has(v)) err(where, `globeStyle.schematic "${v}" invalid`);
    else if (k === 'atmosphere' && !ATMOSPHERES.has(v)) err(where, `globeStyle.atmosphere "${v}" invalid`);
    else if ((k === 'landColor' || k === 'oceanColor') && !(typeof v === 'string' && HEX.test(v))) err(where, `globeStyle.${k} must be a hex colour`);
    else if (k === 'iceCapLatitude' && !(typeof v === 'number' && v >= 0 && v <= 90)) err(where, 'globeStyle.iceCapLatitude must be 0–90');
    else if ((k === 'borders' || k === 'plateBoundaries') && typeof v !== 'boolean') err(where, `globeStyle.${k} must be boolean`);
  }
}

function checkFringe(where, list) {
  if (!Array.isArray(list) || list.length === 0) return err(where, 'fringeTheories must be a non-empty array');
  list.forEach((f, i) => {
    const w = `${where} fringeTheories[${i}]`;
    if (!f || typeof f !== 'object') return err(w, 'must be an object');
    for (const k of Object.keys(f)) if (!FRINGE_KEYS.has(k)) err(w, `unknown field "${k}"`);
    if (!isStr(f.title, 60)) err(w, 'title must be 1–60 chars');
    // Every entry carries an explicit label so no consumer can show it as mainstream content.
    if (f.consensus !== 'fringe') err(w, 'consensus must be "fringe"');
    if (!isStr(f.claim) || f.claim.length < 40) err(w, 'claim must be ≥ 40 chars');
    if (!isStr(f.mainstreamView) || f.mainstreamView.length < 40) err(w, 'mainstreamView must be ≥ 40 chars');
    if (f.wikipedia !== undefined && (!isStr(f.wikipedia) || f.wikipedia.includes('http') || f.wikipedia.includes('_'))) {
      err(w, 'wikipedia must be an article TITLE with spaces, not a URL or underscores');
    }
  });
}

const seen = new Set();
const stats = { 1: 0, 2: 0, 3: 0, fringe: 0 };
const tree = [];

/** Validates one node; `inherited` is the effective globe style / rate of its ancestors. */
function checkNode(c, depth, part, inherited) {
  const where = c?.id ?? `(level ${depth} node without id)`;
  if (!c || typeof c !== 'object') return err(where, 'not an object');
  for (const k of Object.keys(c)) if (!CHAPTER_KEYS.has(k)) err(where, `unknown field "${k}"`);

  if (!isStr(c.id) || !KEBAB.test(c.id)) err(where, 'id must be kebab-case');
  else if (seen.has(c.id)) err(where, 'duplicate id');
  else seen.add(c.id);
  if (depth > 1 && typeof c.id === 'string' && !c.id.startsWith(`${part.id}-`)) err(where, `id must start with "${part.id}-"`);
  if (c.level !== depth) err(where, `level must be ${depth} (got ${c.level})`);
  if (!isStr(c.title, 70)) err(where, 'title must be 1–70 chars');
  if (!isStr(c.subtitle, 80)) err(where, 'subtitle must be 1–80 chars');

  const okRange = Number.isFinite(c.start) && Number.isFinite(c.end) && c.start < c.end;
  if (!okRange) err(where, 'start/end must be finite numbers with start < end');
  for (const k of ['start', 'end']) {
    const y = c[k];
    if (!Number.isFinite(y)) continue;
    if (y < TIMELINE_START || y > PRESENT) err(where, `${k} ${y} outside the timeline`);
    if (!Number.isInteger(y) && y !== PRESENT) err(where, `${k} must be a whole year (got ${y})`);
  }

  if (!isStr(c.description)) err(where, 'description required');
  else {
    const n = countSentences(c.description);
    if (n < 2 || n > 5) err(where, `description must have 2–5 sentences (found ${n})`);
    if (!/[.!?]['"’”)]?$/.test(c.description.trim())) err(where, 'description must end with a full stop');
  }
  checkPlanet(where, c.planet);
  if (c.globeStyle !== undefined) checkStyle(where, c.globeStyle);
  if (c.fringeTheories !== undefined) { checkFringe(where, c.fringeTheories); stats.fringe += c.fringeTheories?.length ?? 0; }

  if (c.playbackYearsPerSecond !== undefined && !(Number.isFinite(c.playbackYearsPerSecond) && c.playbackYearsPerSecond > 0)) {
    err(where, 'playbackYearsPerSecond must be > 0');
  }
  if (depth === 1) {
    if (c.timelineWeight !== part.weight) err(where, `timelineWeight must be ${part.weight}`);
    if (c.playbackYearsPerSecond !== part.rate) err(where, `playbackYearsPerSecond must be ${part.rate}`);
    if (c.title !== part.title) err(where, `title must be "${part.title}"`);
    if (c.start !== part.start || c.end !== part.end) err(where, `range must be [${part.start}, ${part.end}]`);
    if (c.globeStyle?.mode !== part.mode) err(where, `globeStyle.mode must be "${part.mode}"`);
    if (c.globeStyle?.atmosphere !== part.atmosphere) err(where, `globeStyle.atmosphere must be "${part.atmosphere}"`);
  } else if (c.timelineWeight !== undefined) err(where, 'timelineWeight is only allowed on level-1 Parts');

  if (c.focus !== undefined) {
    const f = c.focus;
    if (!f || typeof f !== 'object' || !(f.lat >= -90 && f.lat <= 90) || !(f.lon >= -180 && f.lon <= 180)) err(where, 'focus needs lat −90…90 and lon −180…180');
    else if (f.heightKm !== undefined && !(f.heightKm > 0)) err(where, 'focus.heightKm must be > 0');
  }

  // Effective style/rate as the app computes them (children inherit missing fields).
  const style = { ...inherited.style, ...(c.globeStyle ?? {}) };
  const rate = c.playbackYearsPerSecond ?? inherited.rate;
  if (okRange) {
    if (style.mode === 'schematic' && !style.schematic) err(where, 'schematic mode needs a schematic kind');
    if (style.mode === 'paleo' && c.start < PALEO_LIMIT) err(where, 'paleo mode used before 1000 Ma (no plate reconstruction)');
    if (style.mode === 'satellite' && c.start < SATELLITE_LIMIT) err(where, 'satellite mode used before Human Prehistory');
    if (style.borders && c.start < BORDERS_LIMIT) err(where, 'borders drawn before the Early Bronze Age');
  }

  stats[depth] = (stats[depth] ?? 0) + 1;
  tree.push({ c, depth, style, rate });

  if (c.children !== undefined) {
    if (depth === 3) err(where, 'level-3 sections cannot have children');
    else if (!Array.isArray(c.children) || c.children.length === 0) err(where, 'children must be a non-empty array');
    else {
      checkTiling(where, c, c.children);
      for (const child of c.children) checkNode(child, depth + 1, part, { style, rate });
    }
  }
}

/** Children must tile the parent exactly: no gaps, no overlaps, tolerance 0. */
function checkTiling(where, parent, kids) {
  if (kids[0]?.start !== parent.start) err(where, `first child starts at ${kids[0]?.start}, parent at ${parent.start}`);
  if (kids.at(-1)?.end !== parent.end) err(where, `last child ends at ${kids.at(-1)?.end}, parent at ${parent.end}`);
  for (let i = 1; i < kids.length; i++) {
    if (kids[i].start !== kids[i - 1].end) err(where, `gap/overlap between ${kids[i - 1].id} (end ${kids[i - 1].end}) and ${kids[i].id} (start ${kids[i].start})`);
  }
}

/* ───────────── run ───────────── */
let data;
try {
  data = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`chapters.json: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(data)) {
  console.error('chapters.json: top level must be an array of level-1 Parts');
  process.exit(1);
}
if (data.length !== PARTS.length) err('root', `expected ${PARTS.length} Parts, found ${data.length}`);
data.forEach((c, i) => {
  const part = PARTS[i];
  if (!part) return;
  if (c?.id !== part.id) err(c?.id ?? `#${i}`, `Part ${i + 1} must be "${part.id}"`);
  checkNode(c, 1, part, { style: {}, rate: undefined });
});

/* ───────────── tree summary ───────────── */
const fmtYear = (y) => {
  const trim = (n) => String(Number(n.toFixed(3)));
  if (y <= -1e9) return `${trim(-y / 1e9)} Ga`;
  if (y <= -1e6) return `${trim(-y / 1e6)} Ma`;
  if (y <= -1e4) return `${trim(-y / 1e3)} ka`;
  // SPEC year convention: −3500 = 3500 BCE and year 0 displays as 1 BCE.
  if (y < 1) return `${Math.max(1, Math.round(-y))} BCE`;
  return y < 1000 ? `${y} CE` : `${y}`;
};
const fmtSeconds = (s) => (s >= 90 ? `${(s / 60).toFixed(1)} min` : `${s.toFixed(s < 10 ? 1 : 0)} s`);
let total = 0;
for (const { c, depth, style, rate } of tree) {
  if (!Number.isFinite(c.start) || !Number.isFinite(c.end)) continue;
  const span = c.end - c.start;
  const leaf = !c.children?.length;
  if (leaf && rate) total += span / rate;
  const look = style.mode === 'schematic' ? `schematic:${style.schematic}` : style.mode;
  const extras = [
    look,
    `ice ${style.iceCapLatitude ?? '–'}°`,
    style.borders ? 'borders' : '',
    rate ? `${rate.toLocaleString('en-US')} yr/s → ${fmtSeconds(span / rate)}` : '',
    c.fringeTheories?.length ? `${c.fringeTheories.length} fringe` : '',
  ].filter(Boolean).join(' · ');
  console.log(`${'  '.repeat(depth - 1)}${c.id}  "${c.title}"  [${fmtYear(c.start)} → ${fmtYear(c.end)}]  ${extras}`);
}
console.log(
  `\n${stats[1]} parts, ${stats[2]} chapters, ${stats[3]} sections (${stats[1] + stats[2] + stats[3]} nodes), ` +
  `${stats.fringe} labelled fringe theories; full playback at 1× ≈ ${fmtSeconds(total)}`,
);

if (errors.length) {
  console.error(`\n${errors.length} error(s):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('chapters.json OK');
