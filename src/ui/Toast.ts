import { h, type Disposer } from './dom';

/** Brief status message (speed changed, fringe toggled…) shown under the timeline. */
export function createToast(d: Disposer): { el: HTMLElement; show(message: string): void } {
  const el = h('div', { class: 'hoe-toast hoe-glass', role: 'status', 'aria-live': 'polite' });
  let timer = 0;
  d.add(() => window.clearTimeout(timer));
  return {
    el,
    show(message) {
      el.textContent = message;
      el.classList.add('is-visible');
      window.clearTimeout(timer);
      timer = window.setTimeout(() => el.classList.remove('is-visible'), 1600);
    },
  };
}
