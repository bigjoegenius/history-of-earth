/**
 * Historical borders raster (historical-basemaps / Natural Earth): translucent fill per polity
 * with a colour hashed from its name and a thin darker outline. Also picks label anchors for
 * the largest polities.
 */
import { labelPoint, normalizeLon, polygonsOf, ringArea, ringCentroid, type FeatureCollection, type Ring } from './geo';
import { tracePolygon, type Ctx2D } from './canvasPath';
import { hashString } from './colors';

export interface BorderLabel {
  name: string;
  lat: number;
  lon: number;
  /** Latitude-corrected area of the polity's largest part, in square degrees. */
  area: number;
}

/** Placeholder names in the source data that should never be labelled. */
const UNLABELLED = /^(unclaimed|unknown|uninhabited|none|n\/a|\?+)$/i;

export function paintBorders(ctx: Ctx2D, w: number, h: number, fc: FeatureCollection, maxLabels: number): BorderLabel[] {
  ctx.clearRect(0, 0, w, h);
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, w / 4096);
  // Largest ring per name, by area corrected for latitude (degrees² shrink towards the poles).
  const best = new Map<string, { area: number; ring: Ring }>();

  for (const f of fc.features) {
    const name = String(f.properties?.name ?? '').trim();
    if (!name) continue;
    const hue = hashString(name) % 360;
    ctx.fillStyle = `hsla(${hue}, 62%, 56%, 0.35)`;
    ctx.strokeStyle = `hsla(${hue}, 55%, 30%, 0.85)`;
    for (const poly of polygonsOf(f.geometry)) {
      if (!poly.length || poly[0].length < 3) continue;
      ctx.beginPath();
      tracePolygon(ctx, poly, w, h);
      ctx.fill('evenodd');
      ctx.stroke();
      if (UNLABELLED.test(name)) continue;
      const outer = poly[0];
      const area = Math.abs(ringArea(outer)) * Math.cos((ringCentroid(outer)[1] * Math.PI) / 180);
      const prev = best.get(name);
      if (!prev || area > prev.area) best.set(name, { area, ring: outer });
    }
  }

  return [...best.entries()]
    .sort((a, b) => b[1].area - a[1].area)
    .slice(0, maxLabels)
    .map(([name, { area, ring }]) => {
      const [lon, lat] = labelPoint(ring);
      return { name, lon: normalizeLon(lon), lat, area };
    });
}
