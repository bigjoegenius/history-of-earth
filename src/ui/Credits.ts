/** "Credits & sources" modal (native <dialog>: focus trap, Esc and backdrop for free). */
import { h, type Disposer } from './dom';
import { icon } from './icons';

const SOURCES: { name: string; what: string; license: string; url: string }[] = [
  { name: 'NASA GIBS', what: 'Blue Marble base imagery (Global Imagery Browse Services, NASA EOSDIS)', license: 'Public domain', url: 'https://nasa-gibs.github.io/gibs-api-docs/' },
  { name: 'Esri World Imagery', what: 'High-resolution imagery when zoomed in. Source: Esri, Maxar, Earthstar Geographics and the GIS User Community', license: 'Esri terms of use', url: 'https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9' },
  { name: 'GPlates Web Service · Merdith et al. 2021', what: 'Reconstructed palaeo-coastlines, 0–1000 Ma (Merdith et al. 2021, Earth-Science Reviews 214:103477)', license: 'Cite the paper', url: 'https://gwsdoc.gplates.org/' },
  { name: 'historical-basemaps', what: 'Historical political borders, by André Ourednik (aourednik)', license: 'GPL-3.0', url: 'https://github.com/aourednik/historical-basemaps' },
  { name: 'Natural Earth', what: 'Present-day country borders', license: 'Public domain', url: 'https://www.naturalearthdata.com/' },
  { name: 'Wikipedia', what: 'Article summaries and thumbnails via the Wikimedia REST API (images under their own licences)', license: 'CC BY-SA 4.0', url: 'https://en.wikipedia.org/' },
  { name: 'CesiumJS', what: '3D globe engine', license: 'Apache-2.0', url: 'https://cesium.com/platform/cesiumjs/' },
  { name: 'Material Design Icons', what: 'Interface icons', license: 'Apache-2.0', url: 'https://fonts.google.com/icons' },
];

export function createCredits(d: Disposer): { el: HTMLDialogElement; open(): void } {
  const el = h('dialog', { class: 'hoe-dialog', 'aria-labelledby': 'hoe-credits-title' }, h('div', { class: 'hoe-dialog__inner' },
    h('div', { class: 'hoe-dialog__head' },
      h('h2', { id: 'hoe-credits-title' }, 'Credits & sources'),
      h('button', { class: 'hoe-btn hoe-btn--icon', type: 'button', 'aria-label': 'Close', onclick: () => el.close() }, icon('close'))),
    h('ul', { class: 'hoe-credits' }, SOURCES.map((s) => h('li', null,
      h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.name, icon('external', 12)),
      h('span', { class: 'hoe-credits__license' }, s.license),
      h('p', null, s.what)))),
    h('p', { class: 'hoe-dialog__note' },
      'Event texts summarise mainstream scholarship and state dating uncertainty where it matters. ',
      'Debated ideas are marked “Debated”; fringe theories are included for interest, always labelled ',
      '“Fringe theory” and paired with what the evidence actually shows.')));
  // The dialog has no padding, so a click whose target is the dialog itself landed on the backdrop.
  d.listen<MouseEvent>(el, 'click', (e) => { if (e.target === el) el.close(); });
  d.add(() => el.close());
  return { el, open: () => el.showModal() };
}
