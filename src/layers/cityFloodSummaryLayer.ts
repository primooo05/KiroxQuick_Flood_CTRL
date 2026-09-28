/// <reference types="geojson" />
// src/layers/cityFloodSummaryLayer.ts
//
// Builds the Mapbox GL JS layer definition(s) that render the per-city, MODELED
// flood-SUSCEPTIBILITY SUMMARY as a translucent, color-coded fill over the quiet
// BahaRoute basemap — reproducing the NCR overview COMPOSITION (a filled,
// color-coded 17-city silhouette with Metro Manila dominant).
//
// Semantics (must hold — this is the whole point):
//   - The per-city fill is a HISTORICAL / MODELED susceptibility SUMMARY, NOT
//     current flooding. It is explicitly labeled modeled/historical exposure and
//     never implies "safe"/"passable". Absence of a fill never reads as "safe".
//   - It is DISTINCT from current/recent conditions (reports/segments/markers)
//     and from the hazard-shaped `floodSusceptibility` polygons. This layer is
//     an ADMINISTRATIVE, per-city summary VALUE — allowed because the value is
//     per-city susceptibility, clearly labeled, not a hazard footprint.
//   - `fill-color` is data-driven by the feature `level` property using the
//     reserved SUSCEPTIBILITY_COLORS palette: HIGH → red, MODERATE → orange,
//     LOW → yellow. NO GREEN (green is a current-condition state).
//   - `fill-opacity` is a fixed, translucent value so the basemap roads/labels
//     stay readable underneath. A subtle companion outline makes the city
//     silhouette read.
//
// The fill is registered via LayerRegistry at the fixed `cityFloodSummary`
// z-position: the LOWEST app layer — just above the basemap and BELOW the
// hazard-shaped `floodSusceptibility` polygons and all reports/routes.
//
// This module only produces DATA (source + layer specs) and drives a minimal
// map adapter, so it is fully testable with a fake adapter — no real WebGL map
// required (test env is jsdom). The click/tap popup wiring lives in
// `cityFloodSummaryPopup.ts`.

import type { DataLayer } from '../types/layer';
import type { SusceptibilityLevel } from '../types/flood';
import type { CitySusceptibilitySummary } from '../data/fixtures/cityFloodSusceptibility';
import {
  SUSCEPTIBILITY_COLORS,
  type ColorToken,
} from '../map/basemap/colorTokens';
import { APP_LAYER_SLOT, LayerRegistry, type MapLayerSpec } from './LayerRegistry';
import { cityFloodSummaryLayer as cityFloodSummaryDataLayer } from './dataLayers';

// Re-exported so consumers/tests can type-check layer specs against the same
// structural shape the registry uses.
export type { MapLayerSpec };

/** The Mapbox GL JS source id for the city-summary GeoJSON. */
export const CITY_SUMMARY_SOURCE_ID = 'cityFloodSummary';

/**
 * The fill layer id. Matches the {@link AppLayerId} `cityFloodSummary` so
 * {@link LayerRegistry} places it at its fixed z-position (the LOWEST app layer,
 * above the basemap and below the hazard susceptibility polygons/reports).
 */
export const CITY_SUMMARY_FILL_LAYER_ID = 'cityFloodSummary' as const;

/** The companion outline layer id (subtle city silhouette). */
export const CITY_SUMMARY_OUTLINE_LAYER_ID = 'cityFloodSummary-outline';

/**
 * The fixed, translucent fill opacity for the city summary. Kept below 1 so the
 * basemap roads/labels remain readable underneath, and modest so the more
 * detailed hazard-shaped susceptibility polygons above it still read clearly.
 */
export const CITY_SUMMARY_FILL_OPACITY = 0.3;

/**
 * A Mapbox GL JS `["match", ["get","level"], ...]` data-driven expression as a
 * readonly tuple. Kept structurally typed so it can be asserted in tests.
 */
export type LevelMatchExpression = readonly [
  'match',
  readonly ['get', 'level'],
  ...unknown[],
];

/** The fallback color used when a feature's `level` is missing/unknown. */
const FALLBACK_FILL_HEX = SUSCEPTIBILITY_COLORS.LOW.hex;

/**
 * Builds the data-driven `fill-color` expression mapping the feature `level`
 * property to the reserved SUSCEPTIBILITY_COLORS: HIGH → red, MODERATE →
 * orange, LOW → yellow, with a LOW-colored fallback. NO GREEN.
 */
export function citySummaryFillColorExpression(): LevelMatchExpression {
  return [
    'match',
    ['get', 'level'],
    'HIGH',
    SUSCEPTIBILITY_COLORS.HIGH.hex,
    'MODERATE',
    SUSCEPTIBILITY_COLORS.MODERATE.hex,
    'LOW',
    SUSCEPTIBILITY_COLORS.LOW.hex,
    FALLBACK_FILL_HEX,
  ] as const;
}

/** The translucent per-city summary FILL layer spec. */
export interface CitySummaryFillLayerSpec extends MapLayerSpec {
  id: typeof CITY_SUMMARY_FILL_LAYER_ID;
  type: 'fill';
  source: string;
  paint: {
    'fill-color': LevelMatchExpression;
    'fill-opacity': number;
  };
}

/** The companion outline layer spec (subtle city silhouette). */
export interface CitySummaryOutlineLayerSpec extends MapLayerSpec {
  id: typeof CITY_SUMMARY_OUTLINE_LAYER_ID;
  type: 'line';
  source: string;
  paint: {
    'line-color': LevelMatchExpression;
    'line-width': number;
    'line-opacity': number;
  };
}

/**
 * Builds the translucent per-city summary FILL layer. The layer is an
 * area-polygon `fill`, colored by the feature `level` via the reserved palette,
 * with a fixed translucent opacity so the basemap stays readable underneath.
 *
 * @param sourceId - The GeoJSON source id. Defaults to
 *   {@link CITY_SUMMARY_SOURCE_ID}.
 */
export function buildCitySummaryFillLayer(
  sourceId: string = CITY_SUMMARY_SOURCE_ID,
): CitySummaryFillLayerSpec {
  return {
    id: CITY_SUMMARY_FILL_LAYER_ID,
    type: 'fill',
    slot: APP_LAYER_SLOT,
    source: sourceId,
    paint: {
      'fill-color': citySummaryFillColorExpression(),
      'fill-opacity': CITY_SUMMARY_FILL_OPACITY,
    },
  };
}

/**
 * Builds the companion outline layer that makes the city silhouette read. Kept
 * subtle (thin, semi-transparent) so it does not obscure base features. The
 * outline is colored by the same per-level palette as the fill.
 *
 * @param sourceId - The GeoJSON source id (same as the fill). Defaults to
 *   {@link CITY_SUMMARY_SOURCE_ID}.
 */
export function buildCitySummaryOutlineLayer(
  sourceId: string = CITY_SUMMARY_SOURCE_ID,
): CitySummaryOutlineLayerSpec {
  return {
    id: CITY_SUMMARY_OUTLINE_LAYER_ID,
    type: 'line',
    slot: APP_LAYER_SLOT,
    source: sourceId,
    paint: {
      'line-color': citySummaryFillColorExpression(),
      'line-width': 1,
      'line-opacity': 0.5,
    },
  };
}

/**
 * The reserved color token for a susceptibility level, re-exported for the
 * legend/popup so they render the same color.
 */
export function citySummaryLevelColor(level: SusceptibilityLevel): ColorToken {
  return SUSCEPTIBILITY_COLORS[level];
}

/**
 * A minimal Mapbox GL JS map surface needed to install the source and the
 * outline layer. Kept structural so a fake can be injected in tests.
 */
export interface CitySummaryMapAdapter {
  /** Adds a GeoJSON source under the given id. */
  addSource(id: string, source: unknown): void;
  /**
   * Adds a layer. When `beforeId` is provided the layer is inserted BELOW that
   * layer, matching Mapbox GL JS's `addLayer(layer, beforeId)` semantics.
   */
  addLayer(layer: MapLayerSpec, beforeId?: string): void;
}

/** A Mapbox GL JS GeoJSON source object (`{ type: 'geojson', data }`). */
export interface GeoJsonSourceSpec {
  type: 'geojson';
  data: GeoJSON.FeatureCollection;
}

/**
 * Builds the Mapbox GL JS GeoJSON SOURCE object from the demo city-summary
 * fixtures via the DataLayer's `load()` + `toGeoJSON()`. Every projected
 * feature carries `level`, `name`/`cityName`, `source`, and `updatedAt`, so the
 * popup/legend and tests can read them. Malformed fixtures are skipped by
 * `load()` and never throw; an empty layer yields an empty FeatureCollection.
 *
 * @param layer - The city-summary DataLayer. Defaults to the fixture-backed one.
 */
export async function buildCitySummarySource(
  layer: DataLayer<CitySusceptibilitySummary> = cityFloodSummaryDataLayer,
): Promise<GeoJsonSourceSpec> {
  const { items } = await layer.load();
  const data = layer.toGeoJSON(items);
  return { type: 'geojson', data };
}

/** Result of installing the city-summary layer, exposed for callers/tests. */
export interface InstalledCitySummary {
  readonly sourceId: string;
  readonly fillLayer: CitySummaryFillLayerSpec;
  readonly outlineLayer: CitySummaryOutlineLayerSpec;
  readonly source: GeoJsonSourceSpec;
}

/**
 * Installs the city-summary source + translucent fill (and its subtle outline)
 * onto a map, registering the fill at its fixed z-position through the
 * {@link LayerRegistry} so it lands as the LOWEST app layer — above the basemap
 * and below the hazard-shaped susceptibility polygons and all reports/routes.
 *
 * The map only needs `addSource` (for the GeoJSON source); the fill insertion
 * goes through the injected registry. The outline shares the same source and is
 * added directly on top of the fill. This keeps the whole path testable with
 * fakes — no real WebGL map required.
 *
 * @param map - Minimal adapter exposing `addSource` and `addLayer`.
 * @param registry - The LayerRegistry that owns z-order for app layers.
 * @param layer - The city-summary DataLayer (defaults to the fixture layer).
 * @returns The built source id and layer specs for inspection.
 */
export async function installCityFloodSummary(
  map: CitySummaryMapAdapter,
  registry: LayerRegistry,
  layer: DataLayer<CitySusceptibilitySummary> = cityFloodSummaryDataLayer,
): Promise<InstalledCitySummary> {
  const source = await buildCitySummarySource(layer);
  map.addSource(CITY_SUMMARY_SOURCE_ID, source);

  const fillLayer = buildCitySummaryFillLayer(CITY_SUMMARY_SOURCE_ID);
  const outlineLayer = buildCitySummaryOutlineLayer(CITY_SUMMARY_SOURCE_ID);

  // The fill is the fixed app-managed layer; the registry positions it as the
  // lowest app layer (above the basemap, below hazard susceptibility). The
  // outline shares the same source and is added directly on top of the fill.
  registry.addAppLayer(fillLayer);
  map.addLayer(outlineLayer);

  return {
    sourceId: CITY_SUMMARY_SOURCE_ID,
    fillLayer,
    outlineLayer,
    source,
  };
}
