/**
 * Detail drawer for the selected event. Slides over the Now panel (same column / bottom sheet), so
 * opening it never covers more of the globe. Contested claims get their consensus badge and a boxed
 * "What mainstream scholarship says"; fringe theories additionally get an explicit notice up top.
 */
import type { HistoryEvent } from '../types';
import { CATEGORIES, CONSENSUS_META } from '../data/categories';
import { styleAt } from '../data/index';
import { usesPaleoPosition } from '../globe/eventPosition';
import { formatDuration, formatEventDate, formatYear } from '../time/TimeModel';
import type { UIDeps } from './context';
import { h, isKeyboardModality, releaseFocus, type Disposer } from './dom';
import { icon } from './icons';
import { categoryChip, consensusBadge, globalTag } from './badges';
import { fetchWikiSummary, wikiUrl } from './wikipedia';

const coord = (v: number, pos: string, neg: string): string => `${Math.abs(v).toFixed(1)}° ${v >= 0 ? pos : neg}`;

/**
 * Before the satellite era the globe shows reconstructed or illustrative geography. On reconstructed
 * coastlines a marker sits at the site's palaeo-position when the event has one; otherwise it is at
 * present-day coordinates and can appear in open ocean. Say so where the user looks.
 */
function presentDayNote(ev: HistoryEvent): HTMLElement | null {
  if (ev.global) return null;
  const mode = styleAt(ev.year).mode;
  if (mode === 'satellite' || usesPaleoPosition(ev, mode)) return null;
  const text = mode === 'paleo'
    ? 'The marker shows where this site is today. Plates have moved since, so it need not sit on the reconstructed coastlines of the time.'
    : 'The marker shows where this site is today; the surface drawn for this time is only illustrative.';
  return h('p', { class: 'hoe-detail__note' }, icon('place', 14), h('span', null, text));
}

function wikiSection(title: string): HTMLElement {
  const link = h('a', { class: 'hoe-wiki__link', href: wikiUrl(title), target: '_blank', rel: 'noopener' },
    'Read on Wikipedia', icon('external', 14));
  const text = h('p', { class: 'hoe-wiki__extract is-loading' }, 'Loading the Wikipedia summary…');
  const section = h('section', { class: 'hoe-wiki', 'aria-busy': 'true' }, h('h3', null, 'From Wikipedia'), text, link);
  void fetchWikiSummary(title).then((s) => {
    if (!section.isConnected) return; // the drawer has moved on to another event
    section.removeAttribute('aria-busy');
    text.classList.remove('is-loading');
    if (!s) {
      // Quiet fallback (404 / offline): the link still works.
      text.textContent = 'Summary unavailable right now; the full article is one click away.';
      text.classList.add('is-muted');
      return;
    }
    text.textContent = s.extract;
    link.href = s.url;
    if (s.thumbnail) {
      section.insertBefore(h('img', {
        class: 'hoe-wiki__thumb', src: s.thumbnail.source, width: s.thumbnail.width, height: s.thumbnail.height,
        alt: '', loading: 'lazy', decoding: 'async',
      }), text);
    }
  });
  return section;
}

function renderEvent(ev: HistoryEvent, deps: UIDeps): HTMLElement[] {
  const contested = ev.consensus === 'fringe' || ev.consensus === 'debated';
  const paleo = !ev.global && usesPaleoPosition(ev, styleAt(ev.year).mode);
  const where = ev.global
    ? null
    : h('span', {
      class: 'hoe-detail__where',
      title: paleo
        ? `Present-day coordinates. On the globe the marker sits where the site was ${formatYear(ev.year)}: `
          + `${coord(ev.paleoLat as number, 'N', 'S')}, ${coord(ev.paleoLon as number, 'E', 'W')} (Merdith 2021 plate model)`
        : 'Present-day coordinates',
    }, icon('place', 13), `${coord(ev.lat, 'N', 'S')}, ${coord(ev.lon, 'E', 'W')}`);
  const out: (HTMLElement | null)[] = [
    h('div', { class: 'hoe-detail__kicker' },
      // The "fringe" category's label is "Fringe theory" too; the consensus badge alone says it.
      ev.category === 'fringe' ? null : categoryChip(ev.category),
      consensusBadge(ev.consensus, true),
      ev.global ? globalTag() : null),
    h('h2', { class: 'hoe-detail__title', id: 'hoe-detail-title', style: { '--cat': CATEGORIES[ev.category].color } }, ev.title),
    h('div', { class: 'hoe-detail__date' },
      h('time', null, formatEventDate(ev)),
      ev.uncertainty ? h('span', { class: 'hoe-detail__unc', title: 'Dating uncertainty' }, `± ${formatDuration(ev.uncertainty)}`) : null,
      where),
    presentDayNote(ev),
    ev.consensus === 'fringe'
      ? h('p', { class: 'hoe-fringe-note' }, icon('help', 16), h('span', null, h('strong', null, 'Fringe theory. '), CONSENSUS_META.fringe.hint))
      : null,
    contested && ev.mainstreamView
      ? h('section', { class: `hoe-mainstream is-${ev.consensus}` }, h('h3', null, 'What mainstream scholarship says'), h('p', null, ev.mainstreamView))
      : null,
    h('p', { class: 'hoe-detail__desc' }, ev.description),
    ev.wikipedia ? wikiSection(ev.wikipedia) : null,
    h('div', { class: 'hoe-detail__actions' },
      h('button', { class: 'hoe-btn hoe-btn--solid', type: 'button', onclick: () => deps.globe.flyToEvent(ev) },
        icon(ev.global ? 'globe' : 'place', 16), ev.global ? 'Show the globe' : 'Fly here'),
      h('button', { class: 'hoe-btn hoe-btn--solid', type: 'button', onclick: () => deps.player.jumpTo(ev.year) },
        icon('history', 16), 'Jump to this time')),
  ];
  return out.filter((n): n is HTMLElement => n !== null);
}

export function createDetailDrawer(deps: UIDeps, d: Disposer): HTMLElement {
  const { store } = deps;
  const close = (): void => deps.selectEvent(null);
  const closeBtn = h('button', { class: 'hoe-btn hoe-btn--icon', type: 'button', 'aria-label': 'Close details (Esc)', title: 'Close (Esc)', onclick: close }, icon('close'));
  const body = h('div', { class: 'hoe-detail__body' });
  // tabindex -1: the drawer itself takes focus when it opens (see show()).
  const el = h('aside', { class: 'hoe-detail', 'aria-labelledby': 'hoe-detail-title', tabindex: -1 },
    h('div', { class: 'hoe-detail__bar' },
      h('button', { class: 'hoe-btn hoe-detail__back', type: 'button', onclick: close }, icon('chevronLeft', 18), 'Now'),
      closeBtn),
    body);
  el.inert = true;

  let shownId: string | null = null;
  /** Element to refocus on close: the card a keyboard user opened us from (null for mouse/touch). */
  let returnFocus: HTMLElement | null = null;
  const show = (id: string | null): void => {
    const ev = id ? deps.byId.get(id) : undefined;
    const wasOpen = el.classList.contains('is-open');
    el.classList.toggle('is-open', !!ev);
    if (!ev) {
      shownId = null;
      if (wasOpen) releaseFocus(el, returnFocus);
      el.inert = true;
      return;
    }
    el.inert = false;
    if (!wasOpen) {
      const active = document.activeElement;
      returnFocus = isKeyboardModality() && active instanceof HTMLElement ? active : null;
    }
    if (ev.id === shownId) return;
    shownId = ev.id;
    body.replaceChildren(...renderEvent(ev, deps));
    body.scrollTop = 0;
    // Focus the drawer itself, not its close button: Space must keep meaning play/pause (the global
    // handler leaves Space to focused buttons), while Esc still closes and Tab enters the drawer.
    if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
  };
  d.add(store.on('selectedEventId', show));
  show(store.get().selectedEventId);
  return el;
}
