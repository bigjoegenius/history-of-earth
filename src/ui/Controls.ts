/**
 * Bottom-centre controls: jump chips above a transport bar
 * (Contents · ⏮ ⏯ ⏭ · speed · direction · Tour · Fringe · Settings).
 * Below 800 px the labels hide (icons only) and the chips scroll sideways.
 */
import type { Speed, Year } from '../types';
import { PRESENT_YEAR, TIMELINE_START } from '../types';
import { SPEEDS } from '../state/Store';
import { formatYear } from '../time/TimeModel';
import type { UIDeps } from './context';
import { blurAfterPointerClick, h, type Disposer } from './dom';
import { icon, type IconName } from './icons';
import { createPopover } from './Popover';
import { createSettingsPanel } from './SettingsPanel';

const JUMPS: { label: string; year: Year }[] = [
  { label: 'Formation', year: TIMELINE_START },
  { label: 'First life', year: -3.7e9 },
  { label: 'Oxygen', year: -2.4e9 },
  { label: 'Animals', year: -538.8e6 },
  { label: 'Dinosaurs', year: -230e6 },
  { label: 'Mammals', year: -66e6 },
  { label: 'Humans', year: -300_000 },
  { label: 'Civilization', year: -3500 },
  { label: 'Now', year: PRESENT_YEAR },
];

interface ButtonOpts { shortcut?: string; labelled?: boolean; className?: string; size?: number }

/** Icon button; after a mouse click it drops focus so Space keeps meaning play/pause. */
function button(label: string, iconName: IconName, onClick: () => void, o: ButtonOpts = {}): HTMLButtonElement {
  const b = h('button', {
    class: `hoe-btn ${o.labelled ? '' : 'hoe-btn--icon '}${o.className ?? ''}`.trim(),
    type: 'button',
    'aria-label': label,
    title: o.shortcut ? `${label} (${o.shortcut})` : label,
    onclick: (e: MouseEvent) => {
      onClick();
      blurAfterPointerClick(e);
    },
  }, icon(iconName, o.size), o.labelled ? h('span', { class: 'hoe-btn__label' }, label) : null);
  return b;
}

export function createControls(deps: UIDeps, openCredits: () => void, d: Disposer): HTMLElement {
  const { store, player } = deps;

  /* Jump chips */
  const chips = JUMPS.map((j) => h('button', {
    class: 'hoe-jump',
    type: 'button',
    title: formatYear(j.year),
    onclick: () => deps.jumpToEra(j.year),
  }, j.label));
  let hereIndex = -1;
  // On phones the chip row scrolls sideways; keep "you are here" in view.
  const revealHere = (): void => {
    if (deps.mobile.get()) chips[hereIndex]?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  };
  const syncChips = (y: Year): void => {
    let i = -1;
    while (i + 1 < JUMPS.length && JUMPS[i + 1].year <= y + 1e-6) i++;
    if (i === hereIndex) return;
    chips[hereIndex]?.classList.remove('is-here');
    chips[hereIndex]?.removeAttribute('aria-current');
    chips[i]?.classList.add('is-here');
    chips[i]?.setAttribute('aria-current', 'true');
    hereIndex = i;
    revealHere();
  };

  /* Transport */
  const toc = button('Contents', 'menu', () => store.set({ tocOpen: !store.get().tocOpen }), { shortcut: 'T', labelled: true, className: 'hoe-btn--toc' });
  const prev = button('Previous event', 'prev', () => player.stepToPrevEvent(deps.filter()), { shortcut: '←' });
  const play = button('Play', 'play', () => player.toggle(), { shortcut: 'Space', className: 'hoe-btn--play', size: 26 });
  const next = button('Next event', 'next', () => player.stepToNextEvent(deps.filter()), { shortcut: '→' });
  const speedBtn = h('button', { class: 'hoe-btn hoe-btn--speed', type: 'button', title: 'Playback speed (, and .)' });
  const dir = button('Play backwards', 'back', () => player.setDirection(store.get().direction === 1 ? -1 : 1));
  const tour = button('Tour', 'flight', () => store.setSettings({ tour: !store.get().settings.tour }), { labelled: true });
  const fringe = button('Fringe', 'help', () => store.setSettings({ showFringe: !store.get().settings.showFringe }), { shortcut: 'F', labelled: true });
  fringe.title = 'Show fringe theories, always labelled as such (F)';
  const settingsBtn = button('Settings', 'tune', () => settingsPop.toggle());

  const speedItems = SPEEDS.map((s) => h('button', {
    class: 'hoe-speed__item', type: 'button',
    onclick: () => {
      player.setSpeed(s);
      speedPop.close();
    },
  }, `${s}×`));
  const speedPop = createPopover(speedBtn, h('div', { class: 'hoe-speed' }, h('h3', { class: 'hoe-pop__title' }, 'Speed'), speedItems), 'Playback speed', d);
  d.listen(speedBtn, 'click', () => speedPop.toggle());
  const settingsPop = createPopover(settingsBtn, createSettingsPanel(deps, () => {
    settingsPop.close();
    openCredits();
  }, d), 'Settings', d);

  const sep = (): HTMLElement => h('span', { class: 'hoe-sep', 'aria-hidden': 'true' });
  const el = h('div', { class: 'hoe-controls' },
    h('div', { class: 'hoe-jumps', role: 'toolbar', 'aria-label': 'Jump to' }, chips),
    h('div', { class: 'hoe-transport hoe-glass', role: 'toolbar', 'aria-label': 'Playback' },
      toc, sep(), prev, play, next, sep(), speedBtn, dir, sep(), tour, fringe, settingsBtn));
  deps.root.append(speedPop.el, settingsPop.el);

  /* Store → view */
  const syncPlaying = (playing: boolean): void => {
    play.replaceChildren(icon(playing ? 'pause' : 'play', 26));
    play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    play.title = `${playing ? 'Pause' : 'Play'} (Space)`;
  };
  const syncSpeed = (speed: Speed): void => {
    speedBtn.textContent = `${speed}×`;
    speedBtn.setAttribute('aria-label', `Playback speed: ${speed}×`);
    speedItems.forEach((b, i) => b.setAttribute('aria-pressed', String(SPEEDS[i] === speed)));
  };
  const syncDirection = (direction: 1 | -1): void => {
    // The icon shows the current direction; the button is a "play backwards" toggle.
    dir.replaceChildren(icon(direction === 1 ? 'forward' : 'back'));
    dir.title = `Direction: ${direction === 1 ? 'forwards' : 'backwards'} (click to reverse)`;
    dir.setAttribute('aria-pressed', String(direction === -1));
  };
  const syncToggles = (): void => {
    const s = store.get().settings;
    tour.setAttribute('aria-pressed', String(s.tour));
    fringe.setAttribute('aria-pressed', String(s.showFringe));
  };
  const syncToc = (open: boolean): void => {
    toc.setAttribute('aria-expanded', String(open));
    toc.setAttribute('aria-pressed', String(open));
  };
  d.add(store.on('playing', syncPlaying));
  d.add(store.on('speed', syncSpeed));
  d.add(store.on('direction', syncDirection));
  d.add(store.on('settings', syncToggles));
  d.add(store.on('tocOpen', syncToc));
  d.add(store.on('year', syncChips));
  const s = store.get();
  syncPlaying(s.playing);
  syncSpeed(s.speed);
  syncDirection(s.direction);
  syncToggles();
  syncToc(s.tocOpen);
  syncChips(s.year);
  requestAnimationFrame(revealHere); // the first sync ran before the row was in the document
  return el;
}
