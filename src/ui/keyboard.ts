/**
 * Global shortcuts: Space play/pause · ←/→ prev/next event · , . slower/faster · T contents ·
 * / search contents · F fringe theories · Home/End start/now · Esc close. Ignored while typing in
 * a field, while a native modal is open, or when the focused control consumes the key itself.
 */
import { PRESENT_YEAR, TIMELINE_START } from '../types';
import type { UIDeps } from './context';
import { isActivatable, isFormField, type Disposer } from './dom';
import type { IntroOverlay } from './IntroOverlay';

export function bindKeyboard(
  deps: UIDeps, intro: IntroOverlay, escape: () => void, searchContents: () => void, d: Disposer,
): void {
  const { store, player } = deps;

  d.listen<KeyboardEvent>(window, 'keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;

    if (intro.isOpen()) {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        intro.dismiss(e.key !== 'Escape');
      }
      return;
    }

    if (isFormField(e.target)) {
      // Esc in an empty field closes things; with text, the browser clears the search box first.
      const value = (e.target as HTMLInputElement).value;
      if (e.key === 'Escape' && !value) escape();
      return;
    }

    let handled = true;
    switch (e.key) {
      case ' ':
        if (isActivatable(e.target)) return; // let the focused button/card handle Space
        player.toggle();
        break;
      case 'ArrowLeft':
        player.stepToPrevEvent(deps.filter());
        break;
      case 'ArrowRight':
        player.stepToNextEvent(deps.filter());
        break;
      case ',':
      case '<':
        player.slower();
        deps.toast(`Speed ${store.get().speed}×`);
        break;
      case '.':
      case '>':
        player.faster();
        deps.toast(`Speed ${store.get().speed}×`);
        break;
      case 't':
      case 'T':
        store.set({ tocOpen: !store.get().tocOpen });
        break;
      case '/':
        searchContents();
        break;
      case 'f':
      case 'F': {
        const show = !store.get().settings.showFringe;
        store.setSettings({ showFringe: show });
        deps.toast(show ? 'Fringe theories shown (always labelled)' : 'Fringe theories hidden');
        break;
      }
      case 'Home':
        deps.jumpToEra(TIMELINE_START);
        break;
      case 'End':
        deps.jumpToEra(PRESENT_YEAR);
        break;
      case 'Escape':
        escape();
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  });
}
