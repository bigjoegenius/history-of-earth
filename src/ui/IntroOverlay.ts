/**
 * First-visit intro: title, pitch, "Press play". Dismissed by any click or Space (Space and the
 * button also start playback); the dismissal is remembered in localStorage.
 */
import type { UIDeps } from './context';
import { h, storageGet, storageSet, type Disposer } from './dom';
import { icon } from './icons';

export const INTRO_STORAGE_KEY = 'hoe:intro-dismissed';

export interface IntroOverlay {
  /** Null when the intro was dismissed on an earlier visit. */
  el: HTMLElement | null;
  isOpen(): boolean;
  dismiss(play: boolean): void;
}

export function createIntroOverlay(deps: UIDeps, d: Disposer): IntroOverlay {
  if (storageGet(INTRO_STORAGE_KEY)) return { el: null, isOpen: () => false, dismiss: () => {} };

  let open = true;
  const dismiss = (play: boolean): void => {
    if (!open) return;
    open = false;
    storageSet(INTRO_STORAGE_KEY, '1');
    el.classList.add('is-leaving');
    // Remove after the fade (or at once with reduced motion, where the transition is ~0 ms).
    window.setTimeout(() => el.remove(), 260);
    if (play) deps.player.play();
  };
  const playBtn = h('button', {
    class: 'hoe-btn hoe-btn--primary', type: 'button',
    onclick: (e: MouseEvent) => {
      e.stopPropagation();
      dismiss(true);
    },
  }, icon('play', 22), 'Press play');
  const el = h('div', { class: 'hoe-intro', role: 'dialog', 'aria-labelledby': 'hoe-intro-title', onclick: () => dismiss(false) },
    h('div', { class: 'hoe-intro__card hoe-glass' },
      h('p', { class: 'hoe-intro__kicker' }, '4.54 billion years · one globe'),
      h('h1', { id: 'hoe-intro-title' }, 'History of Earth'),
      h('p', { class: 'hoe-intro__pitch' },
        'Watch a molten world cool, oceans and the first cells appear, oxygen fill the sky, continents drift ',
        'and collide, life explode and nearly vanish five times, and humans build cities, empires and spacecraft. ',
        'Everything is mainstream science and history; debated ideas and fringe theories are clearly labelled.'),
      playBtn,
      h('p', { class: 'hoe-intro__hint' },
        window.matchMedia('(pointer: coarse)').matches
          ? 'Drag the timeline to scrub · pinch the lower ruler to zoom · tap any card for details'
          : 'Drag the timeline to scrub · scroll the lower ruler to zoom · click any card for details',
        h('br'),
        h('kbd', null, 'Space'), ' play/pause · ', h('kbd', null, '←'), h('kbd', null, '→'), ' events · ',
        h('kbd', null, 'T'), ' contents · ', h('kbd', null, 'F'), ' fringe theories'),
      h('p', { class: 'hoe-intro__skip' }, 'Click anywhere to explore on your own')));
  d.add(() => el.remove());
  requestAnimationFrame(() => playBtn.focus({ preventScroll: true }));
  return { el, isOpen: () => open, dismiss };
}
