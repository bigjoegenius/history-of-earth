import { clamp, h } from './dom';

export interface Tooltip {
  el: HTMLElement;
  /** Shows `content` centred on x with its top edge at y (viewport px); flips above when near the bottom. */
  show(x: number, y: number, content: string | Node): void;
  hide(): void;
}

/** One shared hover tooltip for both timelines (fixed-positioned so it can overflow the bar). */
export function createTooltip(): Tooltip {
  const el = h('div', { class: 'hoe-tip', role: 'tooltip' });
  let current: string | Node | null = null;
  return {
    el,
    show(x, y, content) {
      if (content !== current) {
        el.replaceChildren(content);
        current = content;
      }
      el.classList.add('is-visible');
      const w = el.offsetWidth;
      const hgt = el.offsetHeight;
      const left = clamp(x - w / 2, 6, window.innerWidth - w - 6);
      const top = y + hgt + 6 > window.innerHeight ? y - hgt - 40 : y;
      el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    },
    hide() {
      el.classList.remove('is-visible');
      current = null;
    },
  };
}
