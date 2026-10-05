import type { Chapter, GlobeStyle, HistoryEvent, Year } from '../types';
import { PRESENT_YEAR, TIMELINE_START } from '../types';
import chaptersJson from './chapters.json';

/* ───────── Events: every src/data/events/*.json is a HistoryEvent[] ───────── */

const eventModules = import.meta.glob<{ default: HistoryEvent[] }>('./events/*.json', { eager: true });

/** All events sorted by year ascending (ties broken by importance desc). */
export const EVENTS: HistoryEvent[] = Object.values(eventModules)
  .flatMap((m) => m.default)
  .sort((a, b) => a.year - b.year || b.importance - a.importance);

const byId = new Map(EVENTS.map((e) => [e.id, e]));
export function getEvent(id: string): HistoryEvent | undefined {
  return byId.get(id);
}

/** Index of the first event with year >= y (binary search). */
export function firstEventIndexAtOrAfter(y: Year): number {
  let lo = 0, hi = EVENTS.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (EVENTS[mid].year < y) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Events with year in [from, to]. */
export function eventsBetween(from: Year, to: Year): HistoryEvent[] {
  const out: HistoryEvent[] = [];
  for (let i = firstEventIndexAtOrAfter(from); i < EVENTS.length && EVENTS[i].year <= to; i++) out.push(EVENTS[i]);
  return out;
}

/** Spans (endYear defined) that contain y. */
export function ongoingEventsAt(y: Year): HistoryEvent[] {
  return EVENTS.filter((e) => e.endYear !== undefined && e.year <= y && y <= e.endYear);
}

/* ───────── Chapters ───────── */

export const CHAPTERS: Chapter[] = chaptersJson as Chapter[];

function walk(list: Chapter[], fn: (c: Chapter, path: Chapter[]) => void, path: Chapter[] = []): void {
  for (const c of list) {
    const p = [...path, c];
    fn(c, p);
    if (c.children) walk(c.children, fn, p);
  }
}

const chapterById = new Map<string, Chapter>();
const chapterPathById = new Map<string, Chapter[]>();
walk(CHAPTERS, (c, p) => { chapterById.set(c.id, c); chapterPathById.set(c.id, p); });

export function getChapter(id: string): Chapter | undefined {
  return chapterById.get(id);
}
export function getChapterPath(id: string): Chapter[] {
  return chapterPathById.get(id) ?? [];
}

/** Part → Chapter → Section containing year y (deepest last). */
export function chapterPathAt(y: Year): Chapter[] {
  const path: Chapter[] = [];
  let list: Chapter[] | undefined = CHAPTERS;
  while (list && list.length) {
    let found: Chapter | undefined = list.find((c) => y >= c.start && y < c.end);
    if (!found) found = y >= list[list.length - 1].end ? list[list.length - 1] : list[0];
    path.push(found);
    list = found.children;
  }
  return path;
}

/** Deepest chapter containing y. */
export function chapterAt(y: Year): Chapter {
  const p = chapterPathAt(y);
  return p[p.length - 1];
}

/** Default playback rate (years per second at 1×) for year y: deepest chapter that defines one. */
export function rateAt(y: Year): number {
  const path = chapterPathAt(y);
  for (let i = path.length - 1; i >= 0; i--) {
    const r = path[i].playbackYearsPerSecond;
    if (r && r > 0) return r;
  }
  return 1_000_000;
}

const DEFAULT_STYLE: GlobeStyle = { mode: 'satellite', atmosphere: 'normal', iceCapLatitude: 75, borders: false };

/** Effective globe style at y: fields inherit from Part → Section. */
export function styleAt(y: Year): GlobeStyle {
  const style: GlobeStyle = { ...DEFAULT_STYLE };
  for (const c of chapterPathAt(y)) Object.assign(style, c.globeStyle ?? {});
  return style;
}

/** All chapters flattened in document order with their depth path. */
export function allChapters(): { chapter: Chapter; path: Chapter[] }[] {
  const out: { chapter: Chapter; path: Chapter[] }[] = [];
  walk(CHAPTERS, (c, p) => out.push({ chapter: c, path: p }));
  return out;
}

export const TIMELINE_RANGE: [Year, Year] = [TIMELINE_START, PRESENT_YEAR];
