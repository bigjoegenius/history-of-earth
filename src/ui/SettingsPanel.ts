/** Contents of the settings popover: a switch per boolean setting, the importance slider, credits, shortcuts. */
import type { Settings } from '../types';
import type { UIDeps } from './context';
import { h, type Disposer } from './dom';

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

const TOGGLES: { key: BoolKey; label: string; hint: string }[] = [
  { key: 'showMarkers', label: 'Event markers', hint: 'Coloured pins on the globe' },
  { key: 'showFringe', label: 'Fringe theories', hint: 'Always labelled “Fringe theory” (F)' },
  { key: 'tour', label: 'Tour', hint: 'Fly to landmark events while playing' },
  { key: 'showBorders', label: 'Historical borders', hint: 'States and empires in the human era' },
  { key: 'showLabels', label: 'Border labels', hint: 'Names on the borders' },
  { key: 'highResImagery', label: 'High-res imagery', hint: 'Esri World Imagery when zoomed in' },
  { key: 'lighting', label: 'Sunlight', hint: 'Day and night shading' },
];

const IMPORTANCE: Record<Settings['minImportance'], string> = {
  1: 'All events', 2: 'Minor and up', 3: 'Notable and up', 4: 'Major and up', 5: 'Landmarks only',
};

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'], ['← →', 'Previous / next event'], [', .', 'Slower / faster'],
  ['T', 'Contents'], ['/', 'Search contents'], ['F', 'Fringe theories'], ['Home End', 'Start / now'], ['Esc', 'Close'],
];

export function createSettingsPanel(deps: UIDeps, openCredits: () => void, d: Disposer): HTMLElement {
  const { store } = deps;
  const inputs = new Map<BoolKey, HTMLInputElement>();
  const switches = TOGGLES.map((t) => {
    const input = h('input', { type: 'checkbox', role: 'switch', class: 'hoe-switch__input' });
    d.listen(input, 'change', () => store.setSettings({ [t.key]: input.checked } as Partial<Settings>));
    inputs.set(t.key, input);
    return h('label', { class: 'hoe-switch' },
      input,
      h('span', { class: 'hoe-switch__track', 'aria-hidden': 'true' }),
      h('span', { class: 'hoe-switch__text' }, t.label, h('small', null, t.hint)));
  });

  const range = h('input', { type: 'range', min: 1, max: 5, step: 1, class: 'hoe-range', id: 'hoe-min-importance' });
  const rangeOut = h('output', { class: 'hoe-range__out', for: 'hoe-min-importance' });
  d.listen(range, 'input', () => store.setSettings({ minImportance: Number(range.value) as Settings['minImportance'] }));

  const sync = (s: Settings): void => {
    for (const [key, input] of inputs) input.checked = s[key];
    range.value = String(s.minImportance);
    rangeOut.textContent = IMPORTANCE[s.minImportance];
  };
  d.add(store.on('settings', sync));
  sync(store.get().settings);

  return h('div', { class: 'hoe-settings' },
    h('h3', { class: 'hoe-pop__title' }, 'Settings'),
    h('div', { class: 'hoe-settings__switches' }, switches),
    h('div', { class: 'hoe-settings__range' },
      h('label', { for: 'hoe-min-importance' }, 'Show events'), rangeOut, range),
    h('button', { class: 'hoe-linkbtn', type: 'button', onclick: openCredits }, 'Credits & sources'),
    h('dl', { class: 'hoe-shortcuts' }, SHORTCUTS.flatMap(([k, v]) => [h('dt', null, h('kbd', null, k)), h('dd', null, v)])));
}
