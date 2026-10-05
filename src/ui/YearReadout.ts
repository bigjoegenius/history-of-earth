/**
 * Big year readout under the timeline: formatted year (with the month in the modern calendar era
 * when paused between whole years or playing slowly), "N years ago" + deepest chapter title, the
 * playback rate, and banners for planet-wide events (global events have no globe marker, so they are
 * surfaced here instead).
 */
import type { HistoryEvent, Year } from '../types';
import { CATEGORIES } from '../data/categories';
import { formatDuration, formatYear, yearsAgo } from '../time/TimeModel';
import type { VisibleEvents } from '../time/visible';
import type { UIDeps } from './context';
import { h, reconcile, setText, type Disposer } from './dom';
import { icon } from './icons';

/**
 * While playing, months are shown only below this rate (yr/s): about 6 month changes per second.
 * Faster, the readout would flicker through month names (at 1× in Classical times, 55 per second).
 */
const MONTH_RATE_LIMIT = 0.5;
/** Before this year a month would be false precision: almost no earlier event is dated to the month. */
const MONTH_MIN_YEAR = 1500;
/** formatYear switches to "… years ago" at or below this year, so the "ago" line would repeat it. */
const DEEP_TIME_LIMIT = -10_000;

function agoText(y: Year): string {
  const ago = yearsAgo(y);
  return ago < 1 ? 'This year' : `${formatDuration(ago)} ago`;
}

export function createYearReadout(deps: UIDeps, d: Disposer): HTMLElement {
  const { store, player } = deps;
  const yearEl = h('div', { class: 'hoe-readout__year' });
  const subEl = h('div', { class: 'hoe-readout__sub' });
  const rateEl = h('div', { class: 'hoe-readout__rate' });
  const globalsEl = h('div', { class: 'hoe-readout__globals' });
  const el = h('div', { class: 'hoe-readout' }, h('div', { class: 'hoe-readout__box' }, yearEl, subEl, rateEl), globalsEl);

  const update = (): void => {
    const { year, speed, direction, playing } = store.get();
    const rate = player.currentRate();
    // Paused on a whole year (an event step, a chapter start, a deep link) shows just the year.
    const month = year >= MONTH_MIN_YEAR && !Number.isInteger(year)
      && (!playing || Math.abs(rate) < MONTH_RATE_LIMIT);
    setText(yearEl, formatYear(year, { month }));
    const deepest = deps.path.get().at(-1);
    setText(subEl, [year > DEEP_TIME_LIMIT ? agoText(year) : '', deepest?.title ?? ''].filter(Boolean).join(' · '));
    const state = playing ? (direction === 1 ? '▶' : '◀') : 'Paused ·';
    setText(rateEl, `${state} ${speed}× · 1 s ≈ ${formatDuration(Math.abs(rate))}`);
  };
  for (const key of ['year', 'speed', 'direction', 'playing'] as const) d.add(store.on(key, update));
  update();

  /* Planet-wide banners, re-rendered only when the visible set changes; nodes reused per id. */
  const banners = new Map<string, HTMLElement>();
  const banner = (e: HistoryEvent): HTMLElement => {
    let b = banners.get(e.id);
    if (!b) {
      b = h('button', {
        class: 'hoe-banner hoe-glass',
        type: 'button',
        style: { '--cat': CATEGORIES[e.category].color },
        title: 'Planet-wide event: show details',
        onclick: () => deps.selectEvent(e.id),
      }, icon('globe', 14), h('span', { class: 'hoe-banner__kicker' }, 'Planet-wide'), h('span', { class: 'hoe-banner__title' }, e.title));
      banners.set(e.id, b);
    }
    return b;
  };
  const renderGlobals = (v: VisibleEvents): void => {
    const list = [...v.ongoing, ...v.recent].filter((e) => e.global && e.importance >= 3).slice(0, 2);
    // reconcile, not replaceChildren: re-inserting a banner that stays would replay its fade-in.
    reconcile(globalsEl, list.map(banner));
    for (const id of banners.keys()) if (!list.some((e) => e.id === id)) banners.delete(id);
  };
  d.add(deps.visible.on(renderGlobals));
  renderGlobals(deps.visible.get());

  return el;
}
