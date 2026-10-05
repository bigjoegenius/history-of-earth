/**
 * Deterministic noise for the procedural textures. Everything is seeded so the "illustrative"
 * surfaces look identical on every load (no Math.random).
 */

/** mulberry32: tiny, fast, seedable PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniformly distributed random point on the unit sphere. */
export function randomUnitVector(rand: () => number): [number, number, number] {
  const z = rand() * 2 - 1;
  const a = rand() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), r * Math.sin(a), z];
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (t: number, a: number, b: number): number => a + t * (b - a);

/** Ken Perlin's "improved noise" gradient selection. */
function grad(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/**
 * 3D Perlin noise. Textures sample it at points on the unit sphere, which avoids the seam at
 * ±180° and the pinching at the poles that 2D noise on (lon, lat) would produce.
 */
export class Perlin3 {
  private readonly perm = new Uint8Array(512);

  constructor(seed: number) {
    const rand = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** Single octave, roughly in [-1, 1]. */
  noise(x: number, y: number, z: number): number {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z;
    const xi = X & 255, yi = Y & 255, zi = Z & 255;
    const u = fade(x), v = fade(y), w = fade(z);
    const P = this.perm;
    const A = P[xi] + yi, AA = P[A] + zi, AB = P[A + 1] + zi;
    const B = P[xi + 1] + yi, BA = P[B] + zi, BB = P[B + 1] + zi;
    return lerp(
      w,
      lerp(v, lerp(u, grad(P[AA], x, y, z), grad(P[BA], x - 1, y, z)),
        lerp(u, grad(P[AB], x, y - 1, z), grad(P[BB], x - 1, y - 1, z))),
      lerp(v, lerp(u, grad(P[AA + 1], x, y, z - 1), grad(P[BA + 1], x - 1, y, z - 1)),
        lerp(u, grad(P[AB + 1], x, y - 1, z - 1), grad(P[BB + 1], x - 1, y - 1, z - 1))),
    );
  }

  /** Fractal sum of octaves, normalised to roughly [-1, 1] (most values within ±0.6). */
  fbm(x: number, y: number, z: number, octaves: number): number {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let o = 0; o < octaves; o++) {
      // Offsetting each octave decorrelates the lattice so octaves do not line up.
      sum += amp * this.noise(x * f + o * 17.31, y * f + o * 9.17, z * f + o * 5.73);
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }

  /** Ridged fractal in [0, 1]: values near 1 trace thin, branching lines (cracks, ridges, arcs). */
  ridged(x: number, y: number, z: number, octaves: number): number {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * (1 - Math.abs(this.noise(x * f + o * 31.7, y * f + o * 11.3, z * f + o * 23.9)));
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** GLSL-style smoothstep; also works with edge0 > edge1 (a falling edge). */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
