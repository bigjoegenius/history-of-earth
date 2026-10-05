/**
 * Era header at the top of the Now panel: Part › Chapter › Section breadcrumb (click = show that
 * chapter on the detail ruler), deepest title, and collapsible details: description (clamped, with
 * More), PlanetState chips and the reconstruction badge (how the globe is being drawn right now).
 * The details fold away whenever playback starts, so arriving events stay near the top of the
 * panel; the user can reopen them at any time.
 */
import type { Chapter, GlobeStyle, PlanetState } from '../types';
import { styleAt } from '../data/index';
import { formatDuration } from '../time/TimeModel';
import { chapterRange, type UIDeps } from './context';
import { blurAfterPointerClick, h, type Disposer } from './dom';
import { icon } from './icons';

const PLANET_LABELS: Record<keyof PlanetState, string> = {
  o2: 'O₂', co2: 'CO₂', temperature: 'Temp', seaLevel: 'Sea level', dayLength: 'Day',
  life: 'Life', continents: 'Land', humans: 'Humans',
};

const RECONSTRUCTION: Record<GlobeStyle['mode'], { label: string; hint: string }> = {
  satellite: {
    label: 'Satellite imagery',
    hint: 'Present-day NASA / Esri imagery: coastlines and ice are modern, not reconstructed.',
  },
  paleo: {
    label: 'Plate model (Merdith 2021)',
    hint: 'Coastlines reconstructed with the Merdith et al. 2021 plate model via the GPlates Web Service.',
  },
  schematic: {
    label: 'Illustrative',
    hint: 'No reliable reconstruction exists this far back; the surface is an artistic impression.',
  },
};

/** Planet state for the path: deeper chapters override their parents field by field. */
function mergedPlanet(path: Chapter[]): PlanetState {
  return Object.assign({}, ...path.map((c) => c.planet ?? {}));
}

export function createEraHeader(deps: UIDeps, d: Disposer): HTMLElement {
  const { store } = deps;
  const crumbs = h('nav', { class: 'hoe-era__crumbs', 'aria-label': 'Current era' });
  const title = h('h2', { class: 'hoe-era__title' });
  const toggle = h('button', {
    class: 'hoe-btn hoe-btn--icon hoe-era__toggle', type: 'button', 'aria-controls': 'hoe-era-details',
  }, icon('caret', 18));
  const subtitle = h('div', { class: 'hoe-era__subtitle' });
  const desc = h('p', { class: 'hoe-era__desc is-clamped' });
  const more = h('button', { class: 'hoe-linkbtn', type: 'button', hidden: true }, 'More');
  const chips = h('div', { class: 'hoe-era__chips' });
  const recon = h('div', { class: 'hoe-era__recon' });
  const details = h('div', { class: 'hoe-era__details', id: 'hoe-era-details' }, desc, more, chips, recon);
  const el = h('header', { class: 'hoe-era' },
    crumbs, h('div', { class: 'hoe-era__head' }, title, toggle), subtitle, details);

  let detailsOpen = false;
  /** Full description (the "More" link) vs. the two-line clamp. */
  let descExpanded = false;
  const syncMore = (): void => {
    desc.classList.toggle('is-clamped', !descExpanded);
    more.textContent = descExpanded ? 'Less' : 'More';
    // Measure after layout: only offer the toggle when the clamp actually hides text.
    requestAnimationFrame(() => {
      more.hidden = !detailsOpen || (!descExpanded && desc.scrollHeight <= desc.clientHeight + 1);
    });
  };
  d.listen<MouseEvent>(more, 'click', (e) => {
    descExpanded = !descExpanded;
    syncMore();
    blurAfterPointerClick(e);
  });

  const setDetailsOpen = (open: boolean): void => {
    detailsOpen = open;
    details.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    const label = open ? 'Hide era details' : 'Show era details';
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    if (open) syncMore();
  };
  d.listen<MouseEvent>(toggle, 'click', (e) => {
    setDetailsOpen(!detailsOpen);
    blurAfterPointerClick(e);
  });
  d.add(store.on('playing', (playing) => { if (playing) setDetailsOpen(false); }));
  setDetailsOpen(!store.get().playing);

  const render = (path: Chapter[]): void => {
    const deepest = path.at(-1);
    if (!deepest) return;
    crumbs.replaceChildren(...path.flatMap((c, i) => [
      i > 0 ? h('span', { class: 'hoe-era__sep', 'aria-hidden': 'true' }, '›') : null,
      h('button', {
        class: 'hoe-era__crumb',
        type: 'button',
        title: `Show ${c.title} on the detail timeline`,
        onclick: () => store.set({ detailRange: [c.start, c.end] }),
      }, c.title),
    ].filter((n): n is HTMLElement => n !== null)));
    title.textContent = deepest.title;
    const sub = [...path].reverse().find((c) => c.subtitle)?.subtitle;
    subtitle.textContent = [
      sub,
      `${chapterRange(deepest)} · ${formatDuration(deepest.end - deepest.start)}`,
    ].filter(Boolean).join(' · ');
    desc.textContent = [...path].reverse().find((c) => c.description)?.description ?? '';
    syncMore();

    const planet = mergedPlanet(path);
    chips.replaceChildren(...(Object.keys(PLANET_LABELS) as (keyof PlanetState)[])
      .filter((k) => planet[k])
      .map((k) => h('span', { class: 'hoe-chip', title: `${PLANET_LABELS[k]}: ${planet[k]}` },
        h('b', null, PLANET_LABELS[k]), ` ${planet[k]}`)));

    const mode = styleAt(store.get().year).mode;
    const r = RECONSTRUCTION[mode];
    recon.replaceChildren(
      h('span', { class: 'hoe-era__recon-label' }, 'Reconstruction'),
      h('span', { class: `hoe-badge hoe-badge--recon is-${mode}`, title: r.hint }, r.label),
    );
  };
  d.add(deps.path.on(render));
  render(deps.path.get());
  return el;
}
