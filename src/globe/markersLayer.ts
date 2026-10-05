/**
 * Event markers: a billboard per located event (coloured by category, sized by importance) and
 * a title label for major events. `global` events get no marker (the UI shows a banner).
 * On the plate model's coastlines ('paleo' mode) markers sit at the event's reconstructed
 * palaeo-position when it has one, else where the site is today (see eventPosition()).
 * Labels are decluttered in screen space after every render (see declutter()).
 */
import * as Cesium from 'cesium';
import type { GlobeStyle, HistoryEvent, Settings } from '../types';
import { getEvent } from '../data/index';
import { eventPosition } from './eventPosition';
import { markerIcon } from './markerIcons';
import { tween } from './tween';

/** On-screen dot diameter (px) by importance 1…5. */
const SIZE_BY_IMPORTANCE = [12, 16, 20, 24, 28];
const SELECTED_SCALE = 1.3;
const LABEL_MIN_IMPORTANCE = 4;
const PULSE_MS = 1000;
/** A pulse requested just before its marker is added still plays when the marker appears. */
const PULSE_GRACE_MS = 1000;
const LABEL_FONT_PX = 13;
/** Height of one label line for overlap tests, and the gap kept between two labels. */
const LABEL_LINE_H = 16;
const LABEL_GAP_PX = 3;
/**
 * Labels are hidden when their marker is within ~5° of the globe's limb as seen from the camera
 * (sin 5°): there the label, drawn above the marker, floats off the globe into space.
 */
const LIMB_MIN_SIN = 0.087;

interface Marker {
  ev: HistoryEvent;
  position: Cesium.Cartesian3;
  /** Whether `position` is the reconstructed palaeo-position (not the present-day site). */
  reconstructed: boolean;
  billboard: Cesium.Billboard;
  label: Cesium.Label;
  /** Whether the marker is entitled to a label (major or selected); declutter() decides if it shows. */
  wantsLabel: boolean;
  /** Label size in px (width measured) and its distance above the marker's anchor. */
  labelWidth: number;
  labelHeight: number;
  labelLift: number;
  stopPulse?: () => void;
}

interface Box { x0: number; y0: number; x1: number; y1: number }

export class MarkersLayer {
  private readonly billboards: Cesium.BillboardCollection;
  private readonly labels: Cesium.LabelCollection;
  private readonly markers = new Map<string, Marker>();
  private readonly removePostRender: () => void;
  private events: HistoryEvent[] = [];
  private selectedId: string | null = null;
  private settings: Settings | null = null;
  private mode: GlobeStyle['mode'] = 'satellite';
  private pendingPulse: { id: string; at: number } | null = null;

  constructor(private readonly scene: Cesium.Scene) {
    this.billboards = scene.primitives.add(new Cesium.BillboardCollection({ scene })) as Cesium.BillboardCollection;
    this.labels = scene.primitives.add(new Cesium.LabelCollection({ scene })) as Cesium.LabelCollection;
    this.removePostRender = scene.postRender.addEventListener(() => this.declutter());
  }

  has(id: string): boolean {
    return this.markers.has(id);
  }

  setEvents(events: HistoryEvent[]): void {
    this.events = events;
    this.sync();
  }

  setSettings(s: Settings): void {
    this.settings = s;
    this.billboards.show = this.labels.show = s.showMarkers;
    this.sync();
  }

  /**
   * The surface mode decides where markers sit (palaeo-position on reconstructed coastlines) and
   * whether the selected label notes that its position is present-day.
   */
  setMode(mode: GlobeStyle['mode']): void {
    if (mode === this.mode) return;
    this.mode = mode;
    let changed = false;
    for (const m of this.markers.values()) {
      const p = eventPosition(m.ev, mode);
      if (p.reconstructed === m.reconstructed) continue;
      m.reconstructed = p.reconstructed;
      m.position = Cesium.Cartesian3.fromDegrees(p.lon, p.lat);
      m.billboard.position = m.position;
      m.label.position = m.position;
      changed = true;
    }
    const sel = this.selectedId ? this.markers.get(this.selectedId) : undefined;
    if (sel) this.style(sel);
    if (changed || sel) this.render();
  }

  setSelected(id: string | null): void {
    if (id === this.selectedId) return;
    const prev = this.selectedId;
    this.selectedId = id;
    // The selected event keeps a marker even when it is outside the visible set.
    this.sync();
    for (const markerId of [prev, id]) {
      const m = markerId ? this.markers.get(markerId) : undefined;
      if (m) this.style(m);
    }
    this.render();
  }

  pulse(id: string): void {
    const m = this.markers.get(id);
    if (!m) {
      this.pendingPulse = { id, at: performance.now() };
      return;
    }
    m.stopPulse?.();
    m.stopPulse = tween(
      PULSE_MS,
      (t) => {
        m.billboard.scale = 1 + 0.9 * Math.sin(Math.PI * t);
        this.scene.requestRender();
      },
      () => {
        m.billboard.scale = 1;
        m.stopPulse = undefined;
        this.scene.requestRender();
      },
    );
  }

  destroy(): void {
    this.removePostRender();
    for (const m of this.markers.values()) m.stopPulse?.();
    this.markers.clear();
    this.scene.primitives.remove(this.billboards);
    this.scene.primitives.remove(this.labels);
  }

  private visible(e: HistoryEvent): boolean {
    const s = this.settings;
    if (e.global || !Number.isFinite(e.lat) || !Number.isFinite(e.lon)) return false;
    if (e.id === this.selectedId) return true;
    return !s || (e.importance >= s.minImportance && (s.showFringe || !isFringe(e)));
  }

  private sync(): void {
    const wanted = new Map<string, HistoryEvent>();
    for (const e of this.events) if (this.visible(e)) wanted.set(e.id, e);
    const sel = this.selectedId ? getEvent(this.selectedId) : undefined;
    if (sel && !wanted.has(sel.id) && this.visible(sel)) wanted.set(sel.id, sel);

    let changed = false;
    for (const [id, m] of this.markers) {
      if (wanted.has(id)) continue;
      changed = true;
      m.stopPulse?.();
      this.billboards.remove(m.billboard);
      this.labels.remove(m.label);
      this.markers.delete(id);
    }
    for (const [id, ev] of wanted) {
      if (this.markers.has(id)) continue;
      changed = true;
      const at = eventPosition(ev, this.mode);
      const position = Cesium.Cartesian3.fromDegrees(at.lon, at.lat);
      const fringe = isFringe(ev);
      const m: Marker = {
        ev,
        position,
        reconstructed: at.reconstructed,
        billboard: this.billboards.add({ position, id }),
        label: this.labels.add({
          position,
          id,
          // Hidden until declutter() has placed it, so overlapping labels never flash up.
          show: false,
          font: `${fringe ? 'italic ' : ''}${LABEL_FONT_PX}px sans-serif`,
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        }),
        wantsLabel: false,
        labelWidth: 0,
        labelHeight: 0,
        labelLift: 0,
      };
      this.markers.set(id, m);
      this.style(m);
      if (this.pendingPulse?.id === id && performance.now() - this.pendingPulse.at < PULSE_GRACE_MS) {
        this.pendingPulse = null;
        this.pulse(id);
      }
    }
    // setEvents may arrive every frame; only re-render when the marker set changed.
    if (changed) this.render();
  }

  private style(m: Marker): void {
    const selected = m.ev.id === this.selectedId;
    const fringe = isFringe(m.ev);
    const icon = markerIcon(m.ev.category, selected, fringe);
    const dot = (SIZE_BY_IMPORTANCE[m.ev.importance - 1] ?? 16) * (selected ? SELECTED_SCALE : 1);
    const size = dot / icon.dotFraction;
    m.billboard.setImage(icon.id, icon.canvas);
    m.billboard.width = size;
    m.billboard.height = size;
    // Nudge the selected marker towards the camera so it draws over neighbours.
    m.billboard.eyeOffset = selected ? new Cesium.Cartesian3(0, 0, -10_000) : Cesium.Cartesian3.ZERO;
    m.wantsLabel = selected || m.ev.importance >= LABEL_MIN_IMPORTANCE;
    const text = labelText(m.ev, fringe, selected && this.mode !== 'satellite' && !m.reconstructed);
    if (m.label.text !== text) {
      m.label.text = text;
      const lines = text.split('\n');
      m.labelWidth = Math.max(...lines.map((l) => measureText(l, m.label.font)));
      m.labelHeight = lines.length * LABEL_LINE_H;
    }
    m.labelLift = size * icon.outerFraction + 5;
    m.label.pixelOffset = new Cesium.Cartesian2(0, -m.labelLift);
    m.label.eyeOffset = m.billboard.eyeOffset;
    if (!m.wantsLabel) m.label.show = false;
  }

  /**
   * Greedy screen-space label placement, run after every render: labels are ranked (selected, then
   * importance, then mainstream before fringe, then the most recent event) and each is shown only if
   * its box does not overlap a label already placed and its marker is not near or beyond the limb.
   * A change takes effect on the next frame; the outcome only depends on the camera, so this settles
   * after one extra render.
   */
  private declutter(): void {
    if (!this.labels.show) return;
    const camera = this.scene.camera;
    const ranked = [...this.markers.values()]
      .filter((m) => m.wantsLabel)
      .sort((a, b) => Number(b.ev.id === this.selectedId) - Number(a.ev.id === this.selectedId)
        || b.ev.importance - a.ev.importance || Number(isFringe(a.ev)) - Number(isFringe(b.ev))
        || b.ev.year - a.ev.year);
    const placed: Box[] = [];
    let changed = false;
    for (const m of ranked) {
      const box = this.facesCamera(m.position, camera) ? this.labelBox(m) : null;
      const show = box !== null && !placed.some((p) => overlaps(p, box));
      if (show) placed.push(box);
      if (m.label.show !== show) {
        m.label.show = show;
        changed = true;
      }
    }
    if (changed) this.scene.requestRender();
  }

  private facesCamera(p: Cesium.Cartesian3, camera: Cesium.Camera): boolean {
    const normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(p, scratchNormal);
    const toCamera = Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(camera.positionWC, p, scratchToCamera), scratchToCamera);
    return Cesium.Cartesian3.dot(normal, toCamera) > LIMB_MIN_SIN;
  }

  /** Window-space box of a label (CSS px), or null when the marker does not project on screen. */
  private labelBox(m: Marker): Box | null {
    const w = Cesium.SceneTransforms.worldToWindowCoordinates(this.scene, m.position, scratchWindow);
    if (!w) return null;
    const half = m.labelWidth / 2 + LABEL_GAP_PX;
    const bottom = w.y - m.labelLift;
    return { x0: w.x - half, x1: w.x + half, y0: bottom - m.labelHeight - LABEL_GAP_PX, y1: bottom };
  }

  /** Billboard images load into the texture atlas asynchronously, so render again shortly after. */
  private render(): void {
    this.scene.requestRender();
    setTimeout(() => { if (!this.scene.isDestroyed()) this.scene.requestRender(); }, 60);
  }
}

const scratchNormal = new Cesium.Cartesian3();
const scratchToCamera = new Cesium.Cartesian3();
const scratchWindow = new Cesium.Cartesian2();

function isFringe(e: HistoryEvent): boolean {
  return e.consensus === 'fringe' || e.category === 'fringe';
}

/**
 * Fringe claims are labelled as such on the globe too, not only in the side panel (unless the title
 * already says so). Before the satellite era the selected label also notes when its marker uses
 * present-day coordinates (no palaeo-position, or an illustrative surface), which need not match
 * the geography drawn.
 */
function labelText(ev: HistoryEvent, fringe: boolean, presentDay: boolean): string {
  const title = fringe && !/fringe/i.test(ev.title) ? `${ev.title} (fringe theory)` : ev.title;
  return presentDay ? `${title}\n(present-day location)` : title;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Width (px) of one line of label text in the label's own font (estimated without a 2D canvas). */
function measureText(line: string, font: string): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return line.length * LABEL_FONT_PX * 0.55;
  measureCtx.font = font;
  return measureCtx.measureText(line).width;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}
