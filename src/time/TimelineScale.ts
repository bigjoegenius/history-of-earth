/**
 * Overview scrubber mapping (SPEC "Overview scrubber mapping"): position p ∈ [0, 1] ↔ year,
 * piecewise linear over the level-1 Parts, each Part getting width ∝ its timelineWeight.
 * A linear axis would give the whole of recorded history less than a millionth of the bar.
 */
import type { Chapter, Year } from '../types';

export interface Segment { chapter: Chapter; p0: number; p1: number }

export class TimelineScale {
  private readonly parts: Chapter[];
  /** bounds[i] is where part i starts on the bar; bounds[parts.length] === 1. Shared by neighbours so boundaries map exactly. */
  private readonly bounds: number[];

  constructor(parts: Chapter[]) {
    if (parts.length === 0) throw new Error('TimelineScale needs at least one part');
    this.parts = [...parts].sort((a, b) => a.start - b.start);
    const weights = this.parts.map((c) => (c.timelineWeight && c.timelineWeight > 0 ? c.timelineWeight : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    this.bounds = [0];
    for (const w of weights) {
      acc += w;
      this.bounds.push(acc / total);
    }
    this.bounds[this.bounds.length - 1] = 1; // remove accumulated rounding at the far end
  }

  /** Bar position of year y, clamped to [0, 1]. */
  toPosition(y: Year): number {
    const i = this.indexAtYear(y);
    const c = this.parts[i];
    const t = clamp01((y - c.start) / (c.end - c.start));
    return clamp01(this.bounds[i] + t * (this.bounds[i + 1] - this.bounds[i]));
  }

  /** Year at bar position p (clamped); the exact inverse of toPosition inside each segment. */
  toYear(p: number): Year {
    const q = clamp01(p);
    const i = this.indexAtPosition(q);
    const c = this.parts[i];
    const t = (q - this.bounds[i]) / (this.bounds[i + 1] - this.bounds[i]);
    return c.start + t * (c.end - c.start);
  }

  /** Parts in chronological order with their bar extents (for drawing labels). */
  segments(): Segment[] {
    return this.parts.map((chapter, i) => ({ chapter, p0: this.bounds[i], p1: this.bounds[i + 1] }));
  }

  /** Part containing y (the first/last part for years outside the timeline). */
  partAt(y: Year): Chapter {
    return this.parts[this.indexAtYear(y)];
  }

  /** Year range for the linear detail ruler when a chapter is focused, clamped to the timeline. */
  detailRangeFor(chapter: Chapter): [Year, Year] {
    const first = this.parts[0].start;
    const last = this.parts[this.parts.length - 1].end;
    return [Math.max(first, chapter.start), Math.min(last, chapter.end)];
  }

  /** Last part whose start ≤ y (parts are [start, end); the final end belongs to the last part). */
  private indexAtYear(y: Year): number {
    let lo = 0;
    let hi = this.parts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.parts[mid].start <= y) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  /** Last segment whose p0 ≤ p. */
  private indexAtPosition(p: number): number {
    let lo = 0;
    let hi = this.parts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.bounds[mid] <= p) lo = mid; else hi = mid - 1;
    }
    return lo;
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
