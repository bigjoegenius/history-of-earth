import type { UIDeps } from './context';
import { h, type Disposer } from './dom';
import { createNowPanel, type NowPanel } from './NowPanel';
import { createDetailDrawer } from './DetailDrawer';
import { attachBottomSheet } from './BottomSheet';

/**
 * Right-hand column (bottom sheet on phones): the Now panel with the detail drawer sliding over it.
 * The column is only as tall as its content until the drawer opens, to keep the globe visible.
 */
export function createSidePanel(deps: UIDeps, d: Disposer, onSheetResize: () => void): { el: HTMLElement; now: NowPanel } {
  const handle = h('div', { class: 'hoe-sheet-handle', role: 'button', tabindex: 0, 'aria-label': 'Resize the event panel', 'aria-expanded': 'false' });
  const now = createNowPanel(deps, d);
  const el = h('div', { class: 'hoe-side hoe-glass', role: 'complementary', 'aria-label': 'What is happening now' },
    handle, now.el, createDetailDrawer(deps, d));
  const sync = (id: string | null): void => {
    el.classList.toggle('is-detail-open', id !== null && deps.byId.has(id));
  };
  d.add(deps.store.on('selectedEventId', sync));
  sync(deps.store.get().selectedEventId);
  attachBottomSheet(el, handle, deps, d, onSheetResize);
  return { el, now };
}
