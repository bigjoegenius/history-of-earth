/**
 * Visual test harness for the globe (open /globe-test.html on the dev server).
 * Exercises every rendering path: schematic surfaces, paleo snapshots, ice, borders,
 * markers (incl. a fringe theory and a selected marker), camera flights and settings.
 */
import { createGlobe } from '../globe/Globe';
import { styleAt } from '../data/index';
import { DEFAULT_SETTINGS } from '../state/Store';
import type { GlobeStyle, HistoryEvent, Settings, Year } from '../types';
import { PRESENT_YEAR } from '../types';

interface Preset {
  label: string;
  year: Year;
  /** What this case is meant to test; merged over styleAt() while "force" is on, so every path
   *  is exercised even while chapters.json is still a placeholder. */
  expect: Partial<GlobeStyle>;
}

const PRESETS: Preset[] = [
  { label: '4.5 Ga magma', year: -4.5e9, expect: { mode: 'schematic', schematic: 'magma', atmosphere: 'orange', iceCapLatitude: 90 } },
  { label: '4.2 Ga cooling', year: -4.2e9, expect: { mode: 'schematic', schematic: 'cooling', atmosphere: 'orange', iceCapLatitude: 90 } },
  { label: '3.5 Ga waterworld', year: -3.5e9, expect: { mode: 'schematic', schematic: 'waterworld', atmosphere: 'hazy', iceCapLatitude: 90 } },
  { label: '2 Ga cratons', year: -2e9, expect: { mode: 'schematic', schematic: 'cratons', atmosphere: 'thin', iceCapLatitude: 90 } },
  { label: '700 Ma snowball', year: -700e6, expect: { mode: 'paleo', iceCapLatitude: 0, atmosphere: 'normal' } },
  { label: '250 Ma Pangaea', year: -250e6, expect: { mode: 'paleo', plateBoundaries: true, iceCapLatitude: 90 } },
  { label: '66 Ma', year: -66e6, expect: { mode: 'paleo', iceCapLatitude: 90 } },
  { label: '20 ka (ice 45°)', year: -20_000, expect: { mode: 'satellite', iceCapLatitude: 45, borders: false } },
  { label: '500 BCE', year: -500, expect: { mode: 'satellite', borders: true } },
  { label: '1500', year: 1500, expect: { mode: 'satellite', borders: true } },
  { label: '1914', year: 1914, expect: { mode: 'satellite', borders: true } },
  { label: '2026', year: 2026, expect: { mode: 'satellite', borders: true } },
];

const ev = (e: Omit<HistoryEvent, 'summary' | 'description'>): HistoryEvent => ({ summary: e.title, description: e.title, ...e });
const EVENTS: HistoryEvent[] = [
  ev({ id: 'test-chicxulub', title: 'Chicxulub impact', year: -66e6, lat: 21.4, lon: -89.5, category: 'extinction', importance: 5, consensus: 'established' }),
  ev({ id: 'test-pyramid', title: 'Great Pyramid of Giza', year: -2560, lat: 29.98, lon: 31.13, category: 'culture', importance: 4, consensus: 'established' }),
  ev({ id: 'test-hastings', title: 'Battle of Hastings', year: 1066, lat: 50.91, lon: 0.49, category: 'war', importance: 3, consensus: 'established' }),
  ev({ id: 'test-atlantis', title: 'Atlantis', year: -9600, lat: 36.4, lon: 25.4, category: 'fringe', importance: 4, consensus: 'fringe', mainstreamView: 'A literary invention of Plato.' }),
  ev({ id: 'test-columbus', title: 'Columbus reaches the Bahamas', year: 1492.78, lat: 24.1, lon: -74.5, category: 'exploration', importance: 4, consensus: 'established' }),
  ev({ id: 'test-tambora', title: 'Tambora eruption', year: 1815.3, lat: -8.25, lon: 118.0, category: 'disaster', importance: 2, consensus: 'established' }),
  ev({ id: 'test-goe', title: 'Great Oxidation Event', year: -2.4e9, lat: 0, lon: 0, global: true, category: 'climate', importance: 5, consensus: 'majority' }),
];

async function main(): Promise<void> {
  const container = document.getElementById('globe');
  const panel = document.getElementById('panel');
  if (!container || !panel) return;
  const globe = await createGlobe(container);
  (window as unknown as { globe: unknown }).globe = globe; // for poking at it from the console

  let settings: Settings = { ...DEFAULT_SETTINGS };
  let force = true;
  let year: Year = PRESETS[0].year;
  let override: Partial<GlobeStyle> = PRESETS[0].expect;
  let selected: string | null = 'test-chicxulub';
  let animating = false;

  const readout = document.createElement('pre');
  const styleFor = (y: Year): GlobeStyle => (force ? { ...styleAt(y), ...override } : styleAt(y));
  const apply = (): void => {
    const s = styleFor(year);
    globe.setYear(year, s);
    readout.textContent = `year ${Math.round(year).toLocaleString()}  selected ${selected ?? '–'}\n${JSON.stringify(s)}`;
  };

  const section = (title: string): HTMLDivElement => {
    const h = document.createElement('h2');
    h.textContent = title;
    const row = document.createElement('div');
    row.className = 'row';
    panel.append(h, row);
    return row;
  };
  const button = (row: HTMLElement, text: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = text;
    b.onclick = onClick;
    row.append(b);
    return b;
  };
  const toggle = (row: HTMLElement, text: string, checked: boolean, onChange: (v: boolean) => void): void => {
    const l = document.createElement('label');
    const i = document.createElement('input');
    i.type = 'checkbox';
    i.checked = checked;
    i.onchange = () => onChange(i.checked);
    l.append(i, text);
    row.append(l);
  };

  const yearRow = section('Years');
  const yearButtons = PRESETS.map((p) => button(yearRow, p.label, () => {
    animating = false;
    year = p.year;
    override = p.expect;
    yearButtons.forEach((b) => b.classList.toggle('active', b.textContent === p.label));
    apply();
  }));
  yearButtons[0].classList.add('active');

  const scrubRow = section('Paleo scrub (Ma) — setYear on every input event');
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1000';
  slider.step = '1';
  slider.value = '250';
  slider.oninput = () => {
    animating = false;
    year = PRESENT_YEAR - Number(slider.value) * 1e6;
    override = { mode: 'paleo' };
    apply();
  };
  scrubRow.append(slider);
  button(scrubRow, 'Animate 540 → 0 Ma at 30 Ma/s', () => {
    animating = true;
    override = { mode: 'paleo' };
    let last = performance.now();
    year = -540e6;
    const frame = (now: number): void => {
      if (!animating) return;
      year = Math.min(0, year + ((now - last) / 1000) * 30e6);
      last = now;
      slider.value = String(Math.round((PRESENT_YEAR - year) / 1e6));
      apply();
      if (year < 0) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });

  const settingsRow = section('Settings');
  const setting = (key: 'lighting' | 'highResImagery' | 'showBorders' | 'showLabels' | 'showMarkers' | 'showFringe', text: string): void =>
    toggle(settingsRow, text, settings[key], (v) => {
      settings = { ...settings, [key]: v };
      globe.setSettings(settings);
    });
  setting('lighting', 'lighting');
  setting('highResImagery', 'high-res');
  setting('showBorders', 'borders');
  setting('showLabels', 'labels');
  setting('showMarkers', 'markers');
  setting('showFringe', 'fringe');
  toggle(settingsRow, 'force expected style', force, (v) => { force = v; apply(); });

  const markerRow = section('Markers & camera');
  const select = (id: string | null): void => {
    selected = id;
    globe.setSelected(id);
    apply();
  };
  button(markerRow, 'Select next', () => {
    const located = EVENTS.filter((e) => !e.global);
    const i = located.findIndex((e) => e.id === selected);
    select(located[(i + 1) % located.length].id);
  });
  button(markerRow, 'Deselect', () => select(null));
  button(markerRow, 'Pulse selected', () => { if (selected) globe.pulse(selected); });
  button(markerRow, 'Fly to selected', () => {
    const e = EVENTS.find((x) => x.id === selected);
    if (e) globe.flyToEvent(e);
  });
  button(markerRow, 'Fly to global event', () => globe.flyToEvent(EVENTS[EVENTS.length - 1]));
  button(markerRow, 'Fly to Alps 800 km', () => globe.flyTo(46.5, 10, 800));

  panel.append(readout);

  globe.onEventClick((id) => select(id));
  globe.setSettings(settings);
  globe.setEvents(EVENTS);
  globe.setSelected(selected);
  apply();
}

void main();
