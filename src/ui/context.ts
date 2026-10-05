/**
 * Shared dependencies handed to every UI component: the injected services plus a few derived,
 * change-filtered values (chapter path, visible events) so components never recompute them per frame.
 */
import type { Store } from '../state/Store';
import type { Player } from '../time/Player';
import type { TimelineScale } from '../time/TimelineScale';
import type { GlobeController } from '../globe/Globe';
import type { Chapter, HistoryEvent, Settings, Year } from '../types';
import { PRESENT_YEAR, TIMELINE_START } from '../types';
import { chapterPathAt } from '../data/index';
import { computeVisibleEvents, eventFilter, type VisibleEvents } from '../time/visible';
import { formatYearShort } from '../time/TimeModel';
import { Signal } from './signal';
import type { Disposer } from './dom';
import type { UIContext } from './index';

export interface UIDeps {
  /** The `.hoe-ui` overlay element (fixed, full-screen, pointer-events: none). */
  root: HTMLElement;
  store: Store;
  player: Player;
  scale: TimelineScale;
  globe: GlobeController;
  /** ctx.events sorted by year (ties: importance desc). */
  events: HistoryEvent[];
  /** Subset of `events` with an endYear. */
  spans: HistoryEvent[];
  byId: ReadonlyMap<string, HistoryEvent>;
  /** Part → Chapter → Section at the current year; fires only when the ids change. */
  path: Signal<Chapter[]>;
  /** Now-panel lists; fires only when an id list or the window changes. */
  visible: Signal<VisibleEvents>;
  /** True below the 800 px breakpoint (bottom-sheet layout). */
  mobile: Signal<boolean>;
  /** eventFilter(settings), memoised per settings object. */
  filter(): (e: HistoryEvent) => boolean;
  /** Selects an event (opens the detail drawer); `fly` also moves the camera unless the event is global. */
  selectEvent(id: string | null, opts?: { fly?: boolean }): void;
  /** TOC jump: move time to the chapter start and zoom the detail ruler to it. */
  jumpToChapter(c: Chapter): void;
  /** Era jump (chips, Home/End): move time and show the whole Part on the detail ruler. */
  jumpToEra(y: Year): void;
  /** Pause while the user drags a timeline, then resume if it was playing. */
  beginScrub(): void;
  endScrub(): void;
  toast(message: string): void;
}

/** Mirrors the CSS phone breakpoint (bottom-sheet layout). */
const MOBILE_QUERY = '(max-width: 799px)';

/** Index of the first event with year ≥ y in a year-sorted array. */
export function lowerBound(events: readonly HistoryEvent[], y: Year): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].year < y) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** "66 Ma – 2.58 Ma"; a chapter running to the present ends in "now" rather than a month label. */
export function chapterRange(c: Chapter): string {
  return `${formatYearShort(c.start)} – ${c.end >= PRESENT_YEAR ? 'now' : formatYearShort(c.end)}`;
}

const sameIds = (a: readonly { id: string }[], b: readonly { id: string }[]): boolean =>
  a.length === b.length && a.every((x, i) => x.id === b[i].id);

const sameVisible = (a: VisibleEvents, b: VisibleEvents): boolean =>
  a.window === b.window && sameIds(a.recent, b.recent) && sameIds(a.ongoing, b.ongoing) && sameIds(a.upcoming, b.upcoming);

export function createDeps(ctx: UIContext, root: HTMLElement, toast: (m: string) => void, d: Disposer): UIDeps {
  const { store, player, scale, globe } = ctx;
  const events = [...ctx.events].sort((a, b) => a.year - b.year || b.importance - a.importance);
  const spans = events.filter((e) => e.endYear !== undefined);
  const byId = new Map(events.map((e) => [e.id, e]));

  let filterSettings: Settings | null = null;
  let cachedFilter: (e: HistoryEvent) => boolean = () => true;
  const filter = (): ((e: HistoryEvent) => boolean) => {
    const s = store.get().settings;
    if (s !== filterSettings) {
      filterSettings = s;
      cachedFilter = eventFilter(s);
    }
    return cachedFilter;
  };

  const path = new Signal<Chapter[]>(chapterPathAt(store.get().year), sameIds);
  const computeVisible = (): VisibleEvents => {
    const { year, settings } = store.get();
    const p = path.get();
    const chapter = p[1] ?? p[0];
    // SPEC: the recent window scales with the current level-2 chapter.
    const span = chapter ? chapter.end - chapter.start : PRESENT_YEAR - TIMELINE_START;
    return computeVisibleEvents(year, player.currentRate(), settings, span, events);
  };
  const visible = new Signal<VisibleEvents>(computeVisible(), sameVisible);
  const refresh = (): void => {
    path.set(chapterPathAt(store.get().year));
    visible.set(computeVisible());
  };
  for (const key of ['year', 'speed', 'direction', 'settings'] as const) d.add(store.on(key, refresh));

  const mq = window.matchMedia(MOBILE_QUERY);
  const mobile = new Signal(mq.matches);
  d.listen<MediaQueryListEvent>(mq, 'change', (e) => mobile.set(e.matches));

  let resumeAfterScrub = false;

  return {
    root, store, player, scale, globe, events, spans, byId, path, visible, mobile, filter, toast,

    selectEvent(id, opts) {
      store.set({ selectedEventId: id });
      const ev = id ? byId.get(id) : undefined;
      if (ev && opts?.fly && !ev.global) globe.flyToEvent(ev);
    },

    jumpToChapter(c) {
      // jumpTo first: whoever reacts to the year change may reset detailRange; ours must win.
      player.jumpTo(c.start);
      store.set({ detailRange: [c.start, c.end], tocOpen: false });
      if (c.focus) globe.flyTo(c.focus.lat, c.focus.lon, c.focus.heightKm);
    },

    jumpToEra(y) {
      player.jumpTo(y);
      const part = scale.partAt(y);
      store.set({ detailRange: [part.start, part.end] });
    },

    beginScrub() {
      resumeAfterScrub = store.get().playing;
      if (resumeAfterScrub) player.pause();
    },

    endScrub() {
      if (!resumeAfterScrub) return;
      resumeAfterScrub = false;
      const { year, direction } = store.get();
      // Player.play() at an end restarts from the other end; after a scrub to the end that would surprise.
      const atEnd = direction === 1 ? year >= PRESENT_YEAR : year <= TIMELINE_START;
      if (!atEnd) player.play();
    },
  };
}
