/** Anchored popover (speed menu, settings). Closes on outside press, Esc (via closeAllPopovers) or toggle. */
import { clamp, h, type Disposer } from './dom';

export interface Popover {
  el: HTMLElement;
  open(): void;
  close(): void;
  toggle(): void;
}

const openPopovers = new Set<Popover>();
/** px between the popover and its anchor, and kept clear at the viewport edges. */
const GAP = 8;
const MARGIN = 8;
/** Never squeeze the popover below this height, even when the anchor leaves less room. */
const MIN_HEIGHT = 160;

/** Closes every open popover; returns whether any was open (Esc handling). */
export function closeAllPopovers(): boolean {
  const any = openPopovers.size > 0;
  for (const p of [...openPopovers]) p.close();
  return any;
}

export function createPopover(anchor: HTMLElement, content: HTMLElement, label: string, d: Disposer): Popover {
  const el = h('div', { class: 'hoe-popover hoe-glass', role: 'dialog', 'aria-label': label, hidden: true }, content);
  anchor.setAttribute('aria-haspopup', 'dialog');
  anchor.setAttribute('aria-expanded', 'false');

  /**
   * On the side of the anchor with more room (above, for the controls at the bottom), limited to
   * that room so it never covers its anchor or leaves the viewport; taller content scrolls inside.
   */
  const place = (): void => {
    const a = anchor.getBoundingClientRect();
    const vh = window.innerHeight;
    const roomAbove = a.top - GAP - MARGIN;
    const roomBelow = vh - a.bottom - GAP - MARGIN;
    const above = roomAbove >= roomBelow;
    el.style.maxHeight = `${Math.max(MIN_HEIGHT, above ? roomAbove : roomBelow)}px`;
    const w = el.offsetWidth;
    const hgt = el.offsetHeight;
    const top = above ? a.top - GAP - hgt : a.bottom + GAP;
    el.style.left = `${Math.round(clamp(a.left + a.width / 2 - w / 2, MARGIN, window.innerWidth - w - MARGIN))}px`;
    el.style.top = `${Math.round(clamp(top, MARGIN, vh - hgt - MARGIN))}px`;
  };
  const onOutside = (e: PointerEvent): void => {
    const t = e.target as Node;
    if (!el.contains(t) && !anchor.contains(t)) api.close();
  };

  const api: Popover = {
    el,
    open() {
      if (!el.hidden) return;
      closeAllPopovers();
      el.hidden = false;
      place();
      openPopovers.add(api);
      anchor.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', onOutside, true);
      window.addEventListener('resize', place);
    },
    close() {
      if (el.hidden) return;
      el.hidden = true;
      openPopovers.delete(api);
      anchor.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onOutside, true);
      window.removeEventListener('resize', place);
    },
    toggle() {
      if (el.hidden) api.open(); else api.close();
    },
  };
  d.add(() => api.close());
  return api;
}
