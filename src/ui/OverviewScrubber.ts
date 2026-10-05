/**
 * Overview scrubber: the whole 4.57-billion-year timeline on one bar, one segment per Part
 * (piecewise-linear TimelineScale). Drag to scrub, click to jump, PageUp/PageDown to change Part.
 * Also shows the detail ruler's current window and importance-5 landmarks as dots.
 */
import type { Year } from '../types';
import { CATEGORIES } from '../data/categories';
import { formatYear } from '../time/TimeModel';
import type { UIDeps } from './context';
import type { Tooltip } from './Tooltip';
import { clamp, h, pct, type Disposer } from './dom';

/** Short labels for narrow segments, keyed by the fixed level-1 Part ids (SPEC); others get a 4-letter cut. */
const ABBREVIATIONS: Record<string, string> = {
  hadean: 'Had.', archean: 'Arch.', proterozoic: 'Prot.', paleozoic: 'Paleo.', mesozoic: 'Meso.',
  cenozoic: 'Ceno.', prehistory: 'Prehist.', ancient: 'Anc.', classical: 'Class.',
  postclassical: 'Post-cl.', earlymodern: 'E. Mod.', modern: 'Mod.',
};

/** Hue ramp from molten orange (oldest) to modern blue, so the bar reads as a progression. */
const hueFor = (i: number, n: number): number => Math.round(15 + (i / Math.max(1, n - 1)) * 200);

export function createOverview(deps: UIDeps, tip: Tooltip, d: Disposer): HTMLElement {
  const { store, scale, player } = deps;
  const segments = scale.segments();

  const views = segments.map((seg, i) => {
    const label = h('span', { class: 'hoe-ov__label' });
    const el = h('div', {
      class: 'hoe-ov__seg',
      style: { left: pct(seg.p0), width: pct(seg.p1 - seg.p0), '--hue': String(hueFor(i, segments.length)) },
    }, label);
    const full = seg.chapter.title;
    return { seg, el, label, full, short: ABBREVIATIONS[seg.chapter.id] ?? `${full.slice(0, 4)}.` };
  });
  const marks = h('div', { class: 'hoe-ov__marks' });
  const windowEl = h('div', { class: 'hoe-ov__window' });
  const playhead = h('div', { class: 'hoe-ov__playhead' });
  const el = h('div', {
    class: 'hoe-ov',
    role: 'slider',
    tabindex: 0,
    'aria-label': 'Timeline of Earth history. PageUp and PageDown change era.',
    'aria-valuemin': 0,
    'aria-valuemax': 1000,
  }, h('div', { class: 'hoe-ov__segs' }, views.map((v) => v.el)), marks, windowEl, playhead);

  /* Labels: full title, else abbreviation, else nothing — measured, so it adapts to any width. */
  const measure = document.createElement('canvas').getContext('2d');
  const fitLabels = (): void => {
    const width = el.clientWidth;
    if (!measure || width === 0 || views.length === 0) return;
    const cs = getComputedStyle(views[0].label);
    measure.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    for (const v of views) {
      const room = (v.seg.p1 - v.seg.p0) * width - 6;
      const fits = (s: string): boolean => measure.measureText(s).width <= room;
      const text = fits(v.full) ? v.full : fits(v.short) ? v.short : '';
      v.label.textContent = text;
      v.el.title = text === v.full ? '' : v.full;
    }
  };
  const ro = new ResizeObserver(fitLabels);
  ro.observe(el);
  d.add(() => ro.disconnect());

  /* Store → view */
  let currentPartId = '';
  const updateAria = (y: Year): void => {
    el.setAttribute('aria-valuenow', String(Math.round(scale.toPosition(y) * 1000)));
    el.setAttribute('aria-valuetext', formatYear(y));
  };
  const onYear = (y: Year): void => {
    playhead.style.left = pct(scale.toPosition(y));
    const part = scale.partAt(y);
    if (part.id !== currentPartId) {
      currentPartId = part.id;
      for (const v of views) v.el.classList.toggle('is-current', v.seg.chapter.id === part.id);
    }
    // Screen-reader value only while paused: announcing 60 updates a second would be noise.
    if (!store.get().playing) updateAria(y);
  };
  const onRange = ([r0, r1]: [Year, Year]): void => {
    const p0 = scale.toPosition(r0);
    windowEl.style.left = pct(p0);
    windowEl.style.width = pct(Math.max(0, scale.toPosition(r1) - p0));
  };
  const renderMarks = (): void => {
    const keep = deps.filter();
    marks.replaceChildren(...deps.events
      .filter((e) => e.importance === 5 && keep(e))
      .map((e) => h('span', {
        class: 'hoe-ov__mark',
        style: { left: pct(scale.toPosition(e.year)), '--cat': CATEGORIES[e.category].color },
      })));
  };
  d.add(store.on('year', onYear));
  d.add(store.on('detailRange', onRange));
  d.add(store.on('settings', renderMarks));
  d.add(store.on('playing', (playing) => { if (!playing) updateAria(store.get().year); }));
  onYear(store.get().year);
  onRange(store.get().detailRange);
  updateAria(store.get().year);
  renderMarks();

  /* Pointer: press jumps, drag scrubs (pointer capture keeps the drag alive outside the bar). */
  const yearAt = (clientX: number): Year => {
    const r = el.getBoundingClientRect();
    return scale.toYear(clamp((clientX - r.left) / r.width, 0, 1));
  };
  const showTip = (e: PointerEvent): void => {
    const y = yearAt(e.clientX);
    tip.show(e.clientX, el.getBoundingClientRect().bottom + 8, `${formatYear(y)} · ${scale.partAt(y).title}`);
  };
  let dragging = false;
  const endDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    deps.endScrub();
    if (e.pointerType !== 'mouse') tip.hide();
  };
  d.listen<PointerEvent>(el, 'pointerdown', (e) => {
    if (e.button !== 0) return;
    el.setPointerCapture(e.pointerId);
    dragging = true;
    deps.beginScrub();
    player.jumpTo(yearAt(e.clientX));
    showTip(e);
  });
  d.listen<PointerEvent>(el, 'pointermove', (e) => {
    if (dragging) player.jumpTo(yearAt(e.clientX));
    showTip(e);
  });
  d.listen<PointerEvent>(el, 'pointerup', endDrag);
  d.listen<PointerEvent>(el, 'pointercancel', endDrag);
  d.listen<PointerEvent>(el, 'pointerleave', () => { if (!dragging) tip.hide(); });

  d.listen<KeyboardEvent>(el, 'keydown', (e) => {
    if (e.key !== 'PageUp' && e.key !== 'PageDown') return;
    e.preventDefault();
    const i = segments.findIndex((s) => s.chapter.id === scale.partAt(store.get().year).id);
    const target = segments[clamp(i + (e.key === 'PageUp' ? 1 : -1), 0, segments.length - 1)];
    deps.jumpToEra(target.chapter.start);
  });

  return el;
}
