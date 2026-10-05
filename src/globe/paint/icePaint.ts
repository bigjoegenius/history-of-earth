/**
 * Polar ice caps: translucent white-blue from `latitude` poleward with a soft 3° edge whose
 * position wanders a little with longitude so the cap does not look like a ruled circle.
 * latitude 0 covers the whole planet (Snowball Earth).
 */
import { clamp01, Perlin3, smoothstep } from './noise';

const EDGE_SOFTNESS = 3; // degrees
const MAX_ALPHA = 0.8;

export function paintIce(w: number, h: number, latitude: number): Uint8ClampedArray<ArrayBuffer> {
  const edge = new Perlin3(51), grain = new Perlin3(52);
  // Shrink the wobble near the equator so a snowball has no gaps along its seam.
  const wobble = 4 * clamp01(latitude / 12);
  const north = new Float64Array(w), south = new Float64Array(w);
  const cosLon = new Float64Array(w), sinLon = new Float64Array(w);
  for (let i = 0; i < w; i++) {
    const lon = ((i + 0.5) / w) * 2 * Math.PI - Math.PI;
    cosLon[i] = Math.cos(lon);
    sinLon[i] = Math.sin(lon);
    // Sampling noise on a circle keeps the edge seamless across ±180°.
    north[i] = latitude + wobble * edge.fbm(cosLon[i] * 1.8, sinLon[i] * 1.8, 0.5, 3);
    south[i] = latitude + wobble * edge.fbm(cosLon[i] * 1.8, sinLon[i] * 1.8, 7.5, 3);
  }
  const px = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) {
    const lat = 90 - ((j + 0.5) / h) * 180;
    const cl = Math.cos((lat * Math.PI) / 180), z = Math.sin((lat * Math.PI) / 180);
    const pole = Math.abs(lat) / 90;
    for (let i = 0; i < w; i++) {
      const a = Math.max(
        smoothstep(north[i] - EDGE_SOFTNESS, north[i], lat),
        smoothstep(-south[i] + EDGE_SOFTNESS, -south[i], lat),
      );
      if (a <= 0) continue;
      const t = 0.5 + 0.5 * grain.fbm(cl * cosLon[i] * 9, cl * sinLon[i] * 9, z * 9, 2);
      const k = (j * w + i) * 4;
      px[k] = 222 + 28 * pole + 8 * t;
      px[k + 1] = 236 + 16 * pole + 6 * t;
      px[k + 2] = 250;
      px[k + 3] = 255 * MAX_ALPHA * a * (0.9 + 0.1 * t);
    }
  }
  return px;
}
