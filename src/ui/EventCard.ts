import type { HistoryEvent } from '../types';
import { CATEGORIES } from '../data/categories';
import { formatEventDate } from '../time/TimeModel';
import { h } from './dom';
import { consensusBadge, globalTag } from './badges';

/**
 * Now-panel card: category colour bar + icon, title, date, summary and a consensus badge for contested
 * claims. Fringe theories get a dashed grey frame and a "Fringe theory" badge so they can never be
 * mistaken for mainstream content. `compact` (Happening now, Up next) omits the summary; `dimmed`
 * (Up next) fades the card until it is hovered or focused.
 */
export function eventCard(ev: HistoryEvent, opts: { compact?: boolean; dimmed?: boolean; onSelect(): void }): HTMLElement {
  const cat = CATEGORIES[ev.category];
  const fringe = ev.consensus === 'fringe';
  const date = formatEventDate(ev);
  return h('article', {
    class: `hoe-card${fringe ? ' is-fringe' : ''}${opts.compact ? ' is-compact' : ''}${opts.dimmed ? ' is-dimmed' : ''}`,
    style: { '--cat': cat.color },
    tabindex: 0,
    role: 'button',
    'data-id': ev.id,
    'aria-label': `${fringe ? 'Fringe theory: ' : ''}${ev.title}, ${date}. Show details`,
    onclick: opts.onSelect,
    onkeydown: (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault(); // also tells the global shortcut handler that Space was consumed
      opts.onSelect();
    },
  },
  h('div', { class: 'hoe-card__head' },
    h('span', { class: 'hoe-card__icon', 'aria-hidden': 'true' }, cat.icon),
    h('h4', { class: 'hoe-card__title' }, ev.title),
    consensusBadge(ev.consensus)),
  h('div', { class: 'hoe-card__meta' },
    h('time', null, date), h('span', { class: 'hoe-card__cat' }, cat.label), ev.global ? globalTag() : null),
  opts.compact ? null : h('p', { class: 'hoe-card__summary' }, ev.summary));
}

/** Rich tooltip for an event tick on the detail ruler. */
export function eventTooltip(ev: HistoryEvent): HTMLElement {
  const cat = CATEGORIES[ev.category];
  return h('div', { class: 'hoe-tip__event', style: { '--cat': cat.color } },
    h('strong', null, ev.title),
    h('span', { class: 'hoe-tip__meta' }, `${cat.icon} ${formatEventDate(ev)}`),
    consensusBadge(ev.consensus));
}
