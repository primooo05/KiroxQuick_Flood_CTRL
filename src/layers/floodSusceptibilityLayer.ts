/// <reference types="geojson" />
// src/layers/floodSusceptibilityLayer.ts
//
// Builds the MapLibre layer definition(s) that render Metro Manila's flood
// SUSCEPTIBILITY as translucent, color-coded, zoom-faded AREA POLYGONS over the
// quiet BahaRoute basemap (design → "Flood Map Visual Concept"; Req 12.2, 2.1,
// 11.4).
//
// Design intent encoded here:
//   - Susceptibility is drawn as a translucent `fill` (never fully opaque) so
//     roads/waterways/labels/boundaries stay visible underneath (Visual Concept
//     → "flood-risk map over a readable navigation basemap").
//   - `fill-color` is data-driven by the feature `level` property (HIGH →
//     translucent red, MODERATE → orange, LOW → yellow) using the reserved
//     SUSCEPTIBILITY_COLORS palette (Req 2.2, 13.1).
//   - `fill-opacity` uses the shared zoom-interpolated expression from Task 4.9
//     so polygons are prominent at overview zoom (~z10) and de-emphasized at
//     street level (~z15–17), and are ALWAYS translucent (Req 2.1, 12.2).
//   - A companion `line` (outline) layer provides a NON-COLOR cue: the outline
//     dash pattern differs per level (dense/medium/light), so susceptibility is
//     not conveyed by color alone (Req 11.4).
//   - Susceptibility is an AREA POLYGON treatment — distinct from reports, which
//     render as symbols/segments (design → "Historical susceptibility stays
//     visually distinct"; visualTreatment → 'polygon-fill').
//
// The layer is registered via LayerRegistry at the fixed `floodSusceptibility`
// z-position (above the basemap, below reports/routes/segments). This module
// only produces DATA (source + layer specs) and drives a minimal map adapter,
// so it is fully testable with a fake adapter — no real WebGL map required
// (test env is jsdom). The click/tap popup is Task 10.2 and is NOT built here.

import type { DataLayer } from '../types/layer';
import type { FloodSusceptibility, SusceptibilityLevel } from '../types/flood';
import {
  SUSCEPTIBILITY_COLORS,
  type ColorToken,
} from '../map/basemap/colorTokens';
import {
  susceptibilityFillOpacityExpression,
  type ZoomInterpolateExpression,
} from './zoomOpacity';
import { visualTreatment } from './visualMapping';
import { APP_LAYER_SLOT, LayerRegistry, type MapLayerSpec } from './LayerRegistry';

// Re-exported so consumers/tests can type-check layer specs against the same
// structural shape the registry uses.
export type { MapLayerSpec };
import { floodSusceptibilityLayer as floodSusceptibilityDataLayer } from './dataLayers';

/**
 * The MapLibre source id for the susceptibility GeoJSON. Kept identical to the
 * layer id so the source and layer are easy to correlate in the style.
 */
export const SUSCEPTIBILITY_SOURCE_ID = 'floodSusceptibility';

/**
 * The fill layer id. Matches the {@link AppLayerId} `floodSusceptibility` so
 * {@link LayerRegistry} places it at its fixed z-position (above the basemap,
 * below reports/routes/segments).
 */
export const SUSCEPTIBILITY_FILL_LAYER_ID = 'floodSusceptibility' as const;

/**
 * The companion outline layer id. Provides the non-color cue (per-level dash
 * pattern). It is drawn immediately with the fill via the same registry slot.
 */
export const SUSCEPTIBILITY_OUTLINE_LAYER_ID = 'floodSusceptibility-outline';

/**
 * A MapLibre `["match", ["get","level"], ...]` data-driven expression as a
 * readonly tuple. Kept structurally typed (rather than importing MapLibre's
 * internal style-spec types) so it can be asserted directly in tests.
 */
export type LevelMatchExpression = readonly [
  'match',
  readonly ['get', 'level'],
  ...unknown[],
];

/** The fallback color used when a feature's `level` is missing/unknown. */
const FALLBACK_FILL_HEX = SUSCEPTIBILITY_COLORS.LOW.hex;

/**
 * Per-level outline dash arrays — the NON-COLOR cue (Req 11.4). Denser dashing
 * encodes higher susceptibility, mirroring the hatch density in
 * `visualMapping.susceptibilityPattern`. Values are `[dash, gap]` in line-width
 * units.
 */
export const SUSCEPTIBILITY_OUTLINE_DASHARRAYS: Record<
  SusceptibilityLevel,
  readonly number[]
> = {
  HIGH: [1, 0.5], // dense
  MODERATE: [2, 1], // medium
  LOW: [1, 2], // light / sparse
} as const;

/**
 * Builds the data-driven `fill-color` expression mapping the feature `level`
 * property to the reserved translucent SUSCEPTIBILITY_COLORS: HIGH → red,
 * MODERATE → orange, LOW → yellow, with a LOW-colored fallback (Req 2.2, 13.1).
 *
 * @returns e.g. `["match", ["get","level"], "HIGH", "#d32f2f", "MODERATE",
 *   "#f57c00", "LOW", "#fbc02d", "#fbc02d"]`.
 */
export function susceptibilityFillColorExpression(): LevelMatchExpression {
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

/**
 * Builds the data-driven `line-dasharray` expression for the outline layer,
 * providing the per-level non-color cue (Req 11.4). Falls back to the LOW
 * (sparse) dash pattern for unknown levels.
 */
export function susceptibilityOutlineDashExpression(): LevelMatchExpression {
  return [
    'match',
    ['get', 'level'],
    'HIGH',
    SUSCEPTIBILITY_OUTLINE_DASHARRAYS.HIGH,
    'MODERATE',
    SUSCEPTIBILITY_OUTLINE_DASHARRAYS.MODERATE,
    'LOW',
    SUSCEPTIBILITY_OUTLINE_DASHARRAYS.LOW,
    SUSCEPTIBILITY_OUTLINE_DASHARRAYS.LOW,
  ] as const;
}

/**
 * The translucent susceptibility FILL layer spec. `type: 'fill'` keeps it an
 * area-polygon treatment (distinct from report symbols/segments), the fill
 * color is data-driven by `level`, and `fill-opacity` is the shared
 * zoom-interpolated expression (translucent + zoom-faded) (Req 12.2, 2.1).
 */
export interface SusceptibilityFillLayerSpec extends MapLayerSpec {
  id: typeof SUSCEPTIBILITY_FILL_LAYER_ID;
  type: 'fill';
  source: string;
  paint: {
    'fill-color': LevelMatchExpression;
    'fill-opacity': ZoomInterpolateExpression;
  };
}

/** The companion outline layer spec carrying the per-level non-color cue. */
export interface SusceptibilityOutlineLayerSpec extends MapLayerSpec {
  id: typeof SUSCEPTIBILITY_OUTLINE_LAYER_ID;
  type: 'line';
  source: string;
  paint: {
    'line-color': LevelMatchExpression;
    'line-dasharray': LevelMatchExpression;
    'line-width': number;
    'line-opacity': number;
  };
}

/**
 * Builds the translucent, zoom-faded susceptibility FILL layer definition.
 *
 * The layer is an area-polygon `fill` (never a symbol/segment), colored by the
 * feature `level` via the reserved palette, and made translucent + zoom-faded
 * by the shared opacity expression so base features remain visible underneath
 * (design → Flood Map Visual Concept; Req 12.2, 2.1).
 *
 * @param sourceId - The GeoJSON source id to read features from. Defaults to
 *   {@link SUSCEPTIBILITY_SOURCE_ID}.
 */
export function buildSusceptibilityFillLayer(
  sourceId: string = SUSCEPTIBILITY_SOURCE_ID,
): SusceptibilityFillLayerSpec {
  return {
    id: SUSCEPTIBILITY_FILL_LAYER_ID,
    type: 'fill',
    slot: APP_LAYER_SLOT,
    source: sourceId,
    paint: {
      'fill-color': susceptibilityFillColorExpression(),
      'fill-opacity': susceptibilityFillOpacityExpression(),
    },
  };
}

/**
 * Builds the companion outline layer that provides the NON-COLOR cue: a
 * per-level `line-dasharray` (dense → HIGH, medium → MODERATE, light → LOW) so
 * susceptibility is perceivable without relying on color alone (Req 11.4). The
 * outline is kept subtle (thin, semi-transparent) so it does not obscure base
 * features underneath.
 *
 * @param sourceId - The GeoJSON source id (same as the fill). Defaults to
 *   {@link SUSCEPTIBILITY_SOURCE_ID}.
 */
export function buildSusceptibilityOutlineLayer(
  sourceId: string = SUSCEPTIBILITY_SOURCE_ID,
): SusceptibilityOutlineLayerSpec {
  return {
    id: SUSCEPTIBILITY_OUTLINE_LAYER_ID,
    type: 'line',
    slot: APP_LAYER_SLOT,
    source: sourceId,
    paint: {
      'line-color': susceptibilityFillColorExpression(),
      'line-dasharray': susceptibilityOutlineDashExpression(),
      'line-width': 1.25,
      'line-opacity': 0.7,
    },
  };
}

/**
 * The reserved color token for a susceptibility level, re-exported for the
 * legend/popup (Task 10.2) so they can render the same color + non-color cue.
 */
export function susceptibilityLevelColor(level: SusceptibilityLevel): ColorToken {
  return SUSCEPTIBILITY_COLORS[level];
}

/**
 * A minimal MapLibre map surface needed to install the source and the outline
 * layer. Kept structural so a fake can be injected in tests (no real WebGL map
 * needed). The FILL layer is added through the {@link LayerRegistry}; the
 * outline is added directly here, anchored above the fill.
 */
export interface SusceptibilityMapAdapter {
  /** Adds a GeoJSON source under the given id. */
  addSource(id: string, source: unknown): void;
  /**
   * Adds a layer. When `beforeId` is provided the layer is inserted BELOW that
   * layer, matching MapLibre's `addLayer(layer, beforeId)` semantics. Omitting
   * `beforeId` appends the layer on top.
   */
  addLayer(layer: MapLayerSpec, beforeId?: string): void;
}

/** A MapLibre GeoJSON source object (`{ type: 'geojson', data }`). */
export interface GeoJsonSourceSpec {
  type: 'geojson';
  data: GeoJSON.FeatureCollection;
}

/**
 * Builds the MapLibre GeoJSON SOURCE object from the demo susceptibility
 * fixtures via the DataLayer's `load()` + `toGeoJSON()`. Every projected
 * feature carries `level`, `source`, and `updatedAt` in its properties (from
 * `dataLayers`), so the popup/legend and tests can read them.
 *
 * Malformed fixtures are skipped by `load()` and never throw; an empty layer
 * yields a well-formed empty FeatureCollection (Req 18.2, 18.3).
 *
 * @param layer - The susceptibility DataLayer. Defaults to the fixture-backed
 *   {@link floodSusceptibilityDataLayer}.
 */
export async function buildSusceptibilitySource(
  layer: DataLayer<FloodSusceptibility> = floodSusceptibilityDataLayer,
): Promise<GeoJsonSourceSpec> {
  const { items } = await layer.load();
  const data = layer.toGeoJSON(items);
  return { type: 'geojson', data };
}

/** Result of installing the susceptibility layer, exposed for callers/tests. */
export interface InstalledSusceptibility {
  readonly sourceId: string;
  readonly fillLayer: SusceptibilityFillLayerSpec;
  readonly outlineLayer: SusceptibilityOutlineLayerSpec;
  readonly source: GeoJsonSourceSpec;
}

/**
 * Installs the susceptibility source + translucent fill (and its non-color
 * outline cue) onto a map, registering the fill at its fixed z-position through
 * the {@link LayerRegistry} so it lands above the basemap and below
 * reports/routes/segments (design → z-order; Req 9.1, 9.4).
 *
 * The map only needs `addSource` (for the GeoJSON source); the layer insertion
 * goes through the injected registry, which itself wraps a minimal map adapter.
 * This keeps the whole path testable with fakes — no real WebGL map required.
 *
 * @param map - Minimal adapter exposing `addSource` and `addLayer`.
 * @param registry - The LayerRegistry that owns z-order for app layers.
 * @param layer - The susceptibility DataLayer (defaults to the fixture layer).
 * @returns The built source id and layer specs for inspection.
 */
export async function installFloodSusceptibility(
  map: SusceptibilityMapAdapter,
  registry: LayerRegistry,
  layer: DataLayer<FloodSusceptibility> = floodSusceptibilityDataLayer,
): Promise<InstalledSusceptibility> {
  const source = await buildSusceptibilitySource(layer);
  map.addSource(SUSCEPTIBILITY_SOURCE_ID, source);

  const fillLayer = buildSusceptibilityFillLayer(SUSCEPTIBILITY_SOURCE_ID);
  const outlineLayer = buildSusceptibilityOutlineLayer(SUSCEPTIBILITY_SOURCE_ID);

  // The fill is the fixed app-managed layer; the registry positions it above
  // the basemap and below reports/routes/segments. The outline shares the same
  // source and is added directly on top of the fill (no beforeId) so its
  // per-level dash cue sits over the translucent area. It is intentionally not
  // an app-managed z-order slot — it is a companion of the fill.
  registry.addAppLayer(fillLayer);
  map.addLayer(outlineLayer);

  return {
    sourceId: SUSCEPTIBILITY_SOURCE_ID,
    fillLayer,
    outlineLayer,
    source,
  };
}

/**
 * A guard used by tests/consumers to confirm susceptibility is rendered as an
 * AREA POLYGON treatment (fill), keeping it distinct from report symbols/
 * segments (design → "Historical susceptibility stays visually distinct").
 */
export function susceptibilityIsAreaPolygon(): boolean {
  return visualTreatment('SUSCEPTIBILITY') === 'polygon-fill';
}
