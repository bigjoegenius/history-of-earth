/**
 * Visual test harness for the UI (open /ui-test.html on the dev server).
 * Renders createUI over a gradient "globe" with a real Store, a logging mock GlobeController and
 * minimal mock Player / TimelineScale implementing the SPEC signatures, so the UI can be exercised
 * independently of the TIME and GLOBE modules. It also emulates main.ts's per-year wiring.
 *
 * Query params: ?synthetic=1 forces generated events · ?year=-66000000 sets the start year.
 */
import { createUI } from '../ui/index';
import { INTRO_STORAGE_KEY } from '../ui/IntroOverlay';
import { Store, SPEEDS } from '../state/Store';
import { CHAPTERS, EVENTS, chapterPathAt, rateAt, styleAt } from '../data/index';
import { computeVisibleEvents } from '../time/visible';
import type { Player } from '../time/Player';
import type { Segment, TimelineScale } from '../time/TimelineScale';
import type { GlobeController } from '../globe/Globe';
import type { Chapter, EventCategory, HistoryEvent, Speed, Year } from '../types';
import { PRESENT_YEAR, TIMELINE_START } from '../types';

const params = new URLSearchParams(location.search);

/* ───────── Events: real data, or ~60 synthetic ones spanning every Part ───────── */

const CATS: EventCategory[] = ['cosmic', 'geology', 'climate', 'life', 'extinction', 'human-evolution', 'civilization',
  'empire', 'war', 'science', 'technology', 'exploration', 'culture', 'disaster'];

function syntheticEvents(): HistoryEvent[] {
  const out: HistoryEvent[] = [];
  CHAPTERS.forEach((part, p) => {
    const span = part.end - part.start;
    for (let i = 0; i < 5; i++) {
      const n = p * 5 + i;
      const fringe = n % 9 === 4;
      const debated = !fringe && n % 6 === 2;
      out.push({
        id: `synthetic-${part.id}-${i}`,
        title: fringe ? `Synthetic fringe claim ${n}` : `Synthetic ${CATS[n % CATS.length]} event ${n}`,
        year: part.start + span * (0.1 + 0.18 * i),
        endYear: i === 1 ? part.start + span * 0.75 : undefined,
        lat: ((n * 37) % 140) - 70,
        lon: ((n * 71) % 340) - 170,
        global: i === 3,
        category: fringe ? 'fringe' : CATS[n % CATS.length],
        importance: ([5, 4, 3, 2, 1] as const)[i],
        summary: `Generated test event ${n} in the ${part.title} for the UI harness.`,
        description: 'Synthetic data for layout testing only. Real events live in src/data/events/*.json.',
        wikipedia: part.title,
        consensus: fringe ? 'fringe' : debated ? 'debated' : 'established',
        mainstreamView: fringe || debated ? 'Synthetic mainstream note: what the evidence actually shows would appear here.' : undefined,
      });
    }
  });
  return out.sort((a, b) => a.year - b.year);
}

const events = params.has('synthetic') || EVENTS.length < 50 ? syntheticEvents() : EVENTS;

/* ───────── Mock TimelineScale: piecewise linear over the Parts, width ∝ timelineWeight ───────── */

class MockScale {
  private readonly segs: Segment[];
  constructor(parts: Chapter[]) {
    const total = parts.reduce((a, c) => a + (c.timelineWeight ?? 1), 0);
    let acc = 0;
    this.segs = parts.map((chapter) => {
      const p0 = acc / total;
      acc += chapter.timelineWeight ?? 1;
      return { chapter, p0, p1: acc / total };
    });
  }
  private segAt(y: Year): Segment {
    return this.segs.find((s) => y < s.chapter.end) ?? this.segs[this.segs.length - 1];
  }
  toPosition(y: Year): number {
    const s = this.segAt(y);
    const t = Math.min(1, Math.max(0, (y - s.chapter.start) / (s.chapter.end - s.chapter.start)));
    return s.p0 + t * (s.p1 - s.p0);
  }
  toYear(p: number): Year {
    const q = Math.min(1, Math.max(0, p));
    const s = this.segs.find((x) => q < x.p1) ?? this.segs[this.segs.length - 1];
    return s.chapter.start + ((q - s.p0) / (s.p1 - s.p0)) * (s.chapter.end - s.chapter.start);
  }
  segments(): Segment[] {
    return this.segs;
  }
  partAt(y: Year): Chapter {
    return this.segAt(y).chapter;
  }
  detailRangeFor(c: Chapter): [Year, Year] {
    return [c.start, c.end];
  }
}

/* ───────── Mock Player: plain Euler steps on requestAnimationFrame ───────── */

class MockPlayer {
  private frame = 0;
  private last = 0;
  constructor(private readonly store: Store) {
    store.on('playing', (playing) => (playing ? this.start() : cancelAnimationFrame(this.frame)));
  }
  play(): void {
    const { year, direction } = this.store.get();
    if (direction === 1 && year >= PRESENT_YEAR) this.store.setYear(TIMELINE_START);
    if (direction === -1 && year <= TIMELINE_START) this.store.setYear(PRESENT_YEAR);
    this.store.set({ playing: true });
  }
  pause(): void { this.store.set({ playing: false }); }
  toggle(): void { if (this.store.get().playing) this.pause(); else this.play(); }
  setSpeed(s: Speed): void { this.store.set({ speed: s }); }
  faster(): void { this.shift(1); }
  slower(): void { this.shift(-1); }
  setDirection(d: 1 | -1): void { this.store.set({ direction: d }); }
  jumpTo(y: Year): void { this.store.setYear(y); }
  stepToNextEvent(filter?: (e: HistoryEvent) => boolean): void {
    const y = this.store.get().year;
    const e = events.find((x) => x.year > y && (!filter || filter(x)));
    if (e) this.jumpTo(e.year);
  }
  stepToPrevEvent(filter?: (e: HistoryEvent) => boolean): void {
    const y = this.store.get().year;
    const e = [...events].reverse().find((x) => x.year < y && (!filter || filter(x)));
    if (e) this.jumpTo(e.year);
  }
  currentRate(): number {
    const { year, speed, direction } = this.store.get();
    return rateAt(year) * speed * direction;
  }
  destroy(): void { cancelAnimationFrame(this.frame); }
  private shift(delta: 1 | -1): void {
    const i = SPEEDS.indexOf(this.store.get().speed);
    this.setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, i + delta))]);
  }
  private start(): void {
    this.last = performance.now();
    const tick = (now: number): void => {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      const { year, direction } = this.store.get();
      this.store.setYear(year + this.currentRate() * dt);
      const y = this.store.get().year;
      if ((direction === 1 && y >= PRESENT_YEAR) || (direction === -1 && y <= TIMELINE_START)) this.pause();
      else this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
}

/* ───────── Mock globe: logs calls (per-frame ones only counted) ───────── */

const counts = { setYear: 0, setEvents: 0 };
let markerClick: ((id: string) => void) | null = null;
const globe: GlobeController = {
  setYear: () => { counts.setYear++; },
  setEvents: () => { counts.setEvents++; },
  setSelected: (id) => console.log('[globe] setSelected', id),
  flyToEvent: (ev) => console.log('[globe] flyToEvent', ev.id, ev.global ? '(global: zoom out)' : `${ev.lat}, ${ev.lon}`),
  flyTo: (lat, lon, km) => console.log('[globe] flyTo', lat, lon, km),
  setSettings: (s) => console.log('[globe] setSettings', s),
  onEventClick: (cb) => { markerClick = cb; },
  pulse: (id) => console.log('[globe] pulse', id),
  destroy: () => console.log('[globe] destroy'),
};

/* ───────── Wiring (emulates main.ts) ───────── */

const startYear = Number(params.get('year') ?? TIMELINE_START);
const startPart = chapterPathAt(startYear)[0];
const store = new Store({ year: startYear, detailRange: [startPart.start, startPart.end] });
const player = new MockPlayer(store);
const scale = new MockScale(CHAPTERS);

const ui = createUI({
  root: document.getElementById('app')!,
  store,
  player: player as unknown as Player,
  scale: scale as unknown as TimelineScale,
  globe,
  events,
});

let shown = new Set<string>();
store.on('year', (y) => {
  const path = chapterPathAt(y);
  const [r0, r1] = store.get().detailRange;
  store.set({
    chapterPath: path.map((c) => c.id),
    // Follow the playhead into the next Part, as main.ts does.
    ...(y < r0 || y > r1 ? { detailRange: [path[0].start, path[0].end] as [Year, Year] } : {}),
  });
  globe.setYear(y, styleAt(y));
  const chapter = path[1] ?? path[0];
  const vis = computeVisibleEvents(y, player.currentRate(), store.get().settings, chapter.end - chapter.start, events);
  const ids = [...vis.recent, ...vis.ongoing].map((e) => e.id);
  const fresh = store.get().playing ? ids.filter((id) => !shown.has(id)) : [];
  shown = new Set(ids);
  store.set({ visibleEventIds: [...ids, ...vis.upcoming.map((e) => e.id)] });
  globe.setEvents([...vis.recent, ...vis.ongoing]);
  if (fresh.length) ui.notifyNewEvents(fresh);
});

/* ───────── Dev tools ───────── */

const globeEl = document.getElementById('globe')!;
let globeClicks = 0;
const tools = document.createElement('details');
tools.className = 'dev-tools';
tools.append(Object.assign(document.createElement('summary'), { textContent: 'dev' }));
const status = document.createElement('span');
const addTool = (label: string, fn: () => void): void => {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = fn;
  tools.append(b);
};
addTool('Reset intro', () => {
  localStorage.removeItem(INTRO_STORAGE_KEY);
  location.reload();
});
addTool('Bright globe', () => globeEl.classList.toggle('is-bright'));
addTool('Ping visible', () => ui.notifyNewEvents(store.get().visibleEventIds.slice(0, 2)));
addTool('Marker click', () => {
  const id = store.get().visibleEventIds[0];
  if (id && markerClick) markerClick(id);
});
tools.append(status);
document.body.append(tools);
globeEl.addEventListener('pointerdown', () => { globeClicks++; });
setInterval(() => {
  status.textContent = `globe clicks ${globeClicks} · setYear ${counts.setYear} · events ${events.length}`;
}, 500);

Object.assign(window, { __hoe: { store, player, scale, ui, events } });
