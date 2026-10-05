/**
 * Playback engine (SPEC "Playback"): a requestAnimationFrame loop that advances `store.year`
 * at rateAt(year) × speed × direction years per second. The store is the source of truth for
 * playing/speed/direction, so UI code may also flip them directly with store.set().
 */
import type { HistoryEvent, Speed, Year } from '../types';
import { PRESENT_YEAR, TIMELINE_START } from '../types';
import { SPEEDS, type Store } from '../state/Store';
import { firstIndexAfter, firstIndexAtOrAfter } from './visible';

type RateFn = (y: Year) => number;
type EventPredicate = (e: HistoryEvent) => boolean;

/** Longest frame we integrate; after a stalled tab we resume instead of leaping ahead. */
const MAX_DT_SECONDS = 0.1;
/** A frame rarely crosses more than one or two chapter boundaries; this bounds the work per frame. */
const MAX_SUBSTEPS = 6;

/**
 * Advances `year` by `dt` seconds of playback. Rates are piecewise constant per chapter and drop
 * by orders of magnitude toward the present (1,000,000 yr/s in the Cenozoic, 2 yr/s in the Modern
 * era), so a single Euler step at the old rate would leap straight over whole slower chapters.
 * When a step lands somewhere slower, we stop at the boundary (found by bisection) and spend the
 * rest of the frame at the new rate. Returns the new year, clamped to the timeline.
 */
export function advanceYear(year: Year, dt: number, speed: number, direction: 1 | -1, rateAt: RateFn): Year {
  let y = year;
  let remaining = dt;
  for (let i = 0; i < MAX_SUBSTEPS && remaining > 0; i++) {
    const base = rateAt(y);
    const rate = base * speed;
    if (!(rate > 0)) break;
    const target = clampYear(y + direction * rate * remaining);
    if (target === y || rateAt(target) >= base) return target;
    const boundary = findRateChange(y, target, base, rateAt);
    remaining -= Math.abs(boundary - y) / rate;
    y = boundary;
  }
  return y;
}

/** First year past which rateAt differs from r (= rateAt(from)), between from and to (to is known to differ). */
function findRateChange(from: Year, to: Year, r: number, rateAt: RateFn): Year {
  let inside = from; // rate === r
  let outside = to;  // rate !== r
  // ~60 halvings reach double precision for any span on the timeline.
  for (let i = 0; i < 64 && Math.abs(outside - inside) > Math.abs(inside) * 1e-12 + 1e-9; i++) {
    const mid = (inside + outside) / 2;
    if (rateAt(mid) === r) inside = mid; else outside = mid;
  }
  return outside;
}

function clampYear(y: Year): Year {
  return Math.min(PRESENT_YEAR, Math.max(TIMELINE_START, y));
}

/** Year of the first event strictly after `year` (and within the timeline) that passes `filter`. */
export function nextEventYear(events: readonly HistoryEvent[], year: Year, filter?: EventPredicate): Year | undefined {
  for (let i = firstIndexAfter(events, year); i < events.length && events[i].year <= PRESENT_YEAR; i++) {
    if (!filter || filter(events[i])) return events[i].year;
  }
  return undefined;
}

/** Year of the last event strictly before `year` (and within the timeline) that passes `filter`. */
export function prevEventYear(events: readonly HistoryEvent[], year: Year, filter?: EventPredicate): Year | undefined {
  for (let i = firstIndexAtOrAfter(events, year) - 1; i >= 0 && events[i].year >= TIMELINE_START; i--) {
    if (!filter || filter(events[i])) return events[i].year;
  }
  return undefined;
}

/** Neighbouring entry of SPEEDS (clamped at both ends); tolerates a speed not in the list. */
export function shiftSpeed(current: Speed, delta: 1 | -1): Speed {
  let i = SPEEDS.indexOf(current);
  if (i < 0) i = SPEEDS.findIndex((s) => s >= current);
  if (i < 0) i = SPEEDS.length - 1;
  return SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, i + delta))];
}

const hasRaf = typeof requestAnimationFrame !== 'undefined';

export class Player {
  private readonly events: HistoryEvent[];
  private frame: number | null = null;
  private lastTime: number | null = null;
  private readonly unsubscribe: () => void;

  constructor(private readonly store: Store, private readonly rateAt: RateFn, events: HistoryEvent[]) {
    // Stepping relies on year order; a sorted copy also protects us from later caller mutation.
    this.events = [...events].sort((a, b) => a.year - b.year);
    this.unsubscribe = store.on('playing', (playing) => (playing ? this.startLoop() : this.stopLoop()));
    if (store.get().playing) this.startLoop();
  }

  /** Starts playback. At the end of the timeline in the current direction, restarts from the other end (like a video player). */
  play(): void {
    const { year, direction } = this.store.get();
    if (direction === 1 && year >= PRESENT_YEAR) this.store.setYear(TIMELINE_START);
    else if (direction === -1 && year <= TIMELINE_START) this.store.setYear(PRESENT_YEAR);
    this.store.set({ playing: true });
  }

  pause(): void {
    this.store.set({ playing: false });
  }

  toggle(): void {
    if (this.store.get().playing) this.pause(); else this.play();
  }

  setSpeed(s: Speed): void {
    this.store.set({ speed: s });
  }

  faster(): void {
    this.setSpeed(shiftSpeed(this.store.get().speed, 1));
  }

  slower(): void {
    this.setSpeed(shiftSpeed(this.store.get().speed, -1));
  }

  setDirection(d: 1 | -1): void {
    this.store.set({ direction: d });
  }

  /** Moves to y (clamped) without changing the playing state. */
  jumpTo(y: Year): void {
    this.store.setYear(y);
  }

  stepToNextEvent(filter?: EventPredicate): void {
    const y = nextEventYear(this.events, this.store.get().year, filter);
    if (y !== undefined) this.jumpTo(y);
  }

  stepToPrevEvent(filter?: EventPredicate): void {
    const y = prevEventYear(this.events, this.store.get().year, filter);
    if (y !== undefined) this.jumpTo(y);
  }

  /** Signed playback rate in years per second at the current year. */
  currentRate(): number {
    const { year, speed, direction } = this.store.get();
    return this.rateAt(year) * speed * direction;
  }

  destroy(): void {
    this.unsubscribe();
    this.stopLoop();
  }

  private startLoop(): void {
    if (!hasRaf || this.frame !== null) return;
    this.lastTime = null;
    this.frame = requestAnimationFrame(this.tick);
  }

  private stopLoop(): void {
    if (this.frame !== null && hasRaf) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.lastTime = null;
  }

  private readonly tick = (): void => {
    this.frame = null;
    const { year, speed, direction, playing } = this.store.get();
    if (!playing) return;
    const now = performance.now();
    // The first frame after (re)starting only records the clock, so playback never starts with a jump.
    const dt = this.lastTime === null ? 0 : Math.min(MAX_DT_SECONDS, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const next = advanceYear(year, dt, speed, direction, this.rateAt);
    this.store.setYear(next);
    const atEnd = direction === 1 ? next >= PRESENT_YEAR : next <= TIMELINE_START;
    if (atEnd) {
      this.store.set({ playing: false }); // the 'playing' listener stops the loop
      return;
    }
    this.frame = requestAnimationFrame(this.tick);
  };
}
