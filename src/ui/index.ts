/**
 * UI entry point: builds the overlay (timeline bar, year readout, Now panel + detail drawer,
 * controls, TOC drawer, intro, credits) on top of the globe and wires keyboard shortcuts.
 * Everything lives in one fixed `.hoe-ui` layer with pointer-events: none; only the widgets
 * themselves take pointer events, so the globe stays draggable everywhere else.
 */
import '../styles/app.css';
import type { Store } from '../state/Store';
import type { Player } from '../time/Player';
import type { TimelineScale } from '../time/TimelineScale';
import type { GlobeController } from '../globe/Globe';
import type { HistoryEvent } from '../types';
import { createDeps } from './context';
import { Disposer, h, trackInputModality } from './dom';
import { createToast } from './Toast';
import { createTooltip } from './Tooltip';
import { createTimelineBar } from './TimelineBar';
import { createYearReadout } from './YearReadout';
import { createSidePanel } from './SidePanel';
import { createControls } from './Controls';
import { createTocDrawer } from './TocDrawer';
import { createIntroOverlay } from './IntroOverlay';
import { createCredits } from './Credits';
import { closeAllPopovers } from './Popover';
import { bindKeyboard } from './keyboard';
import { publishViewInsets } from './viewInsets';

export interface UIContext {
  root: HTMLElement;
  store: Store;
  player: Player;
  scale: TimelineScale;
  globe: GlobeController;
  events: HistoryEvent[];
}

export function createUI(ctx: UIContext): { destroy(): void; notifyNewEvents(ids: string[]): void } {
  const d = new Disposer();
  const root = h('div', { class: 'hoe-ui' });
  ctx.root.append(root);
  d.add(() => root.remove());

  trackInputModality(d);
  const toast = createToast(d);
  const deps = createDeps(ctx, root, toast.show, d);
  const { store, globe } = deps;

  const tip = createTooltip();
  const timeline = createTimelineBar(deps, tip, d);
  // The bottom sheet resizes before the controls exist; it re-measures the view insets once they do.
  let syncViewInsets = (): void => {};
  const side = createSidePanel(deps, d, () => syncViewInsets());
  const credits = createCredits(d);
  const intro = createIntroOverlay(deps, d);
  const readout = createYearReadout(deps, d);
  const controls = createControls(deps, () => credits.open(), d);
  const toc = createTocDrawer(deps, d);
  const footer = h('button', { class: 'hoe-footer hoe-glass', type: 'button', onclick: () => credits.open() }, 'Credits & sources');

  root.append(
    timeline,
    readout,
    side.el,
    controls,
    footer,
    toc.el,
    toast.el,
    tip.el,
    credits.el,
  );
  if (intro.el) root.append(intro.el);

  // Panels below the timeline position themselves from its measured height (it wraps on phones).
  const ro = new ResizeObserver(() => root.style.setProperty('--hoe-top', `${timeline.offsetTop + timeline.offsetHeight}px`));
  ro.observe(timeline);
  d.add(() => ro.disconnect());
  syncViewInsets = publishViewInsets([timeline, readout], controls, d);

  bindKeyboard(deps, intro, () => {
    if (closeAllPopovers()) return;
    const s = store.get();
    if (s.selectedEventId) deps.selectEvent(null);
    else if (s.tocOpen) store.set({ tocOpen: false });
  }, toc.focusSearch, d);

  // Keep the globe in step with UI-owned state, and let marker clicks open the drawer.
  const syncFringeClass = (): void => {
    root.classList.toggle('hide-fringe', !store.get().settings.showFringe);
  };
  d.add(store.on('settings', (s) => {
    globe.setSettings(s);
    syncFringeClass();
  }));
  d.add(store.on('selectedEventId', (id) => globe.setSelected(id)));
  globe.onEventClick((id) => deps.selectEvent(id));
  syncFringeClass();

  return {
    destroy: () => d.dispose(),
    notifyNewEvents(ids) {
      side.now.notifyNew(ids);
      for (const id of ids) if (deps.byId.has(id)) globe.pulse(id);
    },
  };
}
