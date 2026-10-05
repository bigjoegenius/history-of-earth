# History of Earth — Architecture & Content Spec

A single-page web app: a Google-Earth-style 3D globe (CesiumJS) with a time scrubber spanning
4.567 billion years. As time plays, the globe redraws (plate reconstructions, ice, borders) and
events appear in a side panel with short explanations and "learn more" details.
Target: a static website (Vite build → `dist/`). No API keys required.

**Content principle:** mainstream, well-sourced science and history. Dating uncertainty and
genuine debates are stated. Fringe theories are *included but clearly labelled* (`consensus: "fringe"`,
category `fringe`, with a `mainstreamView` explaining what the evidence actually shows).

## Stack
- Vite 8 + TypeScript (strict), vanilla DOM (no framework). Vitest for unit tests.
- CesiumJS 1.146 (`import * as Cesium from 'cesium'`). Static assets are copied to `public/cesium`
  by `scripts/copy-cesium.mjs` (postinstall); `CESIUM_BASE_URL` is defined in `vite.config.ts`.
- Imagery (no keys): NASA GIBS Blue Marble (WMTS EPSG:4326, `500m` matrix set, max level 8) as base;
  optional ESRI World Imagery (`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`)
  for zoomed-in detail when `settings.highResImagery`.
- Data served from `public/data/` (see "Data pipeline").
- Dev server is already running at http://localhost:5173 (`npm run dev`, hot reload). Do not start another.

## Repository layout and OWNERSHIP (agents only edit what they own)
```
src/types.ts                 shared contracts (READ ONLY for agents)
src/state/Store.ts           reactive store (READ ONLY)
src/data/index.ts            data access helpers (READ ONLY)
src/data/categories.ts       category colours/icons (READ ONLY)
src/data/chapters.json       table of contents        → CHAPTERS agent
src/data/events/<era>.json   events                   → one EVENTS agent per file
src/time/                    TimeModel, TimelineScale, Player (+ tests)   → TIME agent
src/globe/                   Cesium globe + layers                        → GLOBE agent
src/ui/  src/styles/         timeline bar, panels, controls, drawer, CSS  → UI agent
src/main.ts                  wiring                                       → INTEGRATION agent
scripts/fetch-paleo.mjs, scripts/fetch-borders.mjs, public/data/**        → PIPELINE agent
scripts/validate-events.mjs  validator (READ ONLY; run it: `npm run data:validate`)
```

## Year convention
See `src/types.ts`. One continuous number: positive CE, negative BCE (−3500 = 3500 BCE),
deep time as large negatives (−66_000_000). Fractional allowed. `TIMELINE_START = -4_567_000_000`,
`PRESENT_YEAR = 2026.75`.

Display rules (TimeModel.formatYear):
- year ≤ −1_000_000_000 → "4.54 billion years ago" (2 decimals; trim trailing zeros)
- year ≤ −1_000_000 → "66 million years ago" / "2.6 million years ago"
- year ≤ −10_000 → "300,000 years ago" / "12,000 years ago"  (ago = PRESENT − year, rounded to 3 significant figures)
- −10_000 < year < 1 → "3,500 BCE"  (−3500 → 3500 BCE; year 0 displays as 1 BCE)
- 1 ≤ year < 1000 → "476 CE";  year ≥ 1000 → "1492"
- `formatYear(y, { month: true })` adds the month for |rate| small: "August 1914" (fraction → month).
- `formatYearShort` for ticks: "4.5 Ga", "66 Ma", "300 ka", "3500 BCE", "1492".
- Every event may carry `dateLabel` which overrides formatting in cards.

## Top-level Parts (level-1 chapters; ids FIXED — other modules depend on them)
| id | title | start | end | weight | 1× rate (yr/s) |
|---|---|---|---|---|---|
| hadean | Hadean | −4,567,000,000 | −4,031,000,000 | 6 | 15,000,000 |
| archean | Archean | −4,031,000,000 | −2,500,000,000 | 7 | 25,000,000 |
| proterozoic | Proterozoic | −2,500,000,000 | −538,800,000 | 9 | 25,000,000 |
| paleozoic | Paleozoic | −538,800,000 | −251,902,000 | 9 | 5,000,000 |
| mesozoic | Mesozoic | −251,902,000 | −66,000,000 | 9 | 3,000,000 |
| cenozoic | Cenozoic | −66,000,000 | −300,000 | 9 | 1,000,000 (Quaternary section overrides lower) |
| prehistory | Human Prehistory | −300,000 | −3,500 | 7 | 5,000 (Holocene/Neolithic sections override lower) |
| ancient | Ancient World | −3,500 | −500 | 8 | 33 |
| classical | Classical Antiquity | −500 | 500 | 8 | 11 |
| postclassical | Post-classical Era | 500 | 1500 | 9 | 10 |
| earlymodern | Early Modern | 1500 | 1800 | 9 | 5 |
| modern | Modern Era | 1800 | 2026.75 | 10 | 2 |

Boundaries follow the ICS 2023 chart (Hadean/Archean 4031 Ma, Proterozoic/Phanerozoic 538.8 Ma, P/T 251.902 Ma, K/Pg 66.0 Ma).
Children (level 2 = chapters, level 3 = sections) tile their parent's range exactly (first child.start == parent.start,
last child.end == parent.end, contiguous). Deepest chapter's `playbackYearsPerSecond` and `globeStyle` win (inherit).

## Overview scrubber mapping (TimelineScale)
Position p ∈ [0,1] ↦ year: piecewise linear over level-1 Parts, each Part occupying width ∝ `timelineWeight`.
Inside a Part the mapping is linear. Provide `toPosition(year)`, `toYear(p)`, `segments()` (for drawing labels),
and `detailRangeFor(chapter)`.

## Playback (Player)
- rAF loop; each frame `year += rateAt(year) * speed * direction * dt`. Clamp to [TIMELINE_START, PRESENT_YEAR]; auto-pause at ends.
- `speed` ∈ SPEEDS (store). `play/pause/toggle/setSpeed/setDirection/stepToNextEvent/stepToPrevEvent/jumpTo(year)`.
- Writes `store.year`. Nothing else writes `year` during playback except user scrubbing/jumps (which call `player.jumpTo`).

## "Now" panel semantics (UI)
At year t with rate r = rateAt(t)×speed:
- Recent: events with t − W ≤ year ≤ t that are not still running (point events, plus spans that started in the window and have already ended), newest first, where W = max(r × 20 s, 0.5% of the current level-2 chapter span). Within each section, fringe entries are listed after mainstream ones.
- Ongoing: spans with year ≤ t ≤ endYear.
- Up next: the next 3 events after t (dimmed).
- Filter by `settings.minImportance` and hide `consensus:"fringe"` when `settings.showFringe` is false.
- Newly arrived events animate in and briefly pulse their globe marker.
- Clicking a card selects it (`store.selectedEventId`), opens the detail drawer and flies the camera (unless global).
- Detail drawer: title, date (dateLabel or formatYear), category chip, consensus badge (fringe = grey dashed "Fringe theory"
  badge + a boxed "What mainstream scholarship says" section showing `mainstreamView`; debated = amber badge + same box),
  description, Wikipedia extract + thumbnail fetched from `https://en.wikipedia.org/api/rest_v1/page/summary/<title>`
  (CORS OK; cache in memory; handle 404), "Read on Wikipedia" link, "Fly here" button.
- Era header: current Part › Chapter › Section titles, deepest description, PlanetState chips (O₂, CO₂, temp, sea level, life…),
  and a "Reconstruction: satellite / plate model (Merdith 2021) / illustrative" badge based on `styleAt(year).mode`.

## Globe (GlobeController) — `src/globe/Globe.ts`
```ts
export interface GlobeController {
  setYear(year: Year, style: GlobeStyle): void;      // called on every year change (cheap; loads snapshots lazily & debounced)
  setEvents(events: HistoryEvent[]): void;            // markers to show (visible set)
  setSelected(id: string | null): void;
  flyToEvent(ev: HistoryEvent): void;                 // smooth flyTo; global events → gentle zoom-out instead
  flyTo(lat: number, lon: number, heightKm?: number): void;
  setSettings(s: Settings): void;
  onEventClick(cb: (id: string) => void): void;
  pulse(id: string): void;                            // brief marker highlight
  destroy(): void;
}
export function createGlobe(container: HTMLElement): Promise<GlobeController>;
```
Rendering by `GlobeStyle.mode`:
- `satellite`: GIBS base layer (+ ESRI when highResImagery, `minimumTerrainLevel` ~5 so it only appears zoomed in). Ice caps overlay from `iceCapLatitude`.
- `paleo`: hide imagery; globe baseColor = oceanColor; draw coastline polygons of the nearest snapshot in `landColor`
  from `/data/paleo/coastlines_{age}.json` (index `/data/paleo/index.json`); cross-fade when the snapshot changes;
  prefetch neighbours; plate boundaries optional. Ice caps overlay.
- `schematic`: hide imagery; a deterministic procedural texture (`SingleTileImageryProvider` from a canvas, seeded noise)
  per `SchematicKind`: magma (glowing orange/black crust), cooling (black basalt, red cracks, first water), waterworld
  (dark blue ocean, scattered volcanic islands), cratons (dark ocean with a few grey-brown continents). Lower-res is fine.
- Atmosphere per `AtmosphereKind` via `scene.skyAtmosphere` hue/saturation/brightness (orange = Hadean, hazy = Archean methane haze).
- Borders (when `style.borders && settings.showBorders`): nearest snapshot ≤ year from `/data/borders/index.json`;
  fill = hashed colour per `name` at ~35% alpha, thin outline, label at centroid for large polygons when `settings.showLabels`.
- Markers: `BillboardCollection`/`PointPrimitiveCollection` + `LabelCollection` coloured by category, importance → size;
  selected marker gets a ring; `global` events get no marker (UI banner instead). Picking via ScreenSpaceEventHandler.
- Lighting toggle (`scene.globe.enableLighting`). Camera: default view over the Atlantic, height ~20,000 km.
- Performance: `requestRenderMode: true` with explicit `scene.requestRender()` on changes; snapshot loads cached in a Map.

## Data pipeline (`public/data`, generated by scripts — committed to the repo so the site is self-contained)
- `scripts/fetch-paleo.mjs`: GPlates Web Service `https://gws.gplates.org/reconstruct/coastlines/?time={age}&model=MERDITH2021`
  for ages 0,5,10,…,540 then 560,580,…,1000 (every 20). Simplify with `@turf/simplify` (tolerance ~0.15°, highQuality false),
  round coords to 2 decimals, drop tiny polygons (< 0.05 deg² area). Target ≤ 120 KB per file. Write `paleo/index.json` (PaleoIndex).
  Attribution: "Merdith et al. 2021 plate model via GPlates Web Service". Retry with backoff; 3 concurrent requests max.
  Optional: `topology/plate_boundaries/?time=…&model=MERDITH2021` if it works (`plateBoundaries` template).
- `scripts/fetch-borders.mjs`: https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson/world_{tag}.geojson
  for all available tags (`world_bc123000` … `world_2010`), normalise properties to `{name, subject, partOf}` (from NAME, SUBJECTO, PARTOF),
  simplify lightly (0.05°), round to 3 decimals, write `borders/world_{year}.json` using the YEAR CONVENTION (bc123000 → −123000),
  plus `borders/world_2026.json` from Natural Earth 110m admin-0 (`https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson`,
  name from `NAME`). Write `borders/index.json` (BordersIndex). Attribution: "historical-basemaps (aourednik, GPL-3.0); Natural Earth (public domain)".
- Both scripts: idempotent, skip existing files unless `--force`, print a summary table.

## Events — authoring rules (one JSON array per file, `HistoryEvent[]`)
- Validate with `npm run data:validate` (must pass: 0 errors).
- id prefixed with the file name; lat/lon of the most representative place; `global:true` for planet-wide events.
- Dates: mainstream values; `uncertainty` for approximate ones; `dateLabel` for nice display ("c. 4.51 billion years ago").
- `importance`: 5 = landmark (≈10% of events), 4 ≈ 20%, 3 ≈ 35%, 2 ≈ 25%, 1 ≈ 10%.
- `summary` ≤ 160 chars, one sentence, concrete. `description` 2–6 sentences, neutral encyclopaedic tone, no bullet points.
- `wikipedia`: exact article title with spaces ("Great Oxidation Event"). Prefer it on every event.
- Spans use `endYear` (wars, dynasties, periods, migrations).
- `paleoLat`/`paleoLon` (optional, generated — never hand-written): the event's position reconstructed to its age with the
  Merdith 2021 model via `scripts/reconstruct-event-points.mjs` (GPlates `reconstruct/points`). The globe uses them instead of
  `lat`/`lon` whenever `styleAt(year).mode === 'paleo'` (markers and fly-to).
- Fringe theories: a few per era where they exist, `category: "fringe"`, `consensus: "fringe"`, `mainstreamView` required.
  Examples: expanding Earth, Atlantis, ancient astronauts, Younger Dryas impact (debated, not fringe), phantom time,
  1421 Chinese discovery of America, Silurian hypothesis (thought experiment → tag as fringe with a fair note), hollow Earth,
  pre-Clovis (now mainstream → established), Solutrean hypothesis (fringe/minority), New Chronology.

## UI layout (dark glass over the globe, Google-Earth feel; responsive)
- Top: overview scrubber (Part labels, playhead, hover year, drag to scrub, click to jump) + detail ruler (current Part
  or selected chapter, linear, event ticks coloured by category, chapter sub-bands). Big year readout.
- Bottom centre: ⏮ prev event · ⏯ play/pause · ⏭ next event · speed menu · direction · jump chips
  (Formation · First life · Dinosaurs · Humans · Now) · Tour toggle · Settings popover.
- Left: TOC drawer (tree, click to jump & zoom detail ruler; shows current path; search box).
- Right: Now panel (era header + event cards) and detail drawer.
- Keyboard: Space play/pause · ←/→ prev/next event · ,/. slower/faster · T TOC · Esc close · F fringe toggle.
- Credits footer: NASA GIBS, ESRI, GPlates/Merdith 2021, historical-basemaps, Natural Earth, Wikipedia.

## Module APIs (exact signatures — other modules compile against these)

```ts
// src/time/TimeModel.ts  (TIME agent)
export function presentYear(): Year;                                     // fractional current year, e.g. 2026.75
export function yearsAgo(y: Year): number;
export function formatYear(y: Year, opts?: { month?: boolean }): string; // rules in "Year convention"
export function formatYearShort(y: Year): string;                        // "4.5 Ga" · "66 Ma" · "300 ka" · "3500 BCE" · "1492"
export function formatDuration(years: number): string;                   // "2.3 million years" · "150 years"
export function formatEventDate(e: HistoryEvent): string;                // dateLabel ?? formatYear (+ " – end" for spans)
export function niceTickStep(span: number, targetTicks: number): number; // 1-2-5 progression
export function yearToMonthFraction(y: Year): { year: number; month: number }; // month 0–11

// src/time/TimelineScale.ts  (TIME agent)
export interface Segment { chapter: Chapter; p0: number; p1: number }    // p in [0,1]
export class TimelineScale {
  constructor(parts: Chapter[]);                                         // level-1 chapters with timelineWeight
  toPosition(y: Year): number;                                           // clamps to [0,1]
  toYear(p: number): Year;
  segments(): Segment[];
  partAt(y: Year): Chapter;
}

// src/time/Player.ts  (TIME agent)
export class Player {
  constructor(store: Store, rateAt: (y: Year) => number, events: HistoryEvent[]);
  play(): void; pause(): void; toggle(): void;
  setSpeed(s: Speed): void; faster(): void; slower(): void;
  setDirection(d: 1 | -1): void;
  jumpTo(y: Year): void;                                                 // pauses? NO – keeps playing state, just moves
  stepToNextEvent(filter?: (e: HistoryEvent) => boolean): void;          // jumps to next event year > current (uses filter for importance/fringe)
  stepToPrevEvent(filter?: (e: HistoryEvent) => boolean): void;
  currentRate(): number;                                                 // rateAt(year) × speed (years per second, signed by direction)
  destroy(): void;
}

// src/time/visible.ts  (TIME agent) — pure, unit-tested
export interface VisibleEvents { recent: HistoryEvent[]; ongoing: HistoryEvent[]; upcoming: HistoryEvent[]; window: number }
export function eventFilter(settings: Settings): (e: HistoryEvent) => boolean;   // minImportance + fringe
export function computeVisibleEvents(year: Year, rateYearsPerSec: number, settings: Settings, chapterSpan: number, events: HistoryEvent[]): VisibleEvents;
// recent: year-W ≤ e.year ≤ year, newest first, max 12; W = max(|rate|×20, chapterSpan×0.005); ongoing: spans containing year; upcoming: next 3 after year.

// src/globe/Globe.ts  (GLOBE agent) — see "Globe" above
export function createGlobe(container: HTMLElement): Promise<GlobeController>;

// src/ui/index.ts  (UI agent)
export interface UIContext { root: HTMLElement; store: Store; player: Player; scale: TimelineScale; globe: GlobeController; events: HistoryEvent[]; }
export function createUI(ctx: UIContext): { destroy(): void; notifyNewEvents(ids: string[]): void };
// The UI reads EVENTS/CHAPTERS helpers from src/data/index.ts, computeVisibleEvents from src/time/visible.ts,
// formatting from src/time/TimeModel.ts, and reacts to store changes. It must not write `year` except via player.jumpTo.

// src/main.ts (INTEGRATION agent)
// createGlobe → new Store({year: TIMELINE_START}) → Player → TimelineScale(CHAPTERS) → createUI.
// On store.year change: update chapterPath/detailRange, compute visible events → store.visibleEventIds, globe.setYear(y, styleAt(y)),
// globe.setEvents(recent ∪ ongoing), Tour: fly to new importance-5 events while playing; call ui.notifyNewEvents(newIds).
// URL hash sync (#y=-66000000) for deep links. Start paused at TIMELINE_START with a brief intro overlay ("Press play").
```
