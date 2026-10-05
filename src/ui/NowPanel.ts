/**
 * "Now" panel: era header, then Just happened (recent, newest first), Happening now (ongoing spans,
 * compact, the first few with a "+N more" toggle) and Up next (dimmed). Recent comes first so events
 * arrive right under the header, never below the fold, and sections appearing or disappearing below
 * it cannot shift it. Within each section fringe theories go last (see fringeLast), so the first card
 * a visitor sees is mainstream. Cards are reused per section+id so focus and entry animations survive
 * the per-frame updates; ids passed to notifyNew() slide/fade in.
 */
import type { HistoryEvent } from '../types';
import { formatDuration } from '../time/TimeModel';
import type { VisibleEvents } from '../time/visible';
import type { UIDeps } from './context';
import { blurAfterPointerClick, h, reconcile, type Disposer } from './dom';
import { eventCard } from './EventCard';
import { createEraHeader } from './EraHeader';

type SectionKey = 'ongoing' | 'recent' | 'upcoming';

/** notifyNew() may arrive just before or just after the card renders; remember ids this long. */
const PENDING_MS = 1500;
/** Ongoing spans shown before the "+N more" toggle. */
const ONGOING_SHOWN = 3;

/**
 * The section's order with fringe theories moved to the end (stable), so a fringe claim never
 * outranks a mainstream event. Done at render time: computeVisibleEvents' order is pinned by tests.
 */
function fringeLast(list: readonly HistoryEvent[]): readonly HistoryEvent[] {
  if (!list.some((e) => e.consensus === 'fringe')) return list;
  return [...list.filter((e) => e.consensus !== 'fringe'), ...list.filter((e) => e.consensus === 'fringe')];
}

export interface NowPanel {
  el: HTMLElement;
  notifyNew(ids: string[]): void;
}

export function createNowPanel(deps: UIDeps, d: Disposer): NowPanel {
  const { store } = deps;
  const makeSection = (key: SectionKey, title: string) => {
    const note = h('span', { class: 'hoe-sec__note' });
    const list = h('div', { class: 'hoe-sec__list', id: `hoe-sec-${key}` });
    const empty = h('p', { class: 'hoe-sec__empty' });
    const el = h('section', { class: `hoe-sec hoe-sec--${key}` }, h('h3', { class: 'hoe-sec__title' }, title, note), list, empty);
    return { el, list, note, empty };
  };
  const sections = {
    recent: makeSection('recent', 'Just happened'),
    ongoing: makeSection('ongoing', 'Happening now'),
    upcoming: makeSection('upcoming', 'Up next'),
  };
  let showAllOngoing = false;
  const moreOngoing = h('button', {
    class: 'hoe-linkbtn hoe-sec__more', type: 'button', 'aria-controls': 'hoe-sec-ongoing', 'aria-expanded': 'false',
  });
  sections.ongoing.el.append(moreOngoing);
  const el = h('div', { class: 'hoe-now' }, createEraHeader(deps, d), sections.recent.el, sections.ongoing.el, sections.upcoming.el);

  const cards = new Map<string, HTMLElement>();
  const pending = new Map<string, number>();

  /** Restarts the entry animation on cards; one forced reflow for the whole batch. */
  const animateIn = (list: HTMLElement[]): void => {
    const running = list.filter((c) => c.classList.contains('is-new'));
    for (const c of running) c.classList.remove('is-new');
    if (running.length > 0) void el.offsetWidth;
    for (const c of list) c.classList.add('is-new');
  };
  d.listen<AnimationEvent>(el, 'animationend', (e) => {
    if (e.animationName === 'hoe-card-glow' && e.target instanceof HTMLElement) e.target.classList.remove('is-new');
  });

  /** Scrolls "Just happened" back into view for arrivals, unless the user is reading the panel. */
  const revealRecent = (): void => {
    if (el.matches(':hover') || el.contains(document.activeElement)) return;
    const top = sections.recent.el.getBoundingClientRect().top - el.getBoundingClientRect().top;
    if (top >= 0 && top <= el.clientHeight - 60) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ top: top - 8, behavior: smooth ? 'smooth' : 'auto' });
  };

  const cardFor = (key: SectionKey, ev: HistoryEvent): HTMLElement => {
    const k = `${key}:${ev.id}`;
    let card = cards.get(k);
    if (!card) {
      card = eventCard(ev, {
        compact: key !== 'recent',
        dimmed: key === 'upcoming',
        onSelect: () => deps.selectEvent(ev.id, { fly: true }),
      });
      card.classList.toggle('is-selected', ev.id === store.get().selectedEventId);
      cards.set(k, card);
      const t = pending.get(ev.id);
      if (key !== 'upcoming' && t !== undefined) {
        pending.delete(ev.id);
        if (performance.now() - t < PENDING_MS) card.classList.add('is-new');
      }
    }
    return card;
  };

  let last: VisibleEvents = deps.visible.get();
  const render = (v: VisibleEvents): void => {
    last = v;
    const live = new Set<string>();
    for (const key of ['recent', 'ongoing', 'upcoming'] as const) {
      const s = sections[key];
      const nodes = fringeLast(v[key]).map((ev) => {
        live.add(`${key}:${ev.id}`);
        return cardFor(key, ev);
      });
      reconcile(s.list, key === 'ongoing' && !showAllOngoing ? nodes.slice(0, ONGOING_SHOWN) : nodes);
      s.el.hidden = key !== 'recent' && nodes.length === 0;
      s.empty.hidden = nodes.length > 0;
    }
    const hiddenOngoing = v.ongoing.length - ONGOING_SHOWN;
    moreOngoing.hidden = hiddenOngoing <= 0;
    moreOngoing.textContent = showAllOngoing ? 'Show fewer' : `+${hiddenOngoing} more`;
    moreOngoing.setAttribute('aria-expanded', String(showAllOngoing));
    sections.recent.note.textContent = `last ${formatDuration(v.window)}`;
    sections.recent.empty.textContent = `Nothing in the last ${formatDuration(v.window)}. Press play, or → to skip to the next event.`;
    for (const k of cards.keys()) if (!live.has(k)) cards.delete(k);
  };
  d.listen<MouseEvent>(moreOngoing, 'click', (e) => {
    showAllOngoing = !showAllOngoing;
    render(last);
    blurAfterPointerClick(e);
  });
  d.add(deps.visible.on(render));
  render(last);

  d.add(store.on('selectedEventId', (id) => {
    for (const card of cards.values()) card.classList.toggle('is-selected', card.dataset.id === id);
  }));

  return {
    el,
    notifyNew(ids) {
      const now = performance.now();
      for (const [id, t] of pending) if (now - t > PENDING_MS) pending.delete(id);
      const arrived: HTMLElement[] = [];
      for (const id of ids) {
        const card = cards.get(`recent:${id}`) ?? cards.get(`ongoing:${id}`);
        if (card) arrived.push(card); else pending.set(id, now);
      }
      animateIn(arrived);
      if (arrived.some((c) => sections.recent.list.contains(c))) revealRecent();
    },
  };
}
