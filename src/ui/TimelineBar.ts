import type { UIDeps } from './context';
import type { Tooltip } from './Tooltip';
import { h, type Disposer } from './dom';
import { createOverview } from './OverviewScrubber';
import { createDetailRuler } from './DetailRuler';

/** Top bar: overview scrubber (whole history) above the detail ruler (current Part or chapter). */
export function createTimelineBar(deps: UIDeps, tip: Tooltip, d: Disposer): HTMLElement {
  return h('div', { class: 'hoe-timeline hoe-glass' }, createOverview(deps, tip, d), createDetailRuler(deps, tip, d));
}
