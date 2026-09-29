/// <reference types="geojson" />
// src/map/ncrOutsideMask.ts
//
// The VISUAL "outside Metro Manila" mask. BahaRoute is scoped to NCR, so we
// paint everything OUTSIDE the 17 LGUs with a clean, light neutral fill. This
// strongly suppresses surrounding CALABARZON / Central Luzon context (Antipolo,
// Bacoor, Imus, San Pedro, Cavite City, …) while leaving the Metro Manila
// basemap — roads, labels, and the Manila Bay / Laguna de Bay coastline INSIDE
// NCR — fully visible through the holes.
//
// This is DISTINCT from the 3D `clip` mask in `metroManilaClipMask.ts` (which
// removes 3D building/tree models). Both derive their geometry from the SAME
// existing 17-LGU city boundaries, so the NCR footprint is authoritative and no
// new boundary dataset is introduced.
//
// The mask is ONE world-sized polygon whose holes are the NCR city outer rings.
// Rendered as a single fill layer — never hundreds of features. Pure/engine-free
// so it is unit-testable without a real map.

import { buildMetroManilaClipMask } from './metroManilaClipMask';
import { metroManilaCityBoundaries } from '../data/geojson/metroManilaCityBoundaries';

/** Source + layer id for the outside-NCR visual mask fill. */
export const NCR_OUTSIDE_MASK_SOURCE_ID = 'ncr-outside-mask';
export const NCR_OUTSIDE_MASK_LAYER_ID = 'ncr-outside-mask-fill';

/**
 * The mask fill color — a light neutral matching BahaRoute's quiet basemap
 * background so the outside reads as "off-map" rather than a saturated block.
 */
export const NCR_OUTSIDE_MASK_COLOR = '#eef0f2';

/**
 * Fill opacity. FULLY OPAQUE (1.0): BahaRoute is scoped strictly to NCR, so
 * everything outside the 17 LGUs is completely hidden — surrounding provinces,
 * their roads, and their place labels (Antipolo, Bacoor, Imus, Cavite City,
 * San Pedro, …) must not be visible at all. The recognizable Manila Bay /
 * Laguna de Bay coastline is preserved because the NCR holes leave the
 * basemap's water/land edge that borders Metro Manila fully visible.
 */
export const NCR_OUTSIDE_MASK_OPACITY = 1;

/** A minimal Mapbox GL JS GeoJSON source spec (structural). */
export interface MaskSourceSpec {
  type: 'geojson';
  data: GeoJSON.Feature<GeoJSON.Polygon>;
}

/** A minimal Mapbox GL JS fill-layer spec (structural). */
export interface MaskFillLayerSpec {
  id: string;
  type: 'fill';
  source: string;
  paint: {
    'fill-color': string;
    'fill-opacity': number;
    'fill-antialias': boolean;
  };
}

/**
 * Builds the outside-NCR mask GeoJSON: one world polygon with one hole per NCR
 * city outer ring (MultiPolygon cities contribute one hole per part). Derived
 * from the existing 17-LGU boundaries.
 */
export function buildNcrOutsideMask(): GeoJSON.Feature<GeoJSON.Polygon> {
  return buildMetroManilaClipMask(metroManilaCityBoundaries);
}

/** The mask GeoJSON source spec. */
export function buildNcrOutsideMaskSource(): MaskSourceSpec {
  return { type: 'geojson', data: buildNcrOutsideMask() };
}

/** The mask fill-layer spec (light neutral, translucent, non-antialiased edge). */
export function buildNcrOutsideMaskLayer(
  sourceId: string = NCR_OUTSIDE_MASK_SOURCE_ID,
): MaskFillLayerSpec {
  return {
    id: NCR_OUTSIDE_MASK_LAYER_ID,
    type: 'fill',
    source: sourceId,
    paint: {
      'fill-color': NCR_OUTSIDE_MASK_COLOR,
      'fill-opacity': NCR_OUTSIDE_MASK_OPACITY,
      'fill-antialias': false,
    },
  };
}

/** The minimal map surface needed to install the mask (real map or a fake). */
export interface MaskMapAdapter {
  addSource(id: string, source: MaskSourceSpec): unknown;
  addLayer(layer: MaskFillLayerSpec, beforeId?: string): unknown;
  getLayer?(id: string): unknown;
}

/**
 * Installs the outside-NCR mask onto a map. Adds the source + a single fill
 * layer. The layer is added WITHOUT a slot/beforeId so it renders above the
 * basemap (including outside place labels, which it suppresses); BahaRoute's
 * NCR layers are added AFTER this and therefore render on top of the mask, so
 * the mask never covers any NCR content.
 *
 * Idempotent: a no-op if the layer already exists.
 *
 * @returns `true` when installed (or already present), `false` if the map lacks
 *   the required style APIs (e.g. a jsdom fake).
 */
export function installNcrOutsideMask(map: MaskMapAdapter): boolean {
  if (
    typeof map.addSource !== 'function' ||
    typeof map.addLayer !== 'function'
  ) {
    return false;
  }
  if (map.getLayer?.(NCR_OUTSIDE_MASK_LAYER_ID)) return true;
  map.addSource(NCR_OUTSIDE_MASK_SOURCE_ID, buildNcrOutsideMaskSource());
  map.addLayer(buildNcrOutsideMaskLayer(NCR_OUTSIDE_MASK_SOURCE_ID));
  return true;
}
