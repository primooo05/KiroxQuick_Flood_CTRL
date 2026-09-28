/// <reference types="geojson" />
// src/map/metroManilaClipMask.ts
//
// Builds the "outside Metro Manila" mask used by a Mapbox `clip` layer so the
// Standard style's 3D buildings/trees render ONLY inside the 17 NCR cities.
//
// The mask is one world-sized polygon whose holes are the outer rings of every
// NCR city boundary. A clip layer removes 3D content inside the mask, i.e.
// everywhere except the holes. Pure and engine-free, so it is unit-testable.

import type { CityBoundaryCollection } from '../data/geojson/metroManilaCityBoundaries';

/** Source + layer id for the NCR-only 3D clip. */
export const NCR_CLIP_SOURCE_ID = 'ncr-3d-clip-mask';
export const NCR_CLIP_LAYER_ID = 'ncr-3d-clip';

/** World outer ring (Web Mercator latitude limits), counter-clockwise. */
const WORLD_RING: GeoJSON.Position[] = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
];

/**
 * Returns a single Polygon covering the world with one hole per NCR city
 * polygon (MultiPolygon cities contribute one hole per part).
 */
export function buildMetroManilaClipMask(
  boundaries: CityBoundaryCollection,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const holes: GeoJSON.Position[][] = [];
  for (const feature of boundaries.features) {
    const geometry = feature.geometry;
    const polygons =
      geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) {
      // Only the outer ring matters: the hole is the city's footprint.
      if (polygon[0]) holes.push(polygon[0]);
    }
  }

  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [WORLD_RING, ...holes] },
  };
}
