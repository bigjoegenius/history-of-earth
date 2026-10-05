/** Camera moves: initial view, flying to events and to arbitrary places. */
import * as Cesium from 'cesium';
import type { GlobeStyle, HistoryEvent } from '../types';
import { eventPosition } from './eventPosition';

const FLIGHT_SECONDS = 1.6;
/** View height (km) per importance 1…5: landmarks are framed wider. */
const HEIGHT_BY_IMPORTANCE_KM = [800, 1400, 2000, 3000, 4000];
const GLOBAL_HEIGHT_KM = 24_000;
/**
 * Minimum flight height by surface mode. Reconstructed coastlines (paleo) are coarse snapshots and
 * some events have no palaeo-position (their markers stay at present-day coordinates), and on an
 * illustrative surface (schematic) positions mean little, so deep-time flights stay high enough to
 * keep the surrounding geography in view.
 */
const MIN_HEIGHT_KM: Record<GlobeStyle['mode'], number> = { satellite: 0, paleo: 8_000, schematic: 16_000 };
/** Within this ground distance of the target a user who is zoomed in closer keeps their zoom. */
const KEEP_ZOOM_RADIUS_KM = 1_500;
const EARTH_RADIUS_KM = 6371;
/**
 * Below this many px of uncovered screen the insets are ignored and the target is simply centred
 * (e.g. a phone sheet dragged to full height). A thin band still beats the hidden screen centre.
 */
const MIN_VISIBLE_BAND_PX = 40;

export function setInitialView(camera: Cesium.Camera): void {
  camera.setView({ destination: Cesium.Cartesian3.fromDegrees(-30, 20, 20_000_000) });
}

/**
 * Flies north-up, looking straight down (Cesium's default flight orientation), so that the target
 * lands in the middle of the part of the screen the UI leaves uncovered (see visibleBandShift).
 */
export function flyTo(scene: Cesium.Scene, lat: number, lon: number, heightKm = 2000): void {
  const camLat = Math.max(-89, Math.min(89, lat - visibleBandShiftDeg(scene, heightKm)));
  scene.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lon, camLat, heightKm * 1000), duration: FLIGHT_SECONDS });
}

/**
 * Local events: centre on the event's marker (its palaeo-position on reconstructed coastlines, see
 * eventPosition) at a height chosen by importance (and by how reliable its position is on the
 * current surface), without yanking a user who is already zoomed in nearby back out. Global events:
 * gentle zoom-out over the current spot.
 */
export function flyToEvent(scene: Cesium.Scene, ev: HistoryEvent, mode: GlobeStyle['mode']): void {
  const { camera } = scene;
  const here = camera.positionCartographic;
  const currentKm = here.height / 1000;
  if (ev.global) {
    camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(here.longitude, here.latitude, GLOBAL_HEIGHT_KM * 1000),
      duration: FLIGHT_SECONDS,
    });
    return;
  }
  const { lat, lon } = eventPosition(ev, mode);
  const minKm = MIN_HEIGHT_KM[mode];
  let heightKm = Math.max(minKm, HEIGHT_BY_IMPORTANCE_KM[ev.importance - 1] ?? 2000);
  const distanceKm = groundDistanceKm(
    Cesium.Math.toDegrees(here.latitude), Cesium.Math.toDegrees(here.longitude), lat, lon,
  );
  if (currentKm < heightKm && currentKm >= minKm && distanceKm < KEEP_ZOOM_RADIUS_KM) heightKm = currentKm;
  flyTo(scene, lat, lon, heightKm);
}

/** px a CSS custom property on :root holds (0 when unset). */
function rootPx(name: string): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) ? v : 0;
}

/**
 * How far south (degrees) to put the camera so that a target straight ahead appears in the middle
 * of the uncovered band published by the UI (`--hoe-view-top/bottom`, src/ui/viewInsets.ts) rather
 * than in the middle of the screen. Exact for a straight-down view of a sphere: a ground point at
 * angular distance α from the nadir appears β off-axis where sin(α + β) = sin β · (R + h) / R.
 */
function visibleBandShiftDeg(scene: Cesium.Scene, heightKm: number): number {
  const frustum = scene.camera.frustum;
  const screenH = scene.canvas.clientHeight;
  const fovy = frustum instanceof Cesium.PerspectiveFrustum ? frustum.fovy : undefined;
  if (fovy === undefined || screenH <= 0) return 0;
  const top = rootPx('--hoe-view-top');
  const bottom = rootPx('--hoe-view-bottom');
  if (screenH - top - bottom < MIN_VISIBLE_BAND_PX) return 0;
  // Pixels the band's centre sits above (+) the screen centre.
  const raisePx = (bottom - top) / 2;
  if (Math.abs(raisePx) < 4) return 0;
  const tanBeta = Math.tan(fovy / 2) * (raisePx / (screenH / 2));
  const beta = Math.atan(Math.abs(tanBeta));
  const ratio = Math.min(1, (Math.sin(beta) * (EARTH_RADIUS_KM + heightKm)) / EARTH_RADIUS_KM);
  const alpha = Math.max(0, Math.asin(ratio) - beta);
  return Math.sign(tanBeta) * Cesium.Math.toDegrees(alpha);
}

/** Great-circle distance (haversine). */
function groundDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
