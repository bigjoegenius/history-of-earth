/**
 * The Cesium globe: imagery or reconstructed/illustrative surfaces for the current year, ice
 * caps, historical borders, event markers and camera moves. See SPEC.md "Globe".
 */
import * as Cesium from 'cesium';
import type { GlobeStyle, HistoryEvent, Settings, Year } from '../types';
import { DEFAULT_SETTINGS } from '../state/Store';
import { createViewer } from './viewer';
import { applyAtmosphere } from './atmosphere';
import { flyTo, flyToEvent, setInitialView } from './camera';
import { LayerStack } from './layerStack';
import { RasterClient } from './rasterClient';
import { SurfaceLayer } from './surfaceLayer';
import { IceLayer } from './iceLayer';
import { BordersLayer } from './bordersLayer';
import { MarkersLayer } from './markersLayer';
import { attachPicking } from './picking';
import { baseColorFor } from './palette';

export interface GlobeController {
  setYear(year: Year, style: GlobeStyle): void;      // called on every year change (cheap; loads snapshots lazily & debounced)
  setEvents(events: HistoryEvent[]): void;            // markers to show (visible set)
  setSelected(id: string | null): void;
  flyToEvent(ev: HistoryEvent): void;                 // smooth flyTo; global events → gentle zoom-out instead
  flyTo(lat: number, lon: number, heightKm?: number): void;
  setSettings(s: Settings): void;
  onEventClick(cb: (id: string) => void): void;
  pulse(id: string): void;                            // brief marker highlight
  destroy(): void;
}

export async function createGlobe(container: HTMLElement): Promise<GlobeController> {
  const { viewer, base, hiRes } = createViewer(container);
  const { scene } = viewer;
  const requestRender = (): void => scene.requestRender();
  // Render at device resolution so labels and coastlines stay crisp on high-DPI screens, but at
  // most 2 device px per CSS px: 3× phones would otherwise shade 2.25× the pixels for no visible gain.
  // requestRenderMode keeps the cost to frames where something actually changes.
  viewer.useBrowserRecommendedResolution = false;
  viewer.resolutionScale = Math.min(1, 2 / (window.devicePixelRatio || 1));
  setInitialView(viewer.camera);

  const raster = new RasterClient();
  // Slots stack bottom → top: surface (paleo/schematic), ice caps, borders.
  const stack = new LayerStack(viewer.imageryLayers, requestRender, [base, hiRes]);
  const isDisplaying = (b: ImageBitmap): boolean => stack.isDisplaying(b);
  const surface = new SurfaceLayer(stack.addSlot({ fadeOutUnder: false }), raster, isDisplaying);
  const ice = new IceLayer(stack.addSlot({ fadeOutUnder: true }), raster, isDisplaying);
  const borders = new BordersLayer(scene, stack.addSlot({ fadeOutUnder: true }), raster, isDisplaying);
  const markers = new MarkersLayer(scene);

  const clickHandlers = new Set<(id: string) => void>();
  const detachPicking = attachPicking(scene, (id) => markers.has(id), (id) => {
    for (const cb of clickHandlers) cb(id);
  });

  let settings: Settings = { ...DEFAULT_SETTINGS };
  let year: Year | null = null;
  let style: GlobeStyle | null = null;
  let baseCss = '';

  const applyAtmosphereNow = (): void =>
    applyAtmosphere(scene, style?.atmosphere ?? 'normal', style?.mode ?? 'satellite', settings.lighting);
  const applyImagery = (): void => {
    // Satellite imagery is hidden (and stops streaming tiles) outside satellite mode.
    const satellite = !style || style.mode === 'satellite';
    base.show = satellite;
    hiRes.show = satellite && settings.highResImagery;
  };
  const applyBorders = (): void => {
    if (year !== null && style) borders.update(year, !!style.borders && settings.showBorders, settings.showLabels);
  };

  markers.setSettings(settings);
  scene.globe.enableLighting = settings.lighting;
  applyImagery();
  applyAtmosphereNow();

  return {
    setYear(y, s) {
      const prev = style;
      year = y;
      style = s;
      // Layers and markers request their own renders when they change; only global scene
      // properties are handled here, so steady playback inside one snapshot renders nothing.
      if (prev?.atmosphere !== s.atmosphere || prev?.mode !== s.mode) {
        applyAtmosphereNow();
        applyImagery();
        markers.setMode(s.mode);
        requestRender();
      }
      const css = baseColorFor(s);
      if (css !== baseCss) {
        baseCss = css;
        scene.globe.baseColor = Cesium.Color.fromCssColorString(css) ?? Cesium.Color.BLACK;
        requestRender();
      }
      surface.update(y, s);
      ice.update(s.iceCapLatitude);
      applyBorders();
    },
    setEvents(events) {
      markers.setEvents(events);
    },
    setSelected(id) {
      markers.setSelected(id);
    },
    flyToEvent(ev) {
      flyToEvent(scene, ev, style?.mode ?? 'satellite');
    },
    flyTo(lat, lon, heightKm) {
      flyTo(scene, lat, lon, heightKm);
    },
    setSettings(s) {
      settings = { ...s };
      scene.globe.enableLighting = s.lighting;
      applyAtmosphereNow();
      applyImagery();
      applyBorders();
      markers.setSettings(settings);
      requestRender();
    },
    onEventClick(cb) {
      clickHandlers.add(cb);
    },
    pulse(id) {
      markers.pulse(id);
    },
    destroy() {
      detachPicking();
      clickHandlers.clear();
      markers.destroy();
      stack.destroy();
      surface.destroy();
      ice.destroy();
      borders.destroy();
      raster.destroy();
      viewer.destroy();
    },
  };
}
