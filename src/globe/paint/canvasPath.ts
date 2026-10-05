/** Tracing GeoJSON rings onto an equirectangular 2D canvas (x = lon, y = lat, north up). */
import { unwrapRing, wrapOffsets, type Ring } from './geo';

export type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/**
 * Adds one ring to the current path. The ring is unwrapped across the antimeridian and drawn
 * once per 360° offset that overlaps the map, so shapes straddling ±180° appear on both edges.
 */
export function traceRing(ctx: Ctx2D, ring: Ring, w: number, h: number, closed: boolean): void {
  if (ring.length < 2) return;
  const pts = unwrapRing(ring, closed);
  let minLon = Infinity, maxLon = -Infinity;
  for (const p of pts) {
    if (p[0] < minLon) minLon = p[0];
    if (p[0] > maxLon) maxLon = p[0];
  }
  const sx = w / 360, sy = h / 180;
  for (const off of wrapOffsets(minLon, maxLon)) {
    ctx.moveTo((pts[0][0] + off + 180) * sx, (90 - pts[0][1]) * sy);
    for (let i = 1; i < pts.length; i++) ctx.lineTo((pts[i][0] + off + 180) * sx, (90 - pts[i][1]) * sy);
    if (closed) ctx.closePath();
  }
}

/** Adds a polygon (outer ring + holes) to the current path; fill it with 'evenodd'. */
export function tracePolygon(ctx: Ctx2D, rings: Ring[], w: number, h: number): void {
  for (const r of rings) traceRing(ctx, r, w, h, true);
}
