import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HistoryEvent } from '../types';
import {
  formatDuration, formatEventDate, formatYear, formatYearShort, niceTickStep, presentYear, yearToMonthFraction, yearsAgo,
} from './TimeModel';

// "ago" values depend on the clock; pin it to 1 Oct 2026 (≈ 2026.75) for deterministic output.
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 1)));
});
afterAll(() => vi.useRealTimers());

describe('presentYear / yearsAgo', () => {
  it('is the fractional calendar year', () => {
    expect(presentYear()).toBeCloseTo(2026 + 273 / 365, 6);
    expect(yearsAgo(2000)).toBeCloseTo(26.748, 3);
  });
});

describe('formatYear', () => {
  it.each([
    [-4.567e9, '4.57 billion years ago'],
    [-4.54e9, '4.54 billion years ago'],
    [-4e9, '4 billion years ago'],
    [-2.5e9, '2.5 billion years ago'],
    [-1e9, '1 billion years ago'],
    [-251.902e6, '252 million years ago'],
    [-66e6, '66 million years ago'],
    [-2.6e6, '2.6 million years ago'],
    [-1e6, '1 million years ago'],
    // ago = present − year, so year −300,000 is 302,026 years ago (3 significant figures).
    [-300_000, '302,000 years ago'],
    [-12_000, '14,000 years ago'],
    [-10_000, '12,000 years ago'],
  ])('deep time %d → %s', (y, label) => {
    expect(formatYear(y)).toBe(label);
  });

  it.each([
    [-9_999, '9,999 BCE'],
    [-3_500, '3,500 BCE'],
    [-3_500.3, '3,501 BCE'],
    [-500, '500 BCE'],
    [-1, '1 BCE'],
    [0, '1 BCE'],
    [0.5, '1 BCE'],
    [1, '1 CE'],
    [476, '476 CE'],
    [999.9, '999 CE'],
    [1000, '1000'],
    [1492, '1492'],
    [1492 - 1e-9, '1492'],
    [1914.58, '1914'],
    [2026, '2026'],
  ])('calendar %d → %s', (y, label) => {
    expect(formatYear(y)).toBe(label);
  });

  it('adds the month when asked', () => {
    expect(formatYear(1914.58, { month: true })).toBe('August 1914');
    expect(formatYear(1969 + 6 / 12, { month: true })).toBe('July 1969');
    expect(formatYear(-44 + 2 / 12, { month: true })).toBe('March 44 BCE');
    expect(formatYear(476.01, { month: true })).toBe('January 476 CE');
  });

  it('ignores the month in deep time', () => {
    expect(formatYear(-66e6, { month: true })).toBe('66 million years ago');
  });
});

describe('yearToMonthFraction', () => {
  it('splits fractional years into calendar months', () => {
    expect(yearToMonthFraction(1914.58)).toEqual({ year: 1914, month: 7 });
    expect(yearToMonthFraction(1914)).toEqual({ year: 1914, month: 0 });
    expect(yearToMonthFraction(1914.99)).toEqual({ year: 1914, month: 11 });
    expect(yearToMonthFraction(-43.83)).toEqual({ year: -44, month: 2 });
  });

  it('keeps the last days of December in December', () => {
    expect(yearToMonthFraction(1914.999)).toEqual({ year: 1914, month: 11 });
    expect(yearToMonthFraction(-44.001)).toEqual({ year: -45, month: 11 });
    expect(yearToMonthFraction(1492 - 1e-9)).toEqual({ year: 1492, month: 0 });
  });
});

describe('formatYearShort', () => {
  it.each([
    [-4.567e9, '4.567 Ga'],
    [-4.54e9, '4.54 Ga'],
    [-4.5e9, '4.5 Ga'],
    [-1e9, '1 Ga'],
    [-66e6, '66 Ma'],
    [-2.6e6, '2.6 Ma'],
    [-1e6, '1 Ma'],
    [-300_000, '300 ka'],
    [-12_000, '12 ka'],
    [-10_000, '10 ka'],
    [-9_500, '9500 BCE'],
    [-3_500, '3500 BCE'],
    [-500, '500 BCE'],
    [0, '1 BCE'],
    [476, '476 CE'],
    [1492, '1492'],
    [1914.58, 'Aug 1914'],
    [2026, '2026'],
  ])('%d → %s', (y, label) => {
    expect(formatYearShort(y)).toBe(label);
    expect(label.length).toBeLessThanOrEqual(8);
  });
});

describe('formatDuration', () => {
  it.each([
    [2.3e9, '2.3 billion years'],
    [66e6, '66 million years'],
    [999_999, '1 million years'],
    [12_000, '12,000 years'],
    [1_234, '1,230 years'],
    [150, '150 years'],
    [2.5, '2.5 years'],
    [1, '1 year'],
    [-150, '150 years'],
    [0.5, '6 months'],
    [1 / 12, '1 month'],
    [3 / 365.25, '3 days'],
    [0.0001, 'less than a day'],
  ])('%d → %s', (years, label) => {
    expect(formatDuration(years)).toBe(label);
  });
});

describe('formatEventDate', () => {
  const ev = (patch: Partial<HistoryEvent>): HistoryEvent => ({
    id: 'x', title: 'x', year: 0, lat: 0, lon: 0, category: 'culture', importance: 3,
    summary: '', description: '', consensus: 'established', ...patch,
  });

  it('prefers the author label', () => {
    expect(formatEventDate(ev({ year: -4.51e9, dateLabel: 'c. 4.51 billion years ago' }))).toBe('c. 4.51 billion years ago');
  });
  it('formats points, with the month for fractional years', () => {
    expect(formatEventDate(ev({ year: 1492 }))).toBe('1492');
    expect(formatEventDate(ev({ year: 1914.58 }))).toBe('August 1914');
  });
  it('formats spans, sharing a common suffix', () => {
    expect(formatEventDate(ev({ year: 1939, endYear: 1945 }))).toBe('1939 – 1945');
    expect(formatEventDate(ev({ year: -3100, endYear: -2686 }))).toBe('3,100 – 2,686 BCE');
    expect(formatEventDate(ev({ year: -500, endYear: 500 }))).toBe('500 BCE – 500 CE');
    expect(formatEventDate(ev({ year: -66e6, endYear: -2.6e6 }))).toBe('66 – 2.6 million years ago');
    expect(formatEventDate(ev({ year: -2.6e6, endYear: -12_000 }))).toBe('2.6 million years ago – 14,000 years ago');
  });
});

describe('niceTickStep', () => {
  it.each([
    [1000, 10, 100],
    [2000, 10, 200],
    [150, 10, 20],
    [3, 10, 0.5],
    [226.75, 8, 50],
    [4.567e9, 10, 5e8],
    [536e6, 10, 1e8],
    [-1000, 10, 100],
  ])('span %d / %d ticks → %d', (span, ticks, step) => {
    expect(niceTickStep(span, ticks)).toBeCloseTo(step, 12);
  });

  it('never yields more ticks than requested', () => {
    for (const span of [7, 13, 99, 1234, 98765, 4.2e9]) {
      expect(span / niceTickStep(span, 10)).toBeLessThanOrEqual(10 + 1e-9);
    }
  });

  it('is safe on degenerate input', () => {
    expect(niceTickStep(0, 10)).toBe(1);
    expect(niceTickStep(NaN, 10)).toBe(1);
  });
});
