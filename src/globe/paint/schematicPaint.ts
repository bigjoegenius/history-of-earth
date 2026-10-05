/**
 * Procedural "illustrative" surfaces for eras with no reliable reconstruction (Hadean → mid-Proterozoic).
 * Each kind is a per-pixel shader evaluated at points on the unit sphere and written into an
 * equirectangular RGBA buffer. Fully deterministic (seeded noise), no labels.
 */
import type { SchematicKind } from '../../types';
import { clamp01, mulberry32, Perlin3, randomUnitVector, smoothstep } from './noise';
import { mixInto, type RGB } from './colors';

/** Writes the colour for unit-sphere point (x, y, z) into `out` (0–255 per channel). */
type Shader = (x: number, y: number, z: number, out: RGB) => void;

/**
 * Returns RGBA pixels for rows [row0, row1) of a w × h equirectangular image (row 0 = north).
 * Row bands let several workers share one texture.
 */
export function paintSchematic(
  kind: SchematicKind, w: number, h: number, row0 = 0, row1 = h,
): Uint8ClampedArray<ArrayBuffer> {
  const shader = SHADERS[kind]();
  const px = new Uint8ClampedArray(w * (row1 - row0) * 4);
  const cosLon = new Float64Array(w);
  const sinLon = new Float64Array(w);
  for (let i = 0; i < w; i++) {
    const lon = ((i + 0.5) / w) * 2 * Math.PI - Math.PI;
    cosLon[i] = Math.cos(lon);
    sinLon[i] = Math.sin(lon);
  }
  const c: RGB = [0, 0, 0];
  for (let j = row0; j < row1; j++) {
    const lat = (0.5 - (j + 0.5) / h) * Math.PI;
    const cl = Math.cos(lat), z = Math.sin(lat);
    let k = (j - row0) * w * 4;
    for (let i = 0; i < w; i++, k += 4) {
      shader(cl * cosLon[i], cl * sinLon[i], z, c);
      px[k] = c[0];
      px[k + 1] = c[1];
      px[k + 2] = c[2];
      px[k + 3] = 255;
    }
  }
  return px;
}

/** Piecewise-linear colour ramp; stops are [position, colour] sorted by position. */
function ramp(stops: [number, RGB][], t: number, out: RGB): RGB {
  let i = 1;
  while (i < stops.length - 1 && t > stops[i][0]) i++;
  const [p0, c0] = stops[i - 1];
  const [p1, c1] = stops[i];
  const u = clamp01((t - p0) / (p1 - p0));
  out[0] = c0[0] + (c1[0] - c0[0]) * u;
  out[1] = c0[1] + (c1[1] - c0[1]) * u;
  out[2] = c0[2] + (c1[2] - c0[2]) * u;
  return out;
}

type Vec3 = [number, number, number];

const angle = (x: number, y: number, z: number, c: Vec3): number =>
  Math.acos(Math.max(-1, Math.min(1, x * c[0] + y * c[1] + z * c[2])));

const GLOW: [number, RGB][] = [
  [0, [70, 10, 0]], [0.35, [205, 45, 0]], [0.6, [255, 115, 10]], [0.85, [255, 205, 70]], [1, [255, 246, 205]],
];

/** Molten Hadean surface: black crust broken by glowing cracks, lava lakes and fresh impact scars. */
function magma(): Shader {
  const warp = new Perlin3(11), crack = new Perlin3(12), base = new Perlin3(13);
  const rand = mulberry32(14);
  const impacts = Array.from({ length: 7 }, () => ({
    c: randomUnitVector(rand), r: 0.05 + rand() * 0.11, s: 0.55 + rand() * 0.45,
  }));
  const glow: RGB = [0, 0, 0];
  return (x, y, z, out) => {
    // Domain warp makes the crack network meander like convecting crust instead of a regular grid.
    const qx = x + 0.55 * warp.fbm(x * 1.7 + 3, y * 1.7, z * 1.7, 2);
    const qy = y + 0.55 * warp.fbm(x * 1.7, y * 1.7 + 7, z * 1.7, 2);
    const qz = z + 0.55 * warp.fbm(x * 1.7, y * 1.7, z * 1.7 + 11, 2);
    let heat = smoothstep(0.84, 0.975, crack.ridged(qx * 2.6, qy * 2.6, qz * 2.6, 3))
      + 0.45 * smoothstep(0.88, 0.985, crack.ridged(qx * 8 + 5, qy * 8, qz * 8, 2));
    // Lava lakes, with a crusted, uneven surface rather than a flat fill.
    const lake = smoothstep(0.36, 0.58, base.fbm(x * 1.1 + 20, y * 1.1, z * 1.1, 3));
    if (lake > 0) heat = Math.max(heat, lake * (0.4 + 0.35 * (0.5 + 0.5 * base.fbm(x * 14, y * 14, z * 14, 3))));
    for (const im of impacts) {
      const d = angle(x, y, z, im.c);
      if (d > im.r * 2.2) continue;
      const core = 0.8 * Math.exp(-((d / im.r) ** 2) * 3);
      const rim = Math.exp(-(((d - im.r) / (0.2 * im.r)) ** 2)) * 0.7;
      heat = Math.max(heat, (core + rim) * im.s);
    }
    heat = clamp01(heat);
    const v = 0.5 + 0.5 * base.fbm(x * 6, y * 6, z * 6, 3);
    out[0] = 12 + 34 * v; out[1] = 7 + 21 * v; out[2] = 5 + 15 * v;
    mixInto(out, ramp(GLOW, heat, glow), smoothstep(0.08, 0.6, heat));
  };
}

/** Cooling crust: dark basalt, fading red fissures, the first dark-blue pools of water. */
function cooling(): Shader {
  const n = new Perlin3(21), fis = new Perlin3(22), wat = new Perlin3(23);
  return (x, y, z, out) => {
    const v = 0.5 + 0.5 * n.fbm(x * 5, y * 5, z * 5, 4);
    out[0] = 20 + 34 * v; out[1] = 19 + 30 * v; out[2] = 21 + 26 * v;
    const qx = x + 0.4 * n.fbm(x * 2 + 9, y * 2, z * 2, 2);
    const r = fis.ridged(qx * 3.2, y * 3.2, z * 3.2, 3);
    const fadeOut = 0.3 + 0.7 * smoothstep(-0.25, 0.35, fis.fbm(x * 1.3 + 40, y * 1.3, z * 1.3, 2));
    mixInto(out, [150, 28, 8], smoothstep(0.88, 0.975, r) * 0.85 * fadeOut);
    mixInto(out, [235, 95, 25], smoothstep(0.972, 0.995, r) * 0.55 * fadeOut);
    const w = wat.fbm(x * 1.8 + 100, y * 1.8, z * 1.8, 4);
    const water = smoothstep(0.17, 0.23, w);
    if (water > 0) {
      const d = smoothstep(0.23, 0.45, w);
      mixInto(out, [10 + 6 * d, 30 + 22 * d, 52 + 34 * d], water);
    }
  };
}

/** Archean water world: deep blue-black ocean, small volcanic island arcs, a faint orange haze. */
function waterworld(): Shader {
  const n = new Perlin3(31), arcs = new Perlin3(32), isl = new Perlin3(33), haze = new Perlin3(34);
  const deep: RGB = [3, 10, 24], shallow: RGB = [10, 34, 66];
  return (x, y, z, out) => {
    const d = 0.5 + 0.5 * n.fbm(x * 2.2, y * 2.2, z * 2.2, 4);
    out[0] = deep[0] + (shallow[0] - deep[0]) * d;
    out[1] = deep[1] + (shallow[1] - deep[1]) * d;
    out[2] = deep[2] + (shallow[2] - deep[2]) * d;
    const qx = x + 0.35 * n.fbm(x * 1.5 + 70, y * 1.5, z * 1.5, 2);
    const a = arcs.ridged(qx * 1.7, y * 1.7, z * 1.7, 3);
    mixInto(out, [22, 80, 112], smoothstep(0.88, 0.95, a) * 0.45);
    if (a > 0.91) {
      const bumps = isl.fbm(x * 13, y * 13, z * 13, 3);
      const land = smoothstep(0.925, 0.955, a) * smoothstep(-0.04, 0.08, bumps);
      if (land > 0) {
        const t = 0.5 + 0.5 * isl.fbm(x * 30, y * 30, z * 30, 2);
        mixInto(out, [72 + 44 * t, 62 + 34 * t, 52 + 24 * t], land);
        mixInto(out, [255, 125, 35], land * smoothstep(0.975, 0.99, a) * smoothstep(0.15, 0.3, bumps));
      }
    }
    mixInto(out, [190, 100, 40], 0.11 * smoothstep(-0.1, 0.5, haze.fbm(x * 1.2 + 50, y * 1.2, z * 1.2, 3)));
  };
}

/** Early continents: a dark ocean with a handful of separate, irregular grey-brown cratons. */
function cratons(): Shader {
  const n = new Perlin3(41), m = new Perlin3(42), warp = new Perlin3(44);
  const rand = mulberry32(43);
  // Rejection-sample well-separated centres away from the poles so the cratons stay distinct.
  const centres: { c: Vec3; r: number }[] = [];
  for (let tries = 0; centres.length < 7 && tries < 1000; tries++) {
    const c = randomUnitVector(rand);
    const r = 0.22 + rand() * 0.16;
    if (Math.abs(c[2]) > 0.8) continue;
    if (centres.every((o) => angle(c[0], c[1], c[2], o.c) > r + o.r + 0.12)) centres.push({ c, r });
  }
  const land: RGB = [0, 0, 0];
  return (x, y, z, out) => {
    // Warping the sample point turns the round distance fields into irregular outlines.
    let qx = x + 0.32 * warp.fbm(x * 1.8 + 5, y * 1.8, z * 1.8, 3);
    let qy = y + 0.32 * warp.fbm(x * 1.8, y * 1.8 + 9, z * 1.8, 3);
    let qz = z + 0.32 * warp.fbm(x * 1.8, y * 1.8, z * 1.8 + 13, 3);
    const len = Math.hypot(qx, qy, qz);
    qx /= len; qy /= len; qz /= len;
    let f = -1;
    for (const k of centres) f = Math.max(f, 1 - angle(qx, qy, qz, k.c) / k.r);
    f += 0.3 * n.fbm(x * 4, y * 4, z * 4, 4) + 0.08 * n.fbm(x * 12, y * 12, z * 12, 2);
    const o = 0.5 + 0.5 * n.fbm(x * 3 + 30, y * 3, z * 3, 3);
    out[0] = 5 + 8 * o; out[1] = 16 + 18 * o; out[2] = 34 + 30 * o;
    mixInto(out, [26, 64, 94], smoothstep(-0.16, 0, f) * 0.6);
    const isLand = smoothstep(0, 0.03, f);
    if (isLand > 0) {
      const e = clamp01(f * 2);
      const v = 0.5 + 0.5 * m.fbm(x * 6, y * 6, z * 6, 4);
      land[0] = 92 + 40 * v; land[1] = 80 + 36 * v; land[2] = 68 + 32 * v;
      mixInto(land, [70, 58, 48], smoothstep(0.3, 0.8, e) * 0.45);
      mixInto(land, [150, 140, 128], smoothstep(0.86, 0.97, m.ridged(x * 5, y * 5, z * 5, 3)) * 0.45 * e);
      mixInto(out, land, isLand);
    }
  };
}

const SHADERS: Record<SchematicKind, () => Shader> = { magma, cooling, waterworld, cratons };
