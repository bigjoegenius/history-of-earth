/**
 * Paleogeography raster: reconstructed coastlines (GPlates, Merdith 2021) painted as land over
 * a flat ocean, with a soft continental-shelf halo and lighter coastal lowlands so continents
 * read clearly from orbit. Optional plate boundaries are stroked on top.
 *
 * The coastline polygons are abutting terrane fragments, so they are never outlined in a
 * contrasting colour (that would draw every internal seam). Coast effects are derived from the
 * merged land mask instead, using canvas shadows as a cheap blur.
 *
 * The output is painted upside down (south at the top), ready for WebGL upload, so the worker can
 * hand the canvas over with transferToImageBitmap instead of copying it into a flipped bitmap.
 */
import { linesOf, polygonsOf, type FeatureCollection } from './geo';
import { tracePolygon, traceRing } from './canvasPath';
import { mix, parseCss, shade, toCss, type RGB } from './colors';

const DEFAULT_LAND: RGB = [122, 139, 90];
const DEFAULT_OCEAN: RGB = [16, 46, 82];

/** Stroke colours by GPlates topology type; anything else is drawn faintly. */
const BOUNDARY_COLORS: Record<string, string> = {
  MidOceanRidge: 'rgba(255, 214, 120, 0.75)',
  SubductionZone: 'rgba(255, 96, 80, 0.8)',
  Transform: 'rgba(150, 210, 255, 0.6)',
  ContinentalRift: 'rgba(255, 160, 64, 0.75)',
};
const OTHER_BOUNDARY = 'rgba(255, 255, 255, 0.25)';

export function paintPaleo(
  canvas: OffscreenCanvas, coast: FeatureCollection, plates: FeatureCollection | null,
  landCss: string, oceanCss: string,
): void {
  const { width: w, height: h } = canvas;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const land = parseCss(landCss, DEFAULT_LAND);
  const ocean = parseCss(oceanCss, DEFAULT_OCEAN);
  const px = w / 4096; // blur radii and line widths are tuned for a 4096 px wide raster

  // 1. Land mask. Each polygon is filled on its own: overlapping fragments from different
  //    plates would cancel each other out under a single even-odd fill. A thin stroke in the
  //    same colour then dilates the mask slightly, closing the slivers left between fragments
  //    that were simplified independently (it is invisible inside the land).
  const landLayer = new OffscreenCanvas(w, h);
  const lctx = landLayer.getContext('2d');
  if (!lctx) throw new Error('2D canvas unavailable');
  const landFill = toCss(shade(land, 0.9));
  lctx.fillStyle = landFill;
  const polygons = coast.features.flatMap((f) => polygonsOf(f.geometry));
  for (const poly of polygons) {
    lctx.beginPath();
    tracePolygon(lctx, poly, w, h);
    lctx.fill('evenodd');
  }
  lctx.beginPath();
  for (const poly of polygons) for (const ring of poly) traceRing(lctx, ring, w, h, true);
  lctx.strokeStyle = landFill;
  lctx.lineWidth = 3 * px;
  lctx.lineJoin = 'round';
  lctx.stroke();

  // 2. Lighter coastal lowlands: the blurred shadow of the ocean, kept only where land is.
  //    A blurred shadow fades fast, so it is drawn twice to read at globe scale.
  const oceanMask = new OffscreenCanvas(w, h);
  const octx = oceanMask.getContext('2d');
  if (octx) {
    octx.fillRect(0, 0, w, h);
    octx.globalCompositeOperation = 'destination-out';
    octx.drawImage(landLayer, 0, 0);
    lctx.globalCompositeOperation = 'source-atop';
    lctx.shadowColor = toCss(shade(land, 1.35));
    lctx.shadowBlur = 16 * px;
    lctx.drawImage(oceanMask, 0, 0);
    lctx.drawImage(oceanMask, 0, 0);
  }

  // The scratch layers are full-size (up to ~34 MB each): free their backing stores now rather
  // than whenever the worker's garbage collector gets round to it. The land layer is still needed.
  oceanMask.width = oceanMask.height = 0;

  // 3. Ocean, then the land on top casting a pale continental-shelf halo (wide, then narrow).
  //    Everything from here on is drawn flipped vertically (see the module comment); shadows
  //    have no offset, so the flip does not move them.
  ctx.setTransform(1, 0, 0, -1, 0, h);
  ctx.fillStyle = toCss(ocean);
  ctx.fillRect(0, 0, w, h);
  const shelf = mix(ocean, [130, 205, 222], 0.5);
  ctx.shadowColor = toCss(shelf, 0.9);
  ctx.shadowBlur = 34 * px;
  ctx.drawImage(landLayer, 0, 0);
  ctx.shadowColor = toCss(shelf);
  ctx.shadowBlur = 9 * px;
  ctx.drawImage(landLayer, 0, 0);
  ctx.drawImage(landLayer, 0, 0);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  landLayer.width = landLayer.height = 0;

  if (plates) strokeBoundaries(ctx, plates, w, h, Math.max(1, 1.6 * px));
}

function strokeBoundaries(
  ctx: OffscreenCanvasRenderingContext2D, plates: FeatureCollection, w: number, h: number, lineWidth: number,
): void {
  const byColor = new Map<string, FeatureCollection['features']>();
  for (const f of plates.features) {
    const color = BOUNDARY_COLORS[String(f.properties?.type)] ?? OTHER_BOUNDARY;
    const list = byColor.get(color) ?? [];
    list.push(f);
    byColor.set(color, list);
  }
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  for (const [color, features] of byColor) {
    ctx.beginPath();
    for (const f of features) for (const line of linesOf(f.geometry)) traceRing(ctx, line, w, h, false);
    ctx.strokeStyle = color;
    ctx.stroke();
  }
}
