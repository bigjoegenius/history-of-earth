/**
 * Which events the "Now" panel shows at a given moment (SPEC "Now panel semantics").
 * Pure apart from a per-array span index cache; called every frame, so every query is
 * O(log n + k) on the year-sorted events array instead of a full scan.
 */
import type { HistoryEvent, Settings, Year } from '../types';

export interface VisibleEvents { recent: HistoryEvent[]; ongoing: HistoryEvent[]; upcoming: HistoryEvent[]; window: number }

const MAX_RECENT = 12;
const MAX_ONGOING = 8;
const MAX_UPCOMING = 3;
/** Recent window covers the last 20 s of playback… */
const WINDOW_SECONDS = 20;
/** …but never less than 0.5% of the current chapter, so paused/slow views still show context. */
const WINDOW_CHAPTER_FRACTION = 0.005;

/** Settings-driven filter: importance threshold, and fringe theories only when enabled. */
export function eventFilter(settings: Settings): (e: HistoryEvent) => boolean {
  const { minImportance, showFringe } = settings;
  return (e) => e.importance >= minImportance && (showFringe || e.consensus !== 'fringe');
}

/** Index of the first event with year ≥ y in a year-sorted array (events.length if none). */
export function firstIndexAtOrAfter(events: readonly HistoryEvent[], y: Year): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].year < y) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Index of the first event with year > y in a year-sorted array (events.length if none). */
export function firstIndexAfter(events: readonly HistoryEvent[], y: Year): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].year <= y) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export function computeVisibleEvents(
  year: Year,
  rateYearsPerSec: number,
  settings: Settings,
  chapterSpan: number,
  events: HistoryEvent[],
): VisibleEvents {
  const keep = eventFilter(settings);
  const window = Math.max(Math.abs(rateYearsPerSec) * WINDOW_SECONDS, chapterSpan * WINDOW_CHAPTER_FRACTION);
  const after = firstIndexAfter(events, year);

  // Recent: walk back from `year`. Keep collecting past the cap while still on the same year as the
  // last pick, so a cut between same-year events drops the least important one, not an arbitrary one.
  // Spans that started inside the window and have already ended count too: a short span (a battle,
  // the Hiroshima bombing) can begin and end between two frames and would otherwise never be shown.
  // Spans still running belong to `ongoing`, so the two lists never share an event.
  const candidates: HistoryEvent[] = [];
  for (let i = after - 1; i >= 0 && events[i].year >= year - window; i--) {
    const e = events[i];
    if (candidates.length >= MAX_RECENT && e.year < candidates[candidates.length - 1].year) break;
    if ((e.endYear === undefined || e.endYear < year) && keep(e)) candidates.push(e);
  }
  const recent = candidates
    .sort((a, b) => b.year - a.year || b.importance - a.importance)
    .slice(0, MAX_RECENT);

  const ongoing = spanIndex(events)
    .containing(year)
    .filter(keep)
    .sort((a, b) => b.importance - a.importance || a.year - b.year)
    .slice(0, MAX_ONGOING);

  const upcoming: HistoryEvent[] = [];
  for (let i = after; i < events.length && upcoming.length < MAX_UPCOMING; i++) {
    if (keep(events[i])) upcoming.push(events[i]);
  }

  return { recent, ongoing, upcoming, window };
}

/* ───────────── Span index: centered interval tree, built once per events array ───────────── */

interface SpanNode {
  center: Year;
  /** Spans containing `center`, by start ascending. */
  byStart: HistoryEvent[];
  /** The same spans by end descending. */
  byEnd: HistoryEvent[];
  left?: SpanNode;   // spans entirely before center
  right?: SpanNode;  // spans entirely after center
}

interface SpanIndex { containing(y: Year): HistoryEvent[] }

/** Keyed by array identity: the events array is treated as immutable once loaded. */
const spanIndexCache = new WeakMap<readonly HistoryEvent[], SpanIndex>();

function spanIndex(events: readonly HistoryEvent[]): SpanIndex {
  let index = spanIndexCache.get(events);
  if (!index) {
    const root = buildNode(events.filter((e) => e.endYear !== undefined));
    index = { containing: (y) => { const out: HistoryEvent[] = []; queryNode(root, y, out); return out; } };
    spanIndexCache.set(events, index);
  }
  return index;
}

function end(e: HistoryEvent): Year {
  return e.endYear ?? e.year;
}

function buildNode(spans: HistoryEvent[]): SpanNode | undefined {
  if (spans.length === 0) return undefined;
  // Median endpoint as the center keeps the tree balanced (depth O(log n)).
  const points = spans.flatMap((e) => [e.year, end(e)]).sort((a, b) => a - b);
  const center = points[points.length >> 1];
  const here = spans.filter((e) => e.year <= center && center <= end(e));
  return {
    center,
    byStart: [...here].sort((a, b) => a.year - b.year),
    byEnd: [...here].sort((a, b) => end(b) - end(a)),
    left: buildNode(spans.filter((e) => end(e) < center)),
    right: buildNode(spans.filter((e) => e.year > center)),
  };
}

function queryNode(node: SpanNode | undefined, y: Year, out: HistoryEvent[]): void {
  while (node) {
    if (y < node.center) {
      // Every span here ends at/after center > y, so only the start needs checking.
      for (const e of node.byStart) { if (e.year > y) break; out.push(e); }
      node = node.left;
    } else if (y > node.center) {
      for (const e of node.byEnd) { if (end(e) < y) break; out.push(e); }
      node = node.right;
    } else {
      out.push(...node.byStart);
      return;
    }
  }
}
