/**
 * App entry (SPEC "Module APIs → src/main.ts"): boots globe → store → player → timeline scale → UI,
 * then wires the per-year pipeline that no single module owns: the chapter path and detail-ruler
 * range, the visible event set (store, globe markers, card animations, Tour), the globe surface
 * for the year, and URL deep links.
 *
 * The UI already forwards settings and selection to the globe and turns marker clicks into a
 * selection (src/ui/index.ts), so those are not repeated here.
 */
import './app/shell.css';
import { createGlobe, type GlobeController } from './globe/Globe';
import { Store } from './state/Store';
import { Player } from './time/Player';
import { TimelineScale } from './time/TimelineScale';
import { computeVisibleEvents } from './time/visible';
import { createUI } from './ui/index';
import { CHAPTERS, EVENTS, chapterPathAt, getEvent, rateAt, styleAt } from './data/index';
import type { HistoryEvent, Year } from './types';
import { PRESENT_YEAR, TIMELINE_START } from './types';
import { bindUrlHash, parseUrlHash, type UrlLink } from './app/urlHash';
import { showFatalError } from './app/fatalError';

/** Tour: at most one camera flight this often, so landmarks in quick succession don't whiplash the view. */
const TOUR_MIN_INTERVAL_MS = 4000;
/**
 * While paused, only a handful of arrivals (an ←/→ step, a short drag) are animated and pulsed;
 * a long jump replaces the whole panel, and animating every card at once would just be noise.
 */
const MAX_ANIMATED_WHILE_PAUSED = 3;

type UI = ReturnType<typeof createUI>;

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/** Keeps chapterPath, detailRange, visible events and the globe in step with the store. */
function wireTimeline(store: Store, player: Player, globe: GlobeController, ui: UI): void {
  /** recent ∪ ongoing at the last update: the events with markers on the globe. */
  let onGlobe: string[] = [];
  let lastTourFlight = -Infinity;

  const updateVisible = (): void => {
    const { year, settings, playing } = store.get();
    const path = chapterPathAt(year);
    const chapter = path[1] ?? path[0];
    const vis = computeVisibleEvents(year, player.currentRate(), settings, chapter.end - chapter.start, EVENTS);

    const panelIds = [...vis.recent, ...vis.ongoing, ...vis.upcoming].map((e) => e.id);
    if (!sameIds(panelIds, store.get().visibleEventIds)) store.set({ visibleEventIds: panelIds });

    // recent holds point events and spans that have already ended, ongoing only spans still running,
    // so the union needs no de-duplication.
    const markers = [...vis.recent, ...vis.ongoing];
    const ids = markers.map((e) => e.id);
    if (sameIds(ids, onGlobe)) return;
    const previous = new Set(onGlobe);
    onGlobe = ids;
    globe.setEvents(markers);

    const arrived = markers.filter((e) => !previous.has(e.id));
    if (arrived.length === 0) return;
    if (playing || arrived.length <= MAX_ANIMATED_WHILE_PAUSED) ui.notifyNewEvents(arrived.map((e) => e.id));
    if (playing && settings.tour) tour(arrived);
  };

  /** Tour: fly to the newest arriving landmark; global events have no single place to show. */
  const tour = (arrived: HistoryEvent[]): void => {
    const now = performance.now();
    if (now - lastTourFlight < TOUR_MIN_INTERVAL_MS) return;
    const landmark = arrived.find((e) => e.importance === 5 && !e.global);
    if (!landmark) return;
    lastTourFlight = now;
    globe.flyToEvent(landmark);
  };

  const onYear = (year: Year): void => {
    const path = chapterPathAt(year);
    const ids = path.map((c) => c.id);
    if (!sameIds(ids, store.get().chapterPath)) store.set({ chapterPath: ids });

    // Keep the user's ruler zoom while the playhead stays inside it; once it leaves, show the
    // whole current Part. The range is half-open like chapters, except at the end of the timeline.
    const [r0, r1] = store.get().detailRange;
    if (year < r0 || year > r1 || (year === r1 && r1 < PRESENT_YEAR)) {
      store.set({ detailRange: [path[0].start, path[0].end] });
    }

    globe.setYear(year, styleAt(year));
    updateVisible();
  };

  store.on('year', onYear);
  // The recent window depends on the playback rate, and the filters on the settings.
  for (const key of ['speed', 'direction', 'settings'] as const) store.on(key, updateVisible);
  onYear(store.get().year);
}

/**
 * Applies a deep link: move to its year (or its event's year) and select its event. The link
 * always replaces the selection, so navigating to a hash without `&e=` (typed, back/forward) closes
 * the drawer instead of keeping the old event and writing it back into the URL.
 */
function followLink(link: UrlLink, store: Store, player: Player, globe: GlobeController): void {
  const ev = link.eventId ? getEvent(link.eventId) : undefined;
  const year = link.year ?? ev?.year;
  if (year !== undefined) player.jumpTo(year);
  store.set({ selectedEventId: ev?.id ?? null });
  if (ev && !ev.global) globe.flyToEvent(ev);
}

async function boot(app: HTMLElement): Promise<void> {
  const globeEl = document.createElement('div');
  globeEl.className = 'hoe-globe';
  app.append(globeEl);
  let globe: GlobeController;
  try {
    globe = await createGlobe(globeEl);
  } catch (err) {
    globeEl.remove(); // drop Cesium's own error panel; ours explains what to do
    throw err;
  }

  const part = chapterPathAt(TIMELINE_START)[0];
  const store = new Store({ year: TIMELINE_START, playing: false, detailRange: [part.start, part.end] });
  const player = new Player(store, rateAt, EVENTS);
  const scale = new TimelineScale(CHAPTERS);
  const ui = createUI({ root: app, store, player, scale, globe, events: EVENTS });

  globe.setSettings(store.get().settings);
  wireTimeline(store, player, globe, ui);
  followLink(parseUrlHash(location.hash), store, player, globe);
  bindUrlHash(store, rateAt, (link) => followLink(link, store, player, globe));
}

const app = document.getElementById('app');
if (app) boot(app).catch((err: unknown) => showFatalError(app, err));
