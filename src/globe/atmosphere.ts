/** Sky and ground-atmosphere tints per AtmosphereKind (hue shift 1.0 = a full turn of the colour wheel). */
import type * as Cesium from 'cesium';
import type { AtmosphereKind, GlobeStyle } from '../types';

interface Shift {
  hue: number;
  saturation: number;
  brightness: number;
}

const PRESETS: Record<AtmosphereKind, { sky: Shift; ground: Shift }> = {
  normal: { sky: { hue: 0, saturation: 0, brightness: 0 }, ground: { hue: 0, saturation: 0, brightness: 0 } },
  // Archean organic (methane) haze: a pale, dusty orange-tan limb.
  hazy: {
    sky: { hue: -0.47, saturation: 0, brightness: 0.05 },
    ground: { hue: -0.47, saturation: 0.1, brightness: 0 },
  },
  // Hadean: a hot, CO₂/steam-rich atmosphere glowing orange over the magma.
  orange: {
    sky: { hue: -0.53, saturation: 0.25, brightness: -0.02 },
    ground: { hue: -0.53, saturation: 0.15, brightness: 0 },
  },
  // A thin, washed-out atmosphere.
  thin: {
    sky: { hue: 0, saturation: -0.55, brightness: -0.35 },
    ground: { hue: 0, saturation: -0.45, brightness: -0.25 },
  },
};

/**
 * Camera distances (m) over which the ground-atmosphere haze blends in. Cesium's defaults suit
 * photographic imagery, but from orbit they wash out the flat, darker paleo and procedural
 * surfaces, so those modes start the haze further out. The same distances control where sun
 * lighting fades in, so with lighting on Cesium's defaults are kept (day/night visible from orbit).
 */
const HAZE_FADE: Record<GlobeStyle['mode'], [fadeOut: number, fadeIn: number] | null> = {
  satellite: null, // Cesium defaults
  paleo: [2e7, 6e7],
  schematic: [2e7, 6e7],
};
let cesiumDefaultFade: [number, number] | null = null;

export function applyAtmosphere(
  scene: Cesium.Scene, kind: AtmosphereKind, mode: GlobeStyle['mode'], lighting: boolean,
): void {
  const { sky, ground } = PRESETS[kind] ?? PRESETS.normal;
  const sa = scene.skyAtmosphere;
  if (sa) {
    sa.hueShift = sky.hue;
    sa.saturationShift = sky.saturation;
    sa.brightnessShift = sky.brightness;
  }
  const g = scene.globe;
  g.atmosphereHueShift = ground.hue;
  g.atmosphereSaturationShift = ground.saturation;
  g.atmosphereBrightnessShift = ground.brightness;
  cesiumDefaultFade ??= [g.lightingFadeOutDistance, g.lightingFadeInDistance];
  [g.lightingFadeOutDistance, g.lightingFadeInDistance] = (!lighting && HAZE_FADE[mode]) || cesiumDefaultFade;
}
