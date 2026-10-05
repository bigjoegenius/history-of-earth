import { describe, expect, it } from 'vitest';
import { formatUrlHash, parseUrlHash, roundYearForUrl } from './urlHash';
import { PRESENT_YEAR, TIMELINE_START } from '../types';

describe('roundYearForUrl', () => {
  it('keeps whole years exactly', () => {
    expect(roundYearForUrl(-251_902_000, 3_000_000)).toBe('-251902000');
    expect(roundYearForUrl(-4_567_000_000, 15_000_000)).toBe('-4567000000');
    expect(roundYearForUrl(1492, 10)).toBe('1492');
  });

  it('rounds playback years to ~1/1000 s of 1× playback', () => {
    expect(roundYearForUrl(-66_012_345.6, 1_000_000)).toBe('-66012000');
    expect(roundYearForUrl(-123_456.7, 5_000)).toBe('-123457');
    expect(roundYearForUrl(-1234.5678, 33)).toBe('-1234.57');
    expect(roundYearForUrl(1917.851, 1.5)).toBe('1917.851');
    expect(roundYearForUrl(1914.58321, 2)).toBe('1914.583');
  });

  it('drops trailing zeros and negative zero', () => {
    expect(roundYearForUrl(1914.5, 2)).toBe('1914.5');
    expect(roundYearForUrl(-0.0001, 2)).toBe('0');
  });
});

describe('parseUrlHash', () => {
  it('reads year and event id', () => {
    expect(parseUrlHash('#y=-66000000&e=mesozoic-chicxulub-impact')).toEqual({
      year: -66_000_000,
      eventId: 'mesozoic-chicxulub-impact',
    });
    expect(parseUrlHash('y=1914.58')).toEqual({ year: 1914.58 });
  });

  it('clamps to the timeline and ignores junk', () => {
    expect(parseUrlHash('#y=-9e12').year).toBe(TIMELINE_START);
    expect(parseUrlHash('#y=3000').year).toBe(PRESENT_YEAR);
    expect(parseUrlHash('#y=')).toEqual({});
    expect(parseUrlHash('#y=abc')).toEqual({});
    expect(parseUrlHash('')).toEqual({});
  });

  it('round-trips formatUrlHash', () => {
    const hash = formatUrlHash(-251_902_000, 'mesozoic-great-dying', 3_000_000);
    expect(hash).toBe('#y=-251902000&e=mesozoic-great-dying');
    expect(parseUrlHash(hash)).toEqual({ year: -251_902_000, eventId: 'mesozoic-great-dying' });
    expect(formatUrlHash(-251_912_345.5, null, 3_000_000)).toBe('#y=-251912000');
  });
});
