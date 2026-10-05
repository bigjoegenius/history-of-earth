/**
 * Canvas icons for event markers, one per (category, selected) pair, drawn at 2× for crisp
 * edges. Fringe theories get a dashed outline and a "?" so they are recognisable as such even
 * without a label.
 */
import { CATEGORIES } from '../data/categories';
import type { EventCategory } from '../types';

export interface MarkerIcon {
  /** Texture-atlas id: Cesium stores each id once however many billboards share it. */
  id: string;
  canvas: HTMLCanvasElement;
  /** Fraction of the canvas width taken by the coloured dot plus its border. */
  dotFraction: number;
  /** Radius of everything drawn (dot or selection ring), as a fraction of the canvas width. */
  outerFraction: number;
}

const DOT_RADIUS = 24;
const BORDER = 4;
const RING_RADIUS = 44;
const RING_WIDTH = 4;
const cache = new Map<string, MarkerIcon>();

/** `fringe` = the event is a fringe theory (by category or consensus). */
export function markerIcon(category: EventCategory, selected: boolean, fringe: boolean): MarkerIcon {
  const id = `marker:${category}:${selected ? 'sel' : 'n'}:${fringe ? 'fringe' : ''}`;
  let icon = cache.get(id);
  if (!icon) {
    icon = draw(id, category, selected, fringe);
    cache.set(id, icon);
  }
  return icon;
}

function draw(id: string, category: EventCategory, selected: boolean, fringe: boolean): MarkerIcon {
  const size = selected ? 104 : 64;
  const c = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const dotFraction = (2 * (DOT_RADIUS + BORDER / 2)) / size;
  const outerFraction = selected ? (RING_RADIUS + RING_WIDTH / 2) / size : dotFraction / 2;
  if (!ctx) return { id, canvas, dotFraction, outerFraction };

  if (selected) {
    ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = RING_WIDTH;
    ctx.beginPath();
    ctx.arc(c, c, RING_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = CATEGORIES[category]?.color ?? '#cccccc';
  ctx.beginPath();
  ctx.arc(c, c, DOT_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  ctx.lineWidth = BORDER;
  ctx.strokeStyle = fringe ? 'rgba(240, 240, 240, 0.95)' : 'rgba(255, 255, 255, 0.92)';
  if (fringe) ctx.setLineDash([7, 5]);
  ctx.beginPath();
  ctx.arc(c, c, DOT_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  if (fringe) {
    ctx.fillStyle = '#1d1d1d';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', c, c + 2);
  }
  return { id, canvas, dotFraction, outerFraction };
}
