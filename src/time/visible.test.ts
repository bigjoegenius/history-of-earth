import { describe, expect, it } from 'vitest';
import type { HistoryEvent, Settings } from '../types';
import { DEFAULT_SETTINGS } from '../state/Store';
import { computeVisibleEvents, eventFilter, firstIndexAfter, firstIndexAtOrAfter } from './visible';

function ev(id: string, year: number, patch: Partial<HistoryEvent> = {}): HistoryEvent {
  return {
    id, title: id, year, lat: 0, lon: 0, category: 'culture', importance: 3,
    summary: '', description: '', consensus: 'established', ...patch,
  };
}

/** Sorted like EVENTS: year ascending, importance descending. */
function sorted(list: HistoryEvent[]): HistoryEvent[] {
  return [...list].sort((a, b) => a.year - b.year || b.importance - a.importance);
}

const settings = (patch: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...patch });
const ids = (list: HistoryEvent[]) => list.map((e) => e.id);

const EVENTS = sorted([
  ev('p1000', 1000),
  ev('p1400', 1400, { importance: 2 }),
  ev('p1450', 1450, { importance: 5 }),
  ev('p1490', 1490),
  ev('p1500a', 1500, { importance: 4 }),
  ev('p1500b', 1500, { importance: 1 }),
  ev('fringe1501', 1501, { category: 'fringe', consensus: 'fringe', mainstreamView: 'No evidence.' }),
  ev('p1600', 1600),
  ev('p1700', 1700, { importance: 2 }),
  ev('p1800', 1800),
  ev('span-long', 500, { endYear: 2000, importance: 2 }),
  ev('span-mid', 1300, { endYear: 1600, importance: 4 }),
  ev('span-mid2', 1200, { endYear: 1600, importance: 4 }),
  ev('span-ended', 1100, { endYear: 1400 }),
  ev('span-later', 1550, { endYear: 1650 }),
  ev('span-edge', 1450, { endYear: 1500, importance: 1 }),
]);

describe('eventFilter', () => {
  it('applies the importance threshold', () => {
    const f = eventFilter(settings({ minImportance: 3 }));
    expect(f(ev('a', 0, { importance: 2 }))).toBe(false);
    expect(f(ev('b', 0, { importance: 3 }))).toBe(true);
  });
  it('hides fringe theories only when they are switched off', () => {
    const fringe = ev('f', 0, { category: 'fringe', consensus: 'fringe' });
    expect(eventFilter(settings({ showFringe: true }))(fringe)).toBe(true);
    expect(eventFilter(settings({ showFringe: false }))(fringe)).toBe(false);
    expect(eventFilter(settings({ showFringe: false }))(ev('d', 0, { consensus: 'debated' }))).toBe(true);
  });
});

describe('binary search helpers', () => {
  it('find the first index at/after and strictly after a year', () => {
    const list = sorted([ev('a', 1), ev('b', 2), ev('c', 2), ev('d', 3)]);
    expect(firstIndexAtOrAfter(list, 2)).toBe(1);
    expect(firstIndexAfter(list, 2)).toBe(3);
    expect(firstIndexAtOrAfter(list, 0)).toBe(0);
    expect(firstIndexAfter(list, 3)).toBe(4);
  });
});

describe('computeVisibleEvents', () => {
  it('uses the larger of 20 s of playback and 0.5% of the chapter as the window', () => {
    expect(computeVisibleEvents(1500, 2, settings(), 1000, EVENTS).window).toBe(40);
    expect(computeVisibleEvents(1500, -2, settings(), 1000, EVENTS).window).toBe(40);
    expect(computeVisibleEvents(1500, 0, settings(), 1000, EVENTS).window).toBe(5);
  });

  it('lists recent point events inside the window, newest (then most important) first', () => {
    const v = computeVisibleEvents(1500, 2.5, settings(), 1000, EVENTS); // W = 50 → [1450, 1500]
    expect(ids(v.recent)).toEqual(['p1500a', 'p1500b', 'p1490', 'p1450']);
  });

  it('excludes running spans and anything after the current year from recent', () => {
    const v = computeVisibleEvents(1499, 10, settings(), 0, EVENTS); // W = 200 → [1299, 1499]
    expect(ids(v.recent)).toEqual(['p1490', 'p1450', 'p1400']);
  });

  it('lists spans that started inside the window and have already ended as recent', () => {
    // A span shorter than one frame of playback must still surface once the playhead has passed it.
    const brief = sorted([ev('p99', 99), ev('brief', 100, { endYear: 100.01, importance: 5 }), ev('long', 50, { endYear: 300 })]);
    const v = computeVisibleEvents(100.5, 1, settings(), 0, brief); // W = 20 → [80.5, 100.5]
    expect(ids(v.recent)).toEqual(['brief', 'p99']);
    expect(ids(v.ongoing)).toEqual(['long']);
    // The last day of a span is still "happening now", never in both lists.
    const atEnd = computeVisibleEvents(100.01, 1, settings(), 0, brief);
    expect(ids(atEnd.ongoing)).toContain('brief');
    expect(ids(atEnd.recent)).not.toContain('brief');
    // span-edge (1450–1500) is still running at 1500, but recent by 1501 (W = 60 → [1441, 1501]).
    expect(ids(computeVisibleEvents(1500, 3, settings(), 0, EVENTS).recent)).not.toContain('span-edge');
    expect(ids(computeVisibleEvents(1501, 3, settings(), 0, EVENTS).recent)).toContain('span-edge');
  });

  it('caps recent at 12, keeping the newest', () => {
    const many = sorted(Array.from({ length: 30 }, (_, i) => ev(`e${i}`, i)));
    const v = computeVisibleEvents(29, 100, settings(), 0, many);
    expect(ids(v.recent)).toEqual(Array.from({ length: 12 }, (_, i) => `e${29 - i}`));
  });

  it('keeps the most important events when the cap cuts through one year', () => {
    const tie = sorted([
      ...Array.from({ length: 11 }, (_, i) => ev(`n${i}`, 100 - i)),
      ev('low', 50, { importance: 1 }), ev('high', 50, { importance: 5 }),
    ]);
    const v = computeVisibleEvents(100, 100, settings(), 0, tie);
    expect(v.recent).toHaveLength(12);
    expect(ids(v.recent)).toContain('high');
    expect(ids(v.recent)).not.toContain('low');
  });

  it('lists ongoing spans (inclusive ends) by importance, then start year', () => {
    expect(ids(computeVisibleEvents(1500, 1, settings(), 0, EVENTS).ongoing))
      .toEqual(['span-mid2', 'span-mid', 'span-long', 'span-edge']);
    expect(ids(computeVisibleEvents(1600, 1, settings(), 0, EVENTS).ongoing))
      .toEqual(['span-mid2', 'span-mid', 'span-later', 'span-long']);
    expect(ids(computeVisibleEvents(400, 1, settings(), 0, EVENTS).ongoing)).toEqual([]);
  });

  it('matches a brute-force scan for ongoing spans at many years', () => {
    // Equal importance, so the result must be the (up to 8) earliest-starting spans that contain y.
    const spans = sorted(Array.from({ length: 200 }, (_, i) => {
      const start = (i * 7919) % 1000;
      return ev(`s${i}`, start, { endYear: start + ((i * 104729) % 300) });
    }));
    for (let y = -10; y <= 1310; y += 3.5) {
      const containing = spans.filter((e) => e.year <= y && y <= e.endYear!);
      const got = computeVisibleEvents(y, 0, settings(), 0, spans).ongoing;
      expect(got).toHaveLength(Math.min(8, containing.length));
      for (const e of got) expect(containing).toContain(e);
      const cutoff = Math.max(-Infinity, ...got.map((e) => e.year));
      for (const e of containing) if (!got.includes(e)) expect(e.year).toBeGreaterThanOrEqual(cutoff);
    }
  });

  it('caps ongoing at 8', () => {
    const spans = sorted(Array.from({ length: 20 }, (_, i) => ev(`s${i}`, i, { endYear: 100 })));
    expect(computeVisibleEvents(50, 1, settings(), 0, spans).ongoing).toHaveLength(8);
  });

  it('lists the next three events (points or spans) strictly after the current year', () => {
    expect(ids(computeVisibleEvents(1500, 1, settings(), 0, EVENTS).upcoming)).toEqual(['fringe1501', 'span-later', 'p1600']);
    expect(ids(computeVisibleEvents(1750, 1, settings(), 0, EVENTS).upcoming)).toEqual(['p1800']);
    expect(computeVisibleEvents(1800, 1, settings(), 0, EVENTS).upcoming).toEqual([]);
  });

  it('applies the importance filter everywhere', () => {
    const v = computeVisibleEvents(1500, 2.5, settings({ minImportance: 4 }), 0, EVENTS);
    expect(ids(v.recent)).toEqual(['p1500a', 'p1450']);
    expect(ids(v.ongoing)).toEqual(['span-mid2', 'span-mid']);
    expect(ids(v.upcoming)).toEqual([]);
  });

  it('hides fringe theories only when showFringe is off', () => {
    const on = computeVisibleEvents(1501, 1, settings({ showFringe: true }), 0, EVENTS);
    expect(ids(on.recent)).toContain('fringe1501');
    const off = computeVisibleEvents(1501, 1, settings({ showFringe: false }), 0, EVENTS);
    expect(ids(off.recent)).not.toContain('fringe1501');
    expect(ids(off.recent)).toContain('p1500a');
    expect(ids(computeVisibleEvents(1500, 1, settings({ showFringe: false }), 0, EVENTS).upcoming))
      .toEqual(['span-later', 'p1600', 'p1700']);
  });

  it('handles an empty event list', () => {
    expect(computeVisibleEvents(0, 1, settings(), 10, [])).toEqual({ recent: [], ongoing: [], upcoming: [], window: 20 });
  });
});
