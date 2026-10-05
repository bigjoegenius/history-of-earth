import { describe, expect, it } from 'vitest';
import { labelPoint, normalizeLon, pointInRing, ringArea, ringCentroid, unwrapRing, wrapOffsets, type Ring } from './geo';

const square: Ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];

describe('unwrapRing', () => {
  it('keeps rings that do not cross the antimeridian unchanged', () => {
    expect(unwrapRing(square)).toEqual(square);
  });

  it('makes a ring crossing ±180° continuous', () => {
    const ring: Ring = [[170, 0], [-170, 0], [-170, 10], [170, 10], [170, 0]];
    expect(unwrapRing(ring).map((p) => p[0])).toEqual([170, 190, 190, 170, 170]);
  });

  it('closes a ring that circles the south pole over the pole', () => {
    const ring: Ring = [[-180, -70], [-90, -70], [0, -70], [90, -70], [180, -70]];
    const out = unwrapRing([...ring, [-90, -70]]); // keep going past the start: drift of +360
    expect(out.slice(-2).map((p) => p[1])).toEqual([-90, -90]);
  });

  it('does not add pole corners to open lines', () => {
    const line: Ring = [[170, 0], [-170, 0]];
    expect(unwrapRing(line, false)).toEqual([[170, 0], [190, 0]]);
  });
});

describe('wrapOffsets', () => {
  it('returns only the copies that overlap the map', () => {
    expect(wrapOffsets(-10, 10)).toEqual([0]);
    expect(wrapOffsets(170, 190)).toEqual([-360, 0]);
    expect(wrapOffsets(-190, -170)).toEqual([0, 360]);
  });
});

describe('ring metrics', () => {
  it('computes area and centroid', () => {
    expect(Math.abs(ringArea(square))).toBe(100);
    expect(ringCentroid(square)).toEqual([5, 5]);
  });

  it('tests point containment', () => {
    expect(pointInRing(5, 5, square)).toBe(true);
    expect(pointInRing(15, 5, square)).toBe(false);
  });

  it('places labels inside concave shapes', () => {
    // A "C" shape whose centroid falls in the empty middle.
    const c: Ring = [[0, 0], [10, 0], [10, 2], [2, 2], [2, 8], [10, 8], [10, 10], [0, 10], [0, 0]];
    const [lon, lat] = labelPoint(c);
    expect(pointInRing(lon, lat, c)).toBe(true);
  });

  it('normalises longitudes', () => {
    expect(normalizeLon(190)).toBe(-170);
    expect(normalizeLon(-190)).toBe(170);
    expect(normalizeLon(45)).toBe(45);
  });
});
