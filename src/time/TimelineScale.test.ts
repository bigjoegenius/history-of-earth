import { describe, expect, it } from 'vitest';
import type { Chapter } from '../types';
import { PRESENT_YEAR, TIMELINE_START } from '../types';
import chaptersJson from '../data/chapters.json';
import { TimelineScale } from './TimelineScale';

const parts = (chaptersJson as Chapter[]).filter((c) => c.level === 1);
const scale = new TimelineScale(parts);

/** Round-trip tolerance relative to the size of the year (doubles carry ~16 significant digits). */
function expectSameYear(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * 1e-12 + 1e-9);
}

describe('TimelineScale with the real level-1 parts', () => {
  it('spans the whole timeline', () => {
    expect(scale.toPosition(TIMELINE_START)).toBe(0);
    expect(scale.toPosition(PRESENT_YEAR)).toBe(1);
    expect(scale.toYear(0)).toBe(TIMELINE_START);
    expectSameYear(scale.toYear(1), PRESENT_YEAR);
  });

  it('gives every part a width proportional to its weight, in order and contiguous', () => {
    const segs = scale.segments();
    expect(segs.map((s) => s.chapter.id)).toEqual(parts.map((c) => c.id));
    const total = parts.reduce((a, c) => a + (c.timelineWeight ?? 1), 0);
    segs.forEach((s, i) => {
      expect(s.p1 - s.p0).toBeCloseTo((s.chapter.timelineWeight ?? 1) / total, 12);
      if (i > 0) expect(s.p0).toBe(segs[i - 1].p1);
    });
    expect(segs[0].p0).toBe(0);
    expect(segs[segs.length - 1].p1).toBe(1);
  });

  it.each(parts.map((c) => [c.id, c] as const))('round-trips the boundaries and midpoint of %s', (_id, part) => {
    const seg = scale.segments().find((s) => s.chapter.id === part.id)!;
    expect(scale.toPosition(part.start)).toBe(seg.p0);
    expect(scale.toYear(seg.p0)).toBe(part.start);
    expectSameYear(scale.toYear(scale.toPosition(part.end)), part.end);

    const mid = (part.start + part.end) / 2;
    expect(scale.toPosition(mid)).toBeCloseTo((seg.p0 + seg.p1) / 2, 12);
    expectSameYear(scale.toYear(scale.toPosition(mid)), mid);
    expectSameYear(scale.toYear((seg.p0 + seg.p1) / 2), mid);
    expect(scale.toPosition(scale.toYear(0.25 * seg.p0 + 0.75 * seg.p1))).toBeCloseTo(0.25 * seg.p0 + 0.75 * seg.p1, 12);
  });

  it('assigns boundary years to the later part and finds parts by year', () => {
    for (let i = 1; i < parts.length; i++) expect(scale.partAt(parts[i].start).id).toBe(parts[i].id);
    expect(scale.partAt(-66_000_001).id).toBe('mesozoic');
    expect(scale.partAt(1492).id).toBe('postclassical');
    expect(scale.partAt(PRESENT_YEAR).id).toBe('modern');
  });

  it('clamps outside the timeline', () => {
    expect(scale.toPosition(-5e9)).toBe(0);
    expect(scale.toPosition(3000)).toBe(1);
    expect(scale.toYear(-0.5)).toBe(TIMELINE_START);
    expectSameYear(scale.toYear(2), PRESENT_YEAR);
    expect(scale.partAt(-5e9).id).toBe('hadean');
    expect(scale.partAt(3000).id).toBe('modern');
  });

  it('is monotonic', () => {
    let prev = -1;
    for (let p = 0; p <= 1.0000001; p += 0.001) {
      const y = scale.toYear(p);
      expect(y).toBeGreaterThan(prev === -1 ? -Infinity : prev);
      prev = y;
    }
  });

  it('gives a chapter its own range for the detail ruler', () => {
    expect(scale.detailRangeFor(parts[5])).toEqual([parts[5].start, parts[5].end]);
  });
});

describe('TimelineScale with synthetic parts', () => {
  const part = (id: string, start: number, end: number, timelineWeight?: number): Chapter =>
    ({ id, title: id, level: 1, start, end, description: '', timelineWeight });

  it('defaults missing weights to 1 and accepts unsorted input', () => {
    const s = new TimelineScale([part('b', 100, 200), part('a', 0, 100, 3)]);
    expect(s.segments().map((x) => [x.chapter.id, x.p0, x.p1])).toEqual([['a', 0, 0.75], ['b', 0.75, 1]]);
    expect(s.toYear(0.875)).toBe(150);
    expect(s.toPosition(50)).toBe(0.375);
  });
});
