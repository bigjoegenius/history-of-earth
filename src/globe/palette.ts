/** Fallback and base colours for the globe surface (CSS strings). */
import type { GlobeStyle, SchematicKind } from '../types';

export const DEFAULT_LAND = '#8b8f62';
export const DEFAULT_OCEAN = '#16406a';
/** Shown while satellite tiles stream in. */
const SATELLITE_BASE = '#0b1d33';

/** Dominant colour of each procedural texture, used as the globe colour until it is ready. */
const SCHEMATIC_BASE: Record<SchematicKind, string> = {
  magma: '#28100a',
  cooling: '#1c1a1c',
  waterworld: '#06142a',
  cratons: '#08182e',
};

/** Globe base colour (visible wherever no imagery layer covers the surface yet). */
export function baseColorFor(style: GlobeStyle): string {
  switch (style.mode) {
    case 'paleo': return style.oceanColor ?? DEFAULT_OCEAN;
    case 'schematic': return SCHEMATIC_BASE[style.schematic ?? 'cratons'];
    default: return SATELLITE_BASE;
  }
}
