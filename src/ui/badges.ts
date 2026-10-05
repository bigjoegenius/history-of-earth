/** Small labelled chips shared by cards, the detail drawer, tooltips and the TOC. */
import type { Consensus, EventCategory } from '../types';
import { CATEGORIES, CONSENSUS_META } from '../data/categories';
import { h } from './dom';
import { icon } from './icons';

export function categoryChip(category: EventCategory): HTMLElement {
  const meta = CATEGORIES[category];
  return h('span', { class: 'hoe-chip hoe-chip--cat', style: { '--cat': meta.color } },
    h('span', { 'aria-hidden': 'true' }, meta.icon), meta.label);
}

/**
 * Consensus badge. Cards only flag contested claims (debated / fringe); the detail drawer passes
 * `always` so every event states its standing.
 */
export function consensusBadge(consensus: Consensus, always = false): HTMLElement | null {
  if (!always && consensus !== 'debated' && consensus !== 'fringe') return null;
  const meta = CONSENSUS_META[consensus];
  return h('span', { class: `hoe-badge hoe-badge--${consensus}`, title: meta.hint }, meta.label);
}

export function globalTag(): HTMLElement {
  return h('span', { class: 'hoe-tag', title: 'Affects the whole planet (no single location on the globe)' },
    icon('globe', 12), 'Planet-wide');
}
