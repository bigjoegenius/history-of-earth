/**
 * Mobile (< 800 px) behaviour of the side column: a bottom sheet with a drag handle and three snap
 * heights. The height lives in `--sheet-h` on :root so the controls (and the globe's credit strip,
 * which is outside the UI overlay) can sit just above it; `onResize` runs after each change.
 */
import type { UIDeps } from './context';
import { clamp, type Disposer } from './dom';

type Snap = 'peek' | 'half' | 'full';
const ORDER: Snap[] = ['peek', 'half', 'full'];

export function attachBottomSheet(
  sheet: HTMLElement, handle: HTMLElement, deps: UIDeps, d: Disposer, onResize: () => void,
): void {
  const { root } = deps;
  const vars = document.documentElement.style;
  let snap: Snap = 'peek';

  const heights = (): Record<Snap, number> => {
    const vh = window.innerHeight;
    const top = parseFloat(getComputedStyle(root).getPropertyValue('--hoe-top')) || 110;
    return { peek: Math.min(150, Math.round(vh * 0.3)), half: Math.round(vh * 0.48), full: Math.max(Math.round(vh * 0.5), vh - top - 12) };
  };
  const apply = (px: number): void => {
    vars.setProperty('--sheet-h', `${Math.round(px)}px`);
    onResize();
  };
  const snapTo = (s: Snap): void => {
    snap = s;
    apply(heights()[s]);
    root.classList.toggle('is-sheet-full', s === 'full');
    handle.setAttribute('aria-expanded', String(s !== 'peek'));
  };
  const step = (delta: 1 | -1): void => snapTo(ORDER[clamp(ORDER.indexOf(snap) + delta, 0, ORDER.length - 1)]);

  let drag: { y: number; h: number; moved: boolean } | null = null;
  d.listen<PointerEvent>(handle, 'pointerdown', (e) => {
    if (!deps.mobile.get() || e.button !== 0) return;
    handle.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, h: sheet.getBoundingClientRect().height, moved: false };
    sheet.classList.add('is-dragging');
  });
  d.listen<PointerEvent>(handle, 'pointermove', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (Math.abs(dy) > 4) drag.moved = true;
    const H = heights();
    apply(clamp(drag.h - dy, H.peek * 0.6, H.full));
  });
  const endDrag = (): void => {
    if (!drag) return;
    sheet.classList.remove('is-dragging');
    if (!drag.moved) {
      snapTo(snap === 'peek' ? 'half' : 'peek'); // a tap toggles
    } else {
      const current = sheet.getBoundingClientRect().height;
      const H = heights();
      snapTo(ORDER.reduce((best, s) => (Math.abs(H[s] - current) < Math.abs(H[best] - current) ? s : best)));
    }
    drag = null;
  };
  d.listen(handle, 'pointerup', endDrag);
  d.listen(handle, 'pointercancel', endDrag);
  d.listen<KeyboardEvent>(handle, 'keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') snapTo(snap === 'peek' ? 'half' : 'peek');
    else if (e.key === 'ArrowUp') step(1);
    else if (e.key === 'ArrowDown') step(-1);
    else return;
    e.preventDefault();
  });

  const sync = (mobile: boolean): void => {
    if (mobile) {
      snapTo(snap);
    } else {
      vars.removeProperty('--sheet-h');
      root.classList.remove('is-sheet-full');
      onResize();
    }
  };
  d.add(deps.mobile.on(sync));
  d.listen(window, 'resize', () => { if (deps.mobile.get()) snapTo(snap); });
  // Opening an event while the sheet only peeks: raise it so the details are readable.
  d.add(deps.store.on('selectedEventId', (id) => { if (id && deps.mobile.get() && snap === 'peek') snapTo('half'); }));
  sync(deps.mobile.get());
  d.add(() => vars.removeProperty('--sheet-h'));
}
