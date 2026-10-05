/** Where an event belongs on the globe for the surface currently drawn (SPEC "Events — authoring rules"). */
import type { GlobeStyle, HistoryEvent } from '../types';

export interface EventPosition {
  lat: number;
  lon: number;
  /** True when this is the site's reconstructed palaeo-position rather than where it is today. */
  reconstructed: boolean;
}

/**
 * True when the event's marker sits at its reconstructed palaeo-position: the globe shows the plate
 * model's coastlines ('paleo') and the event has generated paleoLat/paleoLon. Satellite imagery is
 * present-day geography and the schematic surfaces are illustrative, so both keep lat/lon.
 */
export function usesPaleoPosition(ev: HistoryEvent, mode: GlobeStyle['mode']): boolean {
  return mode === 'paleo' && Number.isFinite(ev.paleoLat) && Number.isFinite(ev.paleoLon);
}

export function eventPosition(ev: HistoryEvent, mode: GlobeStyle['mode']): EventPosition {
  return usesPaleoPosition(ev, mode)
    ? { lat: ev.paleoLat as number, lon: ev.paleoLon as number, reconstructed: true }
    : { lat: ev.lat, lon: ev.lon, reconstructed: false };
}
