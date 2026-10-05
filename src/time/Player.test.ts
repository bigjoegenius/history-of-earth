import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HistoryEvent } from '../types';
import { PRESENT_YEAR, TIMELINE_START } from '../types';
import { Store } from '../state/Store';
import { Player, advanceYear, nextEventYear, prevEventYear, shiftSpeed } from './Player';

function ev(id: string, year: number, patch: Partial<HistoryEvent> = {}): HistoryEvent {
  return {
    id, title: id, year, lat: 0, lon: 0, category: 'culture', importance: 3,
    summary: '', description: '', consensus: 'established', ...patch,
  };
}

const EVENTS = [
  ev('a', -1000),
  ev('b', 0, { importance: 1 }),
  ev('c', 0, { importance: 5 }),
  ev('d', 500, { consensus: 'fringe', category: 'fringe' }),
  ev('e', 1000),
  ev('future', 3000),
];

/** 1000 yr/s before year 0, 1 yr/s after: a sharp slowdown like Cenozoic → human history. */
const stepRate = (y: number) => (y < 0 ? 1000 : 1);

describe('advanceYear', () => {
  it('moves by rate × speed × direction × dt within one rate region', () => {
    expect(advanceYear(-5000, 0.5, 2, 1, stepRate)).toBeCloseTo(-4000, 9);
    expect(advanceYear(-5000, 0.5, 2, -1, stepRate)).toBeCloseTo(-6000, 9);
    expect(advanceYear(100, 0.1, 1, 1, stepRate)).toBeCloseTo(100.1, 9);
  });

  it('stops at a slowdown and spends the rest of the frame at the new rate', () => {
    // 0.01 s reaches year 0 at 1000 yr/s; the remaining 0.99 s runs at 1 yr/s.
    expect(advanceYear(-10, 1, 1, 1, stepRate)).toBeCloseTo(0.99, 6);
  });

  it('clamps to the ends of the timeline', () => {
    expect(advanceYear(PRESENT_YEAR - 0.1, 1, 100, 1, stepRate)).toBe(PRESENT_YEAR);
    expect(advanceYear(TIMELINE_START + 10, 1, 100, -1, stepRate)).toBe(TIMELINE_START);
  });

  it('does nothing for a zero-length frame', () => {
    expect(advanceYear(123, 0, 1, 1, stepRate)).toBe(123);
  });
});

describe('event stepping helpers', () => {
  it('finds the next distinct event year, skipping same-year events', () => {
    expect(nextEventYear(EVENTS, -2000)).toBe(-1000);
    expect(nextEventYear(EVENTS, -1000)).toBe(0);
    expect(nextEventYear(EVENTS, 0)).toBe(500);
    expect(nextEventYear(EVENTS, 1000)).toBeUndefined(); // 3000 is beyond the present
  });

  it('finds the previous distinct event year', () => {
    expect(prevEventYear(EVENTS, 1000)).toBe(500);
    expect(prevEventYear(EVENTS, 0)).toBe(-1000);
    expect(prevEventYear(EVENTS, -1000)).toBeUndefined();
  });

  it('honours the filter', () => {
    const noFringe = (e: HistoryEvent) => e.consensus !== 'fringe';
    expect(nextEventYear(EVENTS, 0, noFringe)).toBe(1000);
    expect(prevEventYear(EVENTS, 1000, noFringe)).toBe(0);
    const landmarks = (e: HistoryEvent) => e.importance >= 5;
    expect(nextEventYear(EVENTS, -2000, landmarks)).toBe(0);
  });
});

describe('shiftSpeed', () => {
  it('walks SPEEDS and clamps at both ends', () => {
    expect(shiftSpeed(1, 1)).toBe(2);
    expect(shiftSpeed(1, -1)).toBe(0.5);
    expect(shiftSpeed(100, 1)).toBe(100);
    expect(shiftSpeed(0.1, -1)).toBe(0.1);
  });
});

describe('Player (no requestAnimationFrame in Node)', () => {
  it('steps through events with jumpTo, keeping the playing state', () => {
    const store = new Store({ year: -2000 });
    const player = new Player(store, stepRate, [...EVENTS].reverse()); // unsorted input is fine
    player.stepToNextEvent();
    expect(store.get().year).toBe(-1000);
    player.stepToNextEvent();
    player.stepToNextEvent();
    expect(store.get().year).toBe(500);
    player.stepToNextEvent((e) => e.importance >= 5); // nothing later qualifies
    expect(store.get().year).toBe(500);
    player.stepToPrevEvent();
    expect(store.get().year).toBe(0);
    expect(store.get().playing).toBe(false);
    player.destroy();
  });

  it('controls playing, speed and direction through the store', () => {
    const store = new Store({ year: 100 });
    const player = new Player(store, stepRate, EVENTS);
    player.toggle();
    expect(store.get().playing).toBe(true);
    player.jumpTo(200);
    expect(store.get()).toMatchObject({ year: 200, playing: true });
    player.toggle();
    expect(store.get().playing).toBe(false);
    player.faster();
    player.faster();
    expect(store.get().speed).toBe(4);
    player.slower();
    expect(store.get().speed).toBe(2);
    player.setDirection(-1);
    expect(player.currentRate()).toBe(-2);
    player.jumpTo(-50);
    expect(player.currentRate()).toBe(-2000);
    player.jumpTo(1e12);
    expect(store.get().year).toBe(PRESENT_YEAR);
    player.destroy();
  });

  it('restarts from the other end when played at the end of the timeline', () => {
    const store = new Store({ year: PRESENT_YEAR });
    const player = new Player(store, stepRate, EVENTS);
    player.play();
    expect(store.get()).toMatchObject({ year: TIMELINE_START, playing: true });
    player.pause();
    player.setDirection(-1);
    player.play();
    expect(store.get()).toMatchObject({ year: PRESENT_YEAR, playing: true });
    player.destroy();
  });
});

describe('Player animation loop (stubbed requestAnimationFrame)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  /** Loads a fresh Player module after installing fake rAF + clock, since rAF support is detected at import. */
  async function setup() {
    const pending = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { pending.set(nextId, cb); return nextId++; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { pending.delete(id); });
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.resetModules();
    const mod = await import('./Player');
    /** Advances the clock and runs the oldest pending frame; false when none was scheduled. */
    const runFrame = (advanceMs: number): boolean => {
      now += advanceMs;
      const first = pending.entries().next();
      if (first.done) return false;
      pending.delete(first.value[0]);
      first.value[1](now);
      return true;
    };
    return { Player: mod.Player, runFrame };
  }

  it('advances the year each frame and auto-pauses at the present', async () => {
    const { Player: P, runFrame } = await setup();
    const store = new Store({ year: PRESENT_YEAR - 0.5 });
    const player = new P(store, () => 2, EVENTS);
    store.set({ playing: true }); // external play also starts the loop
    runFrame(0); // first frame only records the clock
    expect(store.get().year).toBe(PRESENT_YEAR - 0.5);
    runFrame(100);
    expect(store.get().year).toBeCloseTo(PRESENT_YEAR - 0.3, 9);
    for (let i = 0; i < 100 && runFrame(100); i++) { /* run until the loop stops scheduling */ }
    expect(store.get()).toMatchObject({ year: PRESENT_YEAR, playing: false });
    player.destroy();
  });

  it('caps a long frame at 0.1 s', async () => {
    const { Player: P, runFrame } = await setup();
    const store = new Store({ year: 0 });
    const player = new P(store, () => 1, EVENTS);
    player.play();
    runFrame(0);
    runFrame(5000);
    expect(store.get().year).toBeCloseTo(0.1, 9);
    player.destroy();
  });

  it('stops scheduling frames when paused or destroyed', async () => {
    const { Player: P, runFrame } = await setup();
    const store = new Store({ year: 0 });
    const player = new P(store, () => 1, EVENTS);
    player.play();
    runFrame(0);
    player.pause();
    const y = store.get().year;
    runFrame(100);
    expect(store.get().year).toBe(y);
    player.destroy();
    store.set({ playing: true });
    expect(runFrame(100)).toBe(false);
  });
});
