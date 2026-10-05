import { describe, expect, it } from 'vitest';
import { fillTemplate, nearestIndex, snapshotAtOrBefore, yearToAgeMa } from './dataIndex';

describe('snapshot selection', () => {
  const ages = [0, 5, 10, 540, 560];

  it('picks the nearest paleo age', () => {
    expect(nearestIndex(ages, 0.001)).toBe(0);
    expect(nearestIndex(ages, 7.4)).toBe(1);
    expect(nearestIndex(ages, 7.6)).toBe(2);
    expect(nearestIndex(ages, 549)).toBe(3);
    expect(nearestIndex(ages, 5000)).toBe(4);
  });

  it('converts years to millions of years ago', () => {
    expect(yearToAgeMa(-66_000_000)).toBeCloseTo(66, 2);
  });

  it('picks the latest border snapshot at or before the year', () => {
    const years = [-123000, -3000, 1492, 1914, 2026];
    expect(snapshotAtOrBefore(years, -200000)).toBeNull();
    expect(snapshotAtOrBefore(years, -3000)).toBe(-3000);
    expect(snapshotAtOrBefore(years, 1500)).toBe(1492);
    expect(snapshotAtOrBefore(years, 2026.75)).toBe(2026);
  });

  it('fills path templates', () => {
    expect(fillTemplate('borders/world_{year}.json', 'year', -500)).toBe('borders/world_-500.json');
  });
});
