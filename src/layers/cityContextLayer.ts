// src/layers/cityContextLayer.ts
//
// BahaRoute's own Metro Manila City/LGU CONTEXT: a subtle boundary line layer
// and a dedicated city-name label layer. This is BASE geographic context —
// always available, independent of the Flood Risk / Reports / Closures /
// Historical thematic layers, and independent of the rainfall/risk pipeline.
//
// It renders the 17 real LGU boundaries (derived in `ncrCityContext.ts`) so
// city names stay readable even when Mapbox basemap labels collide or drop out.
//
// PERFORMANCE: one GeoJSON polygon source + one derived label point source,
// built once; one line layer + one symbol layer. No per-city DOM markers, no
// geometry rebuilds, no React state during map movement — Mapbox zoom
// expressions drive the visual hierarchy entirely on the GPU.

import {
  ncrCityContext,
  ncrCityInfos,
} from '../data/geojson/ncrCityContext';

/** Polygon source id (city boundaries). */
export const CITY_CONTEXT_SOURCE_ID = 'ncrCityContext';
/** Point source id (city label anchors). */
export const CITY_LABEL_SOURCE_ID = 'ncrCityLabels';
/** Boundary line layer id. */
export const CITY_BOUNDARY_LAYER_ID = 'ncrCityBoundary';
/** City label symbol layer id. */
export const CITY_LABEL_LAYER_ID = 'ncrCityLabel';

/**
 * Zoom ranges (documented for the hierarchy):
 *  - Boundaries: prominent at NCR overview (~z9–11), softening as you zoom into
 *    a city (~z13) so barangay boundaries take over deeper in (~z14+).
 *  - Labels: visible at overview through city zoom (~z9–14), fading out by
 *    street/barangay zoom (~z15) so they don't clutter navigation.
 */
export const CITY_BOUNDARY_ZOOM = { overview: 9, city: 13, barangay: 15 } as const;
export const CITY_LABEL_ZOOM = { min: 8.5, full: 10, fade: 14, hide: 15.5 } as const;

/** Minimal GeoJSON source spec (structural). */
export interface GeoJsonSourceSpec {
  type: 'geojson';
  data: GeoJSON.FeatureCollection;
}

/** A minimal Mapbox layer spec (structural, kept generic for tests). */
export interface CityLayerSpec {
  id: string;
  type: string;
  source: string;
  [key: string]: unknown;
}

/** Builds the city-boundary polygon source (line layer reads its outline). */
export function buildCityContextSource(): GeoJsonSourceSpec {
  return {
    type: 'geojson',
    data: ncrCityContext as unknown as GeoJSON.FeatureCollection,
  };
}

/** Builds the city-label point source from the precomputed label points. */
export function buildCityLabelSource(): GeoJsonSourceSpec {
  return {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: ncrCityInfos.map((c) => ({
        type: 'Feature',
        id: c.id,
        geometry: { type: 'Point', coordinates: [c.labelPoint[0], c.labelPoint[1]] },
        properties: { id: c.id, name: c.name, cityPsgc: c.cityPsgc },
      })),
    },
  };
}

/**
 * Builds the subtle city-boundary LINE layer. Zoom-based width/opacity make it
 * clearly visible at NCR overview, present-but-quieter at city zoom, and faint
 * by barangay zoom so it never competes with flood-risk colors or roads. A
 * neutral desaturated color keeps it out of the reserved flood palette.
 */
export function buildCityBoundaryLayer(
  sourceId: string = CITY_CONTEXT_SOURCE_ID,
): CityLayerSpec {
  const { overview, city, barangay } = CITY_BOUNDARY_ZOOM;
  return {
    id: CITY_BOUNDARY_LAYER_ID,
    type: 'line',
    source: sourceId,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#6b7280',
      // Stronger at overview, thinner as you zoom into barangays.
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        overview,
        1.6,
        city,
        1.1,
        barangay,
        0.6,
      ],
      'line-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        overview,
        0.7,
        city,
        0.5,
        barangay,
        0.3,
      ],
    },
  };
}

/**
 * Builds the city-NAME symbol layer. Restrained typography, a light halo for
 * legibility over the quiet basemap, and zoom-based opacity so names read at
 * overview/city zoom and fade out at street/barangay zoom. `symbol-sort-key`
 * plus collision handling avoids excessive overlap.
 */
export function buildCityLabelLayer(
  sourceId: string = CITY_LABEL_SOURCE_ID,
): CityLayerSpec {
  const { min, full, fade, hide } = CITY_LABEL_ZOOM;
  return {
    id: CITY_LABEL_LAYER_ID,
    type: 'symbol',
    source: sourceId,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.08,
      'text-size': ['interpolate', ['linear'], ['zoom'], min, 10, full, 12, fade, 13],
      'text-max-width': 8,
      'text-padding': 6,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
    },
    paint: {
      'text-color': '#374151',
      'text-halo-color': 'rgba(255,255,255,0.9)',
      'text-halo-width': 1.4,
      // Fade in at overview, fully visible through city zoom, gone by street zoom.
      'text-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        min,
        0,
        full,
        1,
        fade,
        1,
        hide,
        0,
      ],
    },
  };
}

/** The minimal map surface needed to install the city context (real or fake). */
export interface CityContextMapAdapter {
  addSource(id: string, source: GeoJsonSourceSpec): void;
  addLayer(layer: CityLayerSpec, beforeId?: string): void;
  getLayer?(id: string): unknown;
}

/** Result of installing the city context, for callers/tests. */
export interface InstalledCityContext {
  readonly boundarySourceId: string;
  readonly labelSourceId: string;
  readonly boundaryLayer: CityLayerSpec;
  readonly labelLayer: CityLayerSpec;
}

/**
 * Installs the city context onto a map: the boundary polygon + label point
 * sources, the boundary LINE layer (added low so thematic fills draw over it),
 * and the city-LABEL symbol layer (added on top so names stay readable). Both
 * layers are always-on base context — no LayerControl toggle.
 *
 * @param map - Minimal structural map surface (real map or a test fake).
 * @param beforeBoundaryId - Optional existing layer id to insert the boundary
 *   line beneath (e.g. the lowest thematic fill), so fills read on top of it.
 */
export function installCityContext(
  map: CityContextMapAdapter,
  beforeBoundaryId?: string,
): InstalledCityContext {
  map.addSource(CITY_CONTEXT_SOURCE_ID, buildCityContextSource());
  map.addSource(CITY_LABEL_SOURCE_ID, buildCityLabelSource());

  const boundaryLayer = buildCityBoundaryLayer(CITY_CONTEXT_SOURCE_ID);
  const labelLayer = buildCityLabelLayer(CITY_LABEL_SOURCE_ID);

  // Boundary sits low (under thematic fills when an anchor is provided); labels
  // go on top of everything so city names remain legible.
  const anchor =
    beforeBoundaryId && map.getLayer?.(beforeBoundaryId) !== undefined
      ? beforeBoundaryId
      : undefined;
  map.addLayer(boundaryLayer, anchor);
  map.addLayer(labelLayer);

  return {
    boundarySourceId: CITY_CONTEXT_SOURCE_ID,
    labelSourceId: CITY_LABEL_SOURCE_ID,
    boundaryLayer,
    labelLayer,
  };
}

// ---------------------------------------------------------------------------
// Future-ready per-city aggregation (structure only — NO city risk model).
// ---------------------------------------------------------------------------

/**
 * Groups a PSGC-keyed map of barangay values by their LGU, using the barangay
 * dataset's `cityPsgc`. This is the structural hook for a FUTURE city summary
 * (e.g. counting barangay current-risk levels per city). It fabricates nothing
 * — it only regroups values the caller already has. Not wired into any UI yet.
 *
 * @param barangayValues - PSGC(barangay) → value (e.g. a CurrentRiskLevel).
 * @param barangayCityPsgc - PSGC(barangay) → cityPsgc (from the barangay data).
 * @returns cityPsgc → array of the barangay values in that city.
 */
export function groupBarangayValuesByCity<T>(
  barangayValues: ReadonlyMap<string, T>,
  barangayCityPsgc: ReadonlyMap<string, string>,
): Map<string, T[]> {
  const byCity = new Map<string, T[]>();
  for (const [psgc, value] of barangayValues) {
    const cityPsgc = barangayCityPsgc.get(psgc);
    if (!cityPsgc) continue;
    const list = byCity.get(cityPsgc);
    if (list) list.push(value);
    else byCity.set(cityPsgc, [value]);
  }
  return byCity;
}
