/**
 * Minimal GeoJSON handling for the equirectangular painters: polygon/line extraction,
 * antimeridian-safe ring unwrapping and label placement. Pure functions (unit-tested).
 */

export type LonLat = [number, number];
export type Ring = LonLat[];

export interface Geometry {
  type: string;
  coordinates?: unknown;
  geometries?: Geometry[];
}
export interface Feature<P = Record<string, unknown>> {
  type: 'Feature';
  geometry: Geometry | null;
  properties: P | null;
}
export interface FeatureCollection<P = Record<string, unknown>> {
  type: 'FeatureCollection';
  features: Feature<P>[];
}

export function isFeatureCollection(v: unknown): v is FeatureCollection {
  return !!v && typeof v === 'object' && Array.isArray((v as FeatureCollection).features);
}

/** Polygons of a geometry, each as [outer, ...holes]. Non-polygon geometries yield nothing. */
export function polygonsOf(g: Geometry | null): Ring[][] {
  if (!g) return [];
  switch (g.type) {
    case 'Polygon': return [g.coordinates as Ring[]];
    case 'MultiPolygon': return g.coordinates as Ring[][];
    case 'GeometryCollection': return (g.geometries ?? []).flatMap(polygonsOf);
    default: return [];
  }
}

/** Every line of a geometry (polygon rings included), for stroking. */
export function linesOf(g: Geometry | null): Ring[] {
  if (!g) return [];
  switch (g.type) {
    case 'LineString': return [g.coordinates as Ring];
    case 'MultiLineString': return g.coordinates as Ring[];
    case 'Polygon': return g.coordinates as Ring[];
    case 'MultiPolygon': return (g.coordinates as Ring[][]).flat();
    case 'GeometryCollection': return (g.geometries ?? []).flatMap(linesOf);
    default: return [];
  }
}

/**
 * Make longitudes continuous (no ±360° jumps) so a ring crossing the antimeridian stays one shape.
 * A ring that circles a pole ends ~360° away from where it started; for closed rings we add the
 * pole's corners so the fill covers the polar cap instead of slicing across the map.
 */
export function unwrapRing(ring: Ring, closed = true): Ring {
  if (ring.length === 0) return [];
  const out: Ring = [[ring[0][0], ring[0][1]]];
  let offset = 0;
  for (let i = 1; i < ring.length; i++) {
    const prev = out[i - 1][0];
    let lon = ring[i][0] + offset;
    while (lon - prev > 180) { lon -= 360; offset -= 360; }
    while (lon - prev < -180) { lon += 360; offset += 360; }
    out.push([lon, ring[i][1]]);
  }
  if (closed && Math.abs(offset) > 180) {
    let latSum = 0;
    for (const p of out) latSum += p[1];
    const pole = latSum < 0 ? -90 : 90;
    out.push([out[out.length - 1][0], pole], [out[0][0], pole]);
  }
  return out;
}

/** Longitude offsets (multiples of 360) at which a [minLon, maxLon] span overlaps the map. */
export function wrapOffsets(minLon: number, maxLon: number): number[] {
  const offsets: number[] = [];
  for (let k = -2; k <= 2; k++) {
    const o = k * 360;
    if (maxLon + o >= -180 && minLon + o <= 180) offsets.push(o);
  }
  return offsets;
}

/** Signed planar area in square degrees (shoelace). */
export function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
}

/** Area centroid of a (planar) ring; falls back to the vertex mean for degenerate rings. */
export function ringCentroid(ring: Ring): LonLat {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-12) {
    let sx = 0, sy = 0;
    for (const p of ring) { sx += p[0]; sy += p[1]; }
    return [sx / ring.length, sy / ring.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * A good label anchor inside a ring: its centroid if that lies inside (convex-ish shapes),
 * otherwise the middle of the widest interior span along the centroid's latitude
 * (handles crescents and L-shapes such as Chile or the Ottoman Empire).
 */
export function labelPoint(ring: Ring): LonLat {
  const c = ringCentroid(ring);
  if (pointInRing(c[0], c[1], ring)) return c;
  const xs: number[] = [];
  const lat = c[1];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat)) xs.push(xi + ((lat - yi) * (xj - xi)) / (yj - yi));
  }
  xs.sort((p, q) => p - q);
  let best: LonLat = c, bestWidth = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const width = xs[i + 1] - xs[i];
    if (width > bestWidth) { bestWidth = width; best = [(xs[i] + xs[i + 1]) / 2, lat]; }
  }
  return best;
}

/** Wrap a longitude into [-180, 180). */
export function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}
