import { describe, expect, it } from 'vitest';
import type { HistoryEvent } from '../types';
import { eventPosition, usesPaleoPosition } from './eventPosition';

const ev = (extra: Partial<HistoryEvent> = {}): HistoryEvent => ({
  id: 'mesozoic-test', title: 'Test', year: -66_000_000, lat: 21.4, lon: -89.52, category: 'cosmic',
  importance: 5, summary: 's', description: 'd', consensus: 'established', ...extra,
});

describe('eventPosition', () => {
  const reconstructed = ev({ paleoLat: 25.05, paleoLon: -62.12 });

  it('uses the palaeo-position on reconstructed coastlines', () => {
    expect(eventPosition(reconstructed, 'paleo')).toEqual({ lat: 25.05, lon: -62.12, reconstructed: true });
    expect(usesPaleoPosition(reconstructed, 'paleo')).toBe(true);
  });

  it('keeps present-day coordinates on satellite and schematic surfaces', () => {
    for (const mode of ['satellite', 'schematic'] as const) {
      expect(eventPosition(reconstructed, mode)).toEqual({ lat: 21.4, lon: -89.52, reconstructed: false });
      expect(usesPaleoPosition(reconstructed, mode)).toBe(false);
    }
  });

  it('falls back to present-day coordinates when there is no palaeo-position', () => {
    expect(eventPosition(ev(), 'paleo')).toEqual({ lat: 21.4, lon: -89.52, reconstructed: false });
  });
});
