/**
 * Detail ruler: a linear view of store.detailRange (the current Part, or a chapter picked in the TOC)
 * with chapter bands, category-coloured event ticks and the playhead.
 * Hover shows the nearest event, click jumps to it (or to the clicked year), drag scrubs,
 * wheel or pinch zooms around the cursor (clamped to the current Part; around the playhead while
 * playing), shift+wheel pans, double-click resets.
 */
import type { Chapter, HistoryEvent, Settings, Year } from '../types';
import { PRESENT_YEAR, TIMELINE_START } from '../types';
import { CHAPTERS, chapterPathAt } from '../data/index';
import { formatYear } from '../time/TimeModel';
import { lowerBound, type UIDeps } from './context';
import type { Tooltip } from './Tooltip';
import { clamp, h, type Disposer } from './dom';
import { eventTooltip } from './EventCard';
import { paintRulerBackground, paintRulerPlayhead, type RulerBand, type RulerScene } from './rulerPaint';

/** Max distance (px) between the pointer and a tick for it to count as hovered. */
const HOVER_PX = 7;
/** Deepest zoom is 1/5000 of the Part (≈1 year in the Modern era, ≈100,000 years in the Hadean). */
const MAX_ZOOM = 5000;
/**
 * While playing, zoom and pan keep the playhead at least this fraction of the range away from either
 * edge: main.ts resets the ruler to the whole Part as soon as the playhead leaves the range, so a zoom
 * that dropped the playhead (or left it on the edge it is heading for) would be undone a frame later.
 */
const PLAYING_EDGE_MARGIN = 0.1;

/**
 * Bands to label: the level-2 chapters of the Part in view; when zoomed inside a single chapter, its
 * sections instead (so there are always at least two labelled bands); Parts if the range spans several.
 */
function bandsFor(r0: Year, r1: Year): RulerBand[] {
  const part = chapterPathAt((r0 + r1) / 2)[0];
  if (!part) return [];
  const overlaps = (c: Chapter): boolean => c.end > r0 && c.start < r1;
  let level: Chapter[] = r0 < part.start || r1 > part.end ? CHAPTERS : part.children ?? [];
  let hits = level.filter(overlaps);
  while (hits.length === 1 && hits[0].children?.length) {
    level = hits[0].children;
    hits = level.filter(overlaps);
  }
  return hits.map((c) => ({ title: c.title, start: c.start, end: c.end, index: level.indexOf(c) }));
}

export function createDetailRuler(deps: UIDeps, tip: Tooltip, d: Disposer): HTMLElement {
  const { store, player, scale } = deps;
  const canvas = h('canvas', { class: 'hoe-ruler__canvas' });
  const resetBtn = h('button', {
    class: 'hoe-ruler__reset',
    type: 'button',
    title: 'Show the whole era again (or double-click the ruler)',
    onclick: () => resetZoom(),
  }, 'Reset zoom');
  const el = h('div', {
    class: 'hoe-ruler',
    role: 'group',
    'aria-label': 'Detail timeline. Scroll or pinch to zoom, Shift+scroll to pan, double-click to reset.',
  }, canvas, resetBtn);
  const ctx = canvas.getContext('2d');
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--hoe-accent').trim() || '#4fc3f7';

  /* ── Content for the current range + settings (cached: unchanged during plain playback) ── */
  let cachedRange: readonly [Year, Year] | null = null;
  let cachedSettings: Settings | null = null;
  let inRange: HistoryEvent[] = [];   // year order, for hit-testing
  let paintOrder: HistoryEvent[] = []; // importance order, so landmarks are drawn on top
  let spans: HistoryEvent[] = [];
  let bands: RulerBand[] = [];
  const refreshContent = (): void => {
    const { detailRange, settings } = store.get();
    if (detailRange === cachedRange && settings === cachedSettings) return;
    cachedRange = detailRange;
    cachedSettings = settings;
    const [r0, r1] = detailRange;
    const keep = deps.filter();
    inRange = [];
    for (let i = lowerBound(deps.events, r0); i < deps.events.length && deps.events[i].year <= r1; i++) {
      if (keep(deps.events[i])) inRange.push(deps.events[i]);
    }
    paintOrder = [...inRange].sort((a, b) => a.importance - b.importance);
    spans = deps.spans.filter((e) => e.year <= r1 && (e.endYear ?? e.year) >= r0 && keep(e));
    bands = bandsFor(r0, r1);
  };

  /* ── Painting: coalesced to one paint per animation frame ── */
  let size = { w: 0, h: 0, dpr: 1 };
  let hoverId: string | null = null;
  let frame = 0;
  // Bands, axis and ticks are cached in an offscreen layer, repainted only when one of its inputs
  // changes (all compared by identity: the store and the resize observer replace them on change).
  const layer = document.createElement('canvas');
  const layerCtx = layer.getContext('2d');
  let layerInputs: readonly unknown[] = [];
  const paint = (): void => {
    frame = 0;
    if (!ctx || !layerCtx || size.w === 0) return;
    refreshContent();
    const s = store.get();
    const scene: RulerScene = {
      width: size.w, height: size.h, range: s.detailRange, bands, ticks: paintOrder, spans,
      year: s.year, hoverId, selectedId: s.selectedEventId, accent,
    };
    const inputs = [s.detailRange, s.settings, size, hoverId, s.selectedEventId];
    if (inputs.some((v, i) => v !== layerInputs[i])) {
      layerInputs = inputs;
      layer.width = canvas.width;
      layer.height = canvas.height;
      layerCtx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      paintRulerBackground(layerCtx, scene);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(layer, 0, 0);
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    paintRulerPlayhead(ctx, scene);
  };
  const invalidate = (): void => {
    if (!frame) frame = requestAnimationFrame(paint);
  };
  d.add(() => cancelAnimationFrame(frame));

  const ro = new ResizeObserver(() => {
    const r = canvas.getBoundingClientRect();
    size = { w: r.width, h: r.height, dpr: window.devicePixelRatio || 1 };
    canvas.width = Math.round(r.width * size.dpr);
    canvas.height = Math.round(r.height * size.dpr);
    invalidate();
  });
  ro.observe(canvas);
  d.add(() => ro.disconnect());

  /* ── Zoom bounds and range updates ── */
  const zoomBounds = (): { b0: Year; b1: Year; minSpan: number } => {
    const { year, detailRange: [r0, r1] } = store.get();
    const part = scale.partAt(year);
    // Clamp to the current Part; a range already wider than it (e.g. the whole timeline) may stay that wide.
    const inPart = r0 >= part.start && r1 <= part.end;
    return {
      b0: inPart ? part.start : TIMELINE_START,
      b1: inPart ? part.end : PRESENT_YEAR,
      minSpan: Math.max(1, (part.end - part.start) / MAX_ZOOM),
    };
  };
  const setRange = (n0: Year, span: number): void => {
    const { b0, b1 } = zoomBounds();
    const { playing, year } = store.get();
    const s = Math.min(span, b1 - b0);
    let start = n0;
    if (playing) start = clamp(start, year - s * (1 - PLAYING_EDGE_MARGIN), year - s * PLAYING_EDGE_MARGIN);
    start = clamp(start, b0, b1 - s);
    store.set({ detailRange: [start, start + s] });
  };
  const zoomAt = (anchor: Year, factor: number): void => {
    const { playing, year, detailRange: [r0, r1] } = store.get();
    const { b0, b1, minSpan } = zoomBounds();
    const span = clamp((r1 - r0) * factor, Math.min(minSpan, r1 - r0), b1 - b0);
    // While playing, zoom around the moving playhead (when in view) so it stays put on screen.
    const a = playing && year >= r0 && year <= r1 ? year : anchor;
    const t = (a - r0) / (r1 - r0);
    setRange(a - t * span, span);
  };
  const pan = (dxPx: number): void => {
    const [r0, r1] = store.get().detailRange;
    setRange(r0 + (dxPx / size.w) * (r1 - r0), r1 - r0);
  };
  const resetZoom = (): void => {
    const part = scale.partAt(store.get().year);
    store.set({ detailRange: [part.start, part.end] });
  };
  const syncResetButton = (): void => {
    const { year, detailRange: [r0, r1] } = store.get();
    const part = scale.partAt(year);
    const eps = (part.end - part.start) * 1e-9;
    resetBtn.hidden = Math.abs(r0 - part.start) <= eps && Math.abs(r1 - part.end) <= eps;
  };

  d.add(store.on('year', () => { invalidate(); syncResetButton(); }));
  d.add(store.on('detailRange', () => { invalidate(); syncResetButton(); }));
  d.add(store.on('settings', invalidate));
  d.add(store.on('selectedEventId', invalidate));
  syncResetButton();

  /* ── Pointer interaction ── */
  const localX = (e: MouseEvent): number => e.clientX - canvas.getBoundingClientRect().left;
  const xOfYear = (y: Year): number => {
    const [r0, r1] = store.get().detailRange;
    return ((y - r0) / (r1 - r0)) * size.w;
  };
  const yearAtX = (x: number): Year => {
    const [r0, r1] = store.get().detailRange;
    return r0 + clamp(x / size.w, 0, 1) * (r1 - r0);
  };
  const nearestEvent = (x: number): HistoryEvent | null => {
    refreshContent();
    let best: HistoryEvent | null = null;
    let bestDist = HOVER_PX;
    for (const e of inRange) {
      // Slight bias toward important events when ticks overlap.
      const dist = Math.abs(xOfYear(e.year) - x) - e.importance * 0.3;
      if (dist < bestDist) {
        bestDist = dist;
        best = e;
      }
    }
    return best;
  };
  let tipFor: { id: string; node: HTMLElement } | null = null;
  const setHover = (id: string | null): void => {
    if (id !== hoverId) {
      hoverId = id;
      invalidate();
    }
  };
  const hoverAt = (e: MouseEvent): void => {
    const x = localX(e);
    const ev = nearestEvent(x);
    setHover(ev?.id ?? null);
    const bottom = canvas.getBoundingClientRect().bottom + 6;
    canvas.classList.toggle('is-over-event', ev !== null);
    if (ev) {
      if (tipFor?.id !== ev.id) tipFor = { id: ev.id, node: eventTooltip(ev) };
      tip.show(canvas.getBoundingClientRect().left + xOfYear(ev.year), bottom, tipFor.node);
    } else {
      tip.show(e.clientX, bottom, formatYear(yearAtX(x)));
    }
  };

  let press: { x: number; dragging: boolean } | null = null;
  /** Touch pinch: clientX of each active pointer, and the finger distance at the last zoom step. */
  const pointers = new Map<number, number>();
  let pinchDistance = 0;
  const pinchSpan = (): { mid: number; dist: number } => {
    const [a, b] = [...pointers.values()];
    return { mid: (a + b) / 2, dist: Math.abs(a - b) };
  };
  const releasePointer = (id: number): void => {
    pointers.delete(id);
    if (pointers.size < 2) pinchDistance = 0;
  };

  d.listen<PointerEvent>(canvas, 'pointerdown', (e) => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, e.clientX);
    if (pointers.size === 2) {
      // A second finger turns the gesture into a pinch: abandon the tap/scrub of the first one.
      if (press?.dragging) deps.endScrub();
      press = null;
      pinchDistance = pinchSpan().dist;
      tip.hide();
      return;
    }
    if (pointers.size === 1) press = { x: e.clientX, dragging: false };
  });
  d.listen<PointerEvent>(canvas, 'pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, e.clientX);
    if (pointers.size === 2 && pinchDistance > 0) {
      const { mid, dist } = pinchSpan();
      if (dist > 8) {
        zoomAt(yearAtX(mid - canvas.getBoundingClientRect().left), pinchDistance / dist);
        pinchDistance = dist;
      }
      return;
    }
    if (press) {
      if (!press.dragging && Math.abs(e.clientX - press.x) > 4) {
        press.dragging = true;
        deps.beginScrub();
        setHover(null);
      }
      if (press.dragging) {
        const y = yearAtX(localX(e));
        player.jumpTo(y);
        tip.show(e.clientX, canvas.getBoundingClientRect().bottom + 6, formatYear(y));
        return;
      }
    }
    hoverAt(e);
  });
  d.listen<PointerEvent>(canvas, 'pointerup', (e) => {
    releasePointer(e.pointerId);
    if (!press) return;
    if (press.dragging) {
      deps.endScrub();
    } else {
      const ev = nearestEvent(localX(e));
      player.jumpTo(ev ? ev.year : yearAtX(localX(e)));
    }
    press = null;
    if (e.pointerType !== 'mouse') {
      tip.hide();
      setHover(null);
    }
  });
  d.listen<PointerEvent>(canvas, 'pointercancel', (e) => {
    releasePointer(e.pointerId);
    if (press?.dragging) deps.endScrub();
    press = null;
  });
  d.listen<PointerEvent>(canvas, 'pointerleave', () => {
    if (press) return;
    tip.hide();
    setHover(null);
  });
  d.listen<MouseEvent>(canvas, 'dblclick', resetZoom);
  d.listen<WheelEvent>(canvas, 'wheel', (e) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? size.w : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    const horizontal = Math.abs(dx) > Math.abs(dy);
    if (e.shiftKey || horizontal) pan(horizontal ? dx : dy);
    // ctrlKey marks a trackpad pinch, whose deltas are much smaller than wheel notches.
    else zoomAt(yearAtX(localX(e)), Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0018)));
    if (!press) hoverAt(e);
  }, { passive: false });

  return el;
}
