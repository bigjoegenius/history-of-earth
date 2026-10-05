/**
 * Deep links in the URL hash: `#y=-66000000` (year) and optionally `&e=<event id>` (selected event).
 * The hash follows the store with history.replaceState, so playback never floods the back button;
 * edits made by the user (typing a hash, back/forward) come back through `onNavigate`.
 */
import type { Store } from '../state/Store';
import type { Year } from '../types';
import { PRESENT_YEAR, TIMELINE_START } from '../types';

export interface UrlLink {
  year?: Year;
  eventId?: string;
}

/**
 * Safari throws after 100 replaceState calls in 30 s, so during playback the hash is refreshed
 * at most once per second (and immediately on pause or selection).
 */
const WRITE_INTERVAL_MS = 1000;

export function parseUrlHash(hash: string): UrlLink {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const link: UrlLink = {};
  const y = params.get('y');
  // Number('') is 0, so an empty "y=" must not become year 0.
  if (y !== null && y.trim() !== '' && Number.isFinite(Number(y))) {
    link.year = Math.min(PRESENT_YEAR, Math.max(TIMELINE_START, Number(y)));
  }
  const e = params.get('e');
  if (e) link.eventId = e;
  return link;
}

/**
 * Whole years (most event years after a jump or step, chapter starts) are kept exactly. Fractional
 * years are rounded to about 1/1000 s of 1× playback there (`rateYearsPerSec`): a thousand years
 * in deep time, a year in prehistory, hours in the Modern era, where event dates such as 1917.851
 * carry three decimals and must not round to just before the event they link to.
 */
export function roundYearForUrl(year: Year, rateYearsPerSec: number): string {
  if (Number.isInteger(year)) return String(year);
  const exponent = Math.floor(Math.log10(Math.max(rateYearsPerSec / 1000, 0.001)));
  const step = 10 ** exponent;
  const rounded = (Math.round(year / step) * step).toFixed(Math.max(0, -exponent));
  return String(Number(rounded)); // drops trailing zeros ("1914.50" → "1914.5") and "-0"
}

export function formatUrlHash(year: Year, eventId: string | null, rateYearsPerSec: number): string {
  const y = `#y=${roundYearForUrl(year, rateYearsPerSec)}`;
  return eventId ? `${y}&e=${encodeURIComponent(eventId)}` : y;
}

/** Keeps the hash in step with the store; returns an unbind function. */
export function bindUrlHash(
  store: Store,
  rateAt: (y: Year) => number,
  onNavigate: (link: UrlLink) => void,
): () => void {
  let timer: number | undefined;

  const write = (): void => {
    timer = undefined;
    const { year, selectedEventId } = store.get();
    const hash = formatUrlHash(year, selectedEventId, rateAt(year));
    if (hash === location.hash) return;
    try {
      history.replaceState(history.state, '', hash);
    } catch {
      // Rate-limited or sandboxed: the link is a convenience, never worth an error.
    }
  };
  const schedule = (): void => {
    timer ??= window.setTimeout(write, WRITE_INTERVAL_MS);
  };
  const flush = (): void => {
    if (timer !== undefined) window.clearTimeout(timer);
    write();
  };

  // replaceState never fires hashchange, so this only sees the user's own navigation.
  const onHashChange = (): void => onNavigate(parseUrlHash(location.hash));
  window.addEventListener('hashchange', onHashChange);
  const unbind = [
    store.on('year', schedule),
    store.on('playing', (playing) => { if (!playing) flush(); }),
    store.on('selectedEventId', flush),
  ];

  return () => {
    window.removeEventListener('hashchange', onHashChange);
    if (timer !== undefined) window.clearTimeout(timer);
    for (const off of unbind) off();
  };
}
