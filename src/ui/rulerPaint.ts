/**
 * Pure canvas painter for the detail ruler. Canvas (not DOM) because a zoomed-out Part can hold
 * hundreds of event ticks; they are painted once into a background layer, and only the playhead is
 * repainted on every animation frame during playback.
 */
import type { HistoryEvent, Year } from '../types';
import { CATEGORIES } from '../data/categories';
import { formatYearShort, niceTickStep } from '../time/TimeModel';

export interface RulerBand { title: string; start: Year; end: Year; /** sibling index, for stable zebra striping */ index: number }

export interface RulerScene {
  width: number;
  height: number;
  range: readonly [Year, Year];
  bands: RulerBand[];
  /** Point ticks (spans included at their start), in paint order: least important first. */
  ticks: HistoryEvent[];
  spans: HistoryEvent[];
  year: Year;
  hoverId: string | null;
  selectedId: string | null;
  accent: string;
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Vertical layout in CSS px, derived from the canvas height so the mobile ruler can be shorter. */
function rulerLayout(height: number): { bandH: number; baseline: number; labelY: number; tickMax: number } {
  const bandH = 15;
  const baseline = height - 19;
  return { bandH, baseline, labelY: height - 5, tickMax: baseline - bandH - 3 };
}

/** Tick height grows with importance: 44% of the zone for importance 1, all of it for 5. */
function tickHeight(importance: number, tickMax: number): number {
  return tickMax * (0.3 + 0.14 * importance);
}

function xScale(s: RulerScene): (y: Year) => number {
  const [r0, r1] = s.range;
  return (y) => ((y - r0) / (r1 - r0)) * s.width;
}

/**
 * Everything but the playhead: bands, axis and event ticks. It does not depend on `year`, so the
 * caller can cache it and repaint only the playhead on plain playback frames.
 */
export function paintRulerBackground(ctx: CanvasRenderingContext2D, s: RulerScene): void {
  const L = rulerLayout(s.height);
  const xOf = xScale(s);
  ctx.clearRect(0, 0, s.width, s.height);
  paintBands(ctx, s, xOf, L.baseline);
  paintAxis(ctx, s, xOf, L.baseline, L.labelY);
  paintEvents(ctx, s, xOf, L.baseline, L.bandH, L.tickMax);
}

export function paintRulerPlayhead(ctx: CanvasRenderingContext2D, s: RulerScene): void {
  paintPlayhead(ctx, s, xScale(s)(s.year));
}

function paintBands(ctx: CanvasRenderingContext2D, s: RulerScene, xOf: (y: Year) => number, baseline: number): void {
  ctx.font = `600 10.5px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (const b of s.bands) {
    const x0 = Math.max(0, xOf(b.start));
    const x1 = Math.min(s.width, xOf(b.end));
    if (x1 - x0 < 1) continue;
    ctx.fillStyle = b.index % 2 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.025)';
    ctx.fillRect(x0, 0, x1 - x0, baseline);
    if (x0 > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(Math.round(x0), 0, 1, baseline);
    }
    // Titles stick to the left edge when the band starts off-screen, like sticky headers.
    const label = fitText(ctx, b.title, x1 - x0 - 8);
    if (label) {
      ctx.fillStyle = 'rgba(255,255,255,0.74)';
      ctx.fillText(label, x0 + 4, 11);
    }
  }
}

const fitCache = new Map<string, string>();

/** Truncates with an ellipsis to fit `max` px (memoised: band titles repaint every frame). */
function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (max < 18) return '';
  const key = `${text}|${Math.floor(max)}`;
  let out = fitCache.get(key);
  if (out === undefined) {
    out = text;
    if (ctx.measureText(text).width > max) {
      let lo = 0;
      let hi = text.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ctx.measureText(`${text.slice(0, mid)}…`).width <= max) lo = mid; else hi = mid - 1;
      }
      out = lo >= 2 ? `${text.slice(0, lo).trimEnd()}…` : '';
    }
    if (fitCache.size > 500) fitCache.clear();
    fitCache.set(key, out);
  }
  return out;
}

/**
 * Axis tick years. Uses niceTickStep (1-2-5) down to whole years; below that, month ticks
 * (1/2/3/6 months) so labels like "Aug 1914" sit exactly on month starts.
 */
function axisTicks(r0: Year, r1: Year, width: number): Year[] {
  // ~1 label per 70 px (at least 3) keeps phones from ending up with a single label.
  const target = Math.max(3, Math.floor(width / 70));
  const span = r1 - r0;
  const out: Year[] = [];
  if ((span * 12) / target < 6) {
    const stepM = [1, 2, 3, 6].find((m) => (span * 12) / m <= target) ?? 6;
    const first = Math.ceil((r0 * 12) / stepM);
    for (let i = first; (i * stepM) / 12 <= r1; i++) out.push((i * stepM) / 12);
    return out;
  }
  const step = Math.max(1, niceTickStep(span, target));
  const first = Math.ceil(r0 / step);
  for (let i = first; i * step <= r1; i++) out.push(i * step);
  return out;
}

function paintAxis(ctx: CanvasRenderingContext2D, s: RulerScene, xOf: (y: Year) => number, baseline: number, labelY: number): void {
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(0, baseline, s.width, 1);
  ctx.font = `10px ${FONT}`;
  ctx.textAlign = 'center';
  let lastRight = -Infinity;
  for (const v of axisTicks(s.range[0], s.range[1], s.width)) {
    const x = Math.round(xOf(v));
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(x, baseline, 1, 4);
    const label = formatYearShort(v);
    const w = ctx.measureText(label).width;
    const cx = Math.min(Math.max(x, w / 2 + 2), s.width - w / 2 - 2);
    if (cx - w / 2 < lastRight + 8) continue; // skip labels that would collide
    ctx.fillStyle = 'rgba(255,255,255,0.66)';
    ctx.fillText(label, cx, labelY);
    lastRight = cx + w / 2;
  }
}

function paintEvents(
  ctx: CanvasRenderingContext2D, s: RulerScene, xOf: (y: Year) => number,
  baseline: number, bandH: number, tickMax: number,
): void {
  // Spans: a thin bar along the baseline from start to end.
  ctx.globalAlpha = 0.5;
  for (const e of s.spans) {
    const x0 = Math.max(0, xOf(e.year));
    const x1 = Math.min(s.width, xOf(e.endYear ?? e.year));
    ctx.fillStyle = CATEGORIES[e.category].color;
    ctx.fillRect(x0, baseline - 3, Math.max(1.5, x1 - x0), 2);
  }
  ctx.globalAlpha = 1;

  let hovered: HistoryEvent | null = null;
  for (const e of s.ticks) {
    if (e.id === s.hoverId) { hovered = e; continue; }
    const x = Math.round(xOf(e.year)) + 0.5;
    const top = baseline - tickHeight(e.importance, tickMax);
    ctx.strokeStyle = CATEGORIES[e.category].color;
    ctx.lineWidth = e.importance >= 4 ? 2 : 1;
    // Fringe theories are dashed here too, matching their dashed cards.
    ctx.setLineDash(e.consensus === 'fringe' ? [2, 2] : []);
    ctx.beginPath();
    ctx.moveTo(x, baseline);
    ctx.lineTo(x, top);
    ctx.stroke();
    if (e.importance === 5 || e.id === s.selectedId) {
      ctx.fillStyle = e.id === s.selectedId ? '#fff' : CATEGORIES[e.category].color;
      ctx.beginPath();
      ctx.arc(x, top, e.id === s.selectedId ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.setLineDash([]);
  if (hovered) {
    const x = Math.round(xOf(hovered.year)) + 0.5;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, baseline);
    ctx.lineTo(x, bandH);
    ctx.stroke();
    ctx.fillStyle = CATEGORIES[hovered.category].color;
    ctx.beginPath();
    ctx.arc(x, bandH, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function paintPlayhead(ctx: CanvasRenderingContext2D, s: RulerScene, px: number): void {
  ctx.fillStyle = s.accent;
  if (px >= 0 && px <= s.width) {
    const x = Math.round(px);
    ctx.shadowColor = s.accent;
    ctx.shadowBlur = 6;
    ctx.fillRect(x - 1, 0, 2, s.height);
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(x - 5, 0);
    ctx.lineTo(x + 5, 0);
    ctx.lineTo(x, 6);
    ctx.fill();
    return;
  }
  // Playhead outside the zoomed window: an arrow at the edge shows which way it is.
  const left = px < 0;
  const x = left ? 2 : s.width - 2;
  const dir = left ? 1 : -1;
  const mid = s.height / 2;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(x, mid);
  ctx.lineTo(x + dir * 7, mid - 6);
  ctx.lineTo(x + dir * 7, mid + 6);
  ctx.fill();
  ctx.globalAlpha = 1;
}
