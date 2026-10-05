/** Small colour helpers shared by the painters (worker) and marker icons (main thread). */

export type RGB = [number, number, number];

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** In-place variant of `mix` for hot per-pixel loops (avoids allocating). */
export function mixInto(out: RGB, b: RGB, t: number): RGB {
  out[0] += (b[0] - out[0]) * t;
  out[1] += (b[1] - out[1]) * t;
  out[2] += (b[2] - out[2]) * t;
  return out;
}

export function toCss([r, g, b]: RGB, alpha = 1): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

/** Multiply brightness (f < 1 darkens, f > 1 lightens towards white). */
export function shade(c: RGB, f: number): RGB {
  return f <= 1 ? [c[0] * f, c[1] * f, c[2] * f] : mix(c, [255, 255, 255], Math.min(1, f - 1));
}

let probe: OffscreenCanvasRenderingContext2D | null = null;

/**
 * Parse any CSS colour (named, hex, rgb(), hsl()) to RGB. Canvas normalises `fillStyle` to
 * "#rrggbb" or "rgba(…)", which works both in the worker and on the main thread.
 */
export function parseCss(css: string, fallback: RGB): RGB {
  probe ??= new OffscreenCanvas(1, 1).getContext('2d');
  if (!probe) return fallback;
  probe.fillStyle = '#000';
  probe.fillStyle = css;
  const s = String(probe.fillStyle);
  if (s.startsWith('#') && s.length === 7) {
    return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return fallback;
  const [r, g, b] = m[1].split(',').map((v) => parseFloat(v));
  return [r, g, b];
}

/** Stable 32-bit FNV-1a hash of a string (used for per-polity border colours). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
