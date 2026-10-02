// src/layers/barangayFloodRiskLayer.ts
//
// The PRIMARY current-conditions layer: NCR barangay polygons whose fill color
// reflects each barangay's CURRENT estimated flood risk. This is distinct from
// the historical Baseline Flood Susceptibility layers.
//
// PERFORMANCE (Req 11): the polygon SOURCE is built once from the local NCR
// GeoJSON. Live updates from the rainfall poll are applied via Mapbox
// FEATURE-STATE (`setFeatureState`), NOT by rebuilding the source — so a 5-min
// refresh repaints without re-uploading ~1,700 polygons. `promoteId` makes the
// barangay PSGC the feature id so feature-state keys on the stable PSGC code.
//
// The fill-color is data-driven off feature-state `risk`; a barangay with no
// computed state yet falls back to the LOW (calm) color. Opacity is kept
// translucent and fades with zoom so roads/labels stay readable underneath.

import { APP_LAYER_SLOT, LayerRegistry, type MapLayerSpec } from './LayerRegistry';
import { CURRENT_RISK_COLORS } from '../map/basemap/colorTokens';
import { ncrBarangays } from '../data/geojson/ncrBarangays';
import type { CurrentRiskLevel } from '../types/risk';

export type { MapLayerSpec };

/** The GeoJSON source id for the barangay polygons. */
export const BARANGAY_RISK_SOURCE_ID = 'barangayFloodRisk';

/** The fill layer id — matches the AppLayerId so the registry orders it. */
export const BARANGAY_RISK_FILL_LAYER_ID = 'barangayFloodRisk' as const;

/** The companion outline layer id. */
export const BARANGAY_RISK_OUTLINE_LAYER_ID = 'barangayFloodRisk-outline';

/** Feature-state key carrying the computed current-risk level per barangay. */
export const BARANGAY_RISK_STATE_KEY = 'risk';

/** Feature-state key marking the single selected barangay. */
export const BARANGAY_SELECTED_STATE_KEY = 'selected';

/** The selected-barangay highlight outline layer id. */
export const BARANGAY_SELECTED_LAYER_ID = 'barangayFloodRisk-selected';

/**
 * A data-driven fill-color expression keyed on the feature-state `risk`. When a
 * barangay has no state yet (first paint before the first successful poll) it
 * falls back to the calm LOW color. NEVER interpreted as "safe" — see
 * docs/FLOOD_SEMANTICS.md; the info panel and legend carry the framing.
 */
export function barangayRiskFillColorExpression(): unknown {
  const level = (l: CurrentRiskLevel): string => CURRENT_RISK_COLORS[l].hex;
  return [
    'match',
    ['feature-state', BARANGAY_RISK_STATE_KEY],
    'CONFIRMED_NOT_PASSABLE',
    level('CONFIRMED_NOT_PASSABLE'),
    'REPORTED_FLOODING',
    level('REPORTED_FLOODING'),
    'LIKELY_FLOODING',
    level('LIKELY_FLOODING'),
    'HIGH',
    level('HIGH'),
    'ELEVATED',
    level('ELEVATED'),
    'LOW',
    level('LOW'),
    'STALE',
    level('STALE'),
    'UNKNOWN',
    level('UNKNOWN'),
    // Fallback when no feature-state is set yet: treat as UNKNOWN (never LOW),
    // so unavailable data does not paint the whole map as a low-risk sheet.
    level('UNKNOWN'),
  ];
}

/**
 * Zoom-interpolated fill opacity, per-state. Classified severity levels get a
 * restrained 0.20–0.35 fill so the basemap roads/labels stay readable. The
 * data-quality states UNKNOWN/STALE are painted much fainter (near-transparent)
 * so unavailable/stale data reads as "no strong signal" rather than a solid
 * grey sheet — this is what removes the gray tessellated look.
 *
 * Implemented as: base per-zoom opacity for classified states, multiplied down
 * for UNKNOWN/STALE via a `case` on the feature-state.
 */
export function barangayRiskFillOpacityExpression(): unknown {
  // Restrained classified-state opacity, gently fading in as you zoom (small
  // barangays at high zoom need less fill to read).
  const classifiedOpacity = [
    'interpolate',
    ['linear'],
    ['zoom'],
    9,
    0.35,
    12,
    0.3,
    15,
    0.24,
    17,
    0.2,
  ];
  const state = ['feature-state', BARANGAY_RISK_STATE_KEY];
  return [
    'case',
    ['==', state, 'UNKNOWN'],
    0.06,
    // No state yet also reads as unavailable → very faint.
    ['==', state, null],
    0.06,
    ['==', state, 'STALE'],
    0.12,
    classifiedOpacity,
  ];
}

/**
 * A DIMMED variant of the current-risk fill opacity, used PURELY for visual
 * co-existence when BOTH the current and historical layers are enabled and the
 * user is focused on the Historical tab. The current (green→red) fill recedes
 * to a faint overlay so it does not stack with the historical (indigo/violet)
 * fill into a muddy double-fill. Paint-only — no data/feature-state change.
 * Classified levels keep a small floor so no polygon becomes invisible.
 */
export function barangayRiskFillOpacityDimmedExpression(): unknown {
  const state = ['feature-state', BARANGAY_RISK_STATE_KEY];
  return [
    'case',
    ['==', state, 'UNKNOWN'],
    0.04,
    ['==', state, null],
    0.04,
    ['==', state, 'STALE'],
    0.06,
    0.12,
  ];
}

/** The Mapbox GL JS GeoJSON source spec (structural). */
export interface BarangayRiskSourceSpec {
  type: 'geojson';
  data: GeoJSON.FeatureCollection;
  /** Promotes `psgc` to the feature id so feature-state keys on PSGC. */
  promoteId: string;
}

/** Builds the barangay polygon source with PSGC promoted to the feature id. */
export function buildBarangayRiskSource(): BarangayRiskSourceSpec {
  return {
    type: 'geojson',
    data: ncrBarangays as unknown as GeoJSON.FeatureCollection,
    promoteId: 'psgc',
  };
}

/** The fill layer spec. */
export interface BarangayRiskFillLayerSpec extends MapLayerSpec {
  id: typeof BARANGAY_RISK_FILL_LAYER_ID;
  type: 'fill';
  source: string;
  paint: {
    'fill-color': unknown;
    'fill-opacity': unknown;
  };
}

/** The outline layer spec. */
export interface BarangayRiskOutlineLayerSpec extends MapLayerSpec {
  id: typeof BARANGAY_RISK_OUTLINE_LAYER_ID;
  type: 'line';
  source: string;
  paint: {
    'line-color': string;
    'line-width': unknown;
    'line-opacity': unknown;
  };
}

/** Builds the barangay risk FILL layer (data-driven by feature-state). */
export function buildBarangayRiskFillLayer(
  sourceId: string = BARANGAY_RISK_SOURCE_ID,
): BarangayRiskFillLayerSpec {
  return {
    id: BARANGAY_RISK_FILL_LAYER_ID,
    type: 'fill',
    slot: APP_LAYER_SLOT,
    source: sourceId,
    paint: {
      'fill-color': barangayRiskFillColorExpression(),
      'fill-opacity': barangayRiskFillOpacityExpression(),
    },
  };
}

/** Builds the subtle barangay outline so boundaries read at higher zoom. */
export function buildBarangayRiskOutlineLayer(
  sourceId: string = BARANGAY_RISK_SOURCE_ID,
): BarangayRiskOutlineLayerSpec {
  return {
    id: BARANGAY_RISK_OUTLINE_LAYER_ID,
    type: 'line',
    slot: APP_LAYER_SLOT,
    source: sourceId,
    paint: {
      // A soft neutral hairline. Crucially it is INVISIBLE at overview zoom —
      // at NCR overview ~1,700 shared borders would otherwise read as a dense
      // grey mesh (the reported "triangular artifacts"). It fades in only as
      // the user zooms into individual barangays, where a boundary is useful.
      'line-color': '#8a9299',
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.2, 14, 0.5, 16, 0.8],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0, 13, 0.25, 16, 0.5],
    },
  };
}

/**
 * Builds the SELECTED-barangay highlight outline. It is a line layer whose
 * opacity/width are driven by the `selected` feature-state, so exactly one
 * barangay reads with a stronger (but restrained — no glow) outline. Non-
 * selected features render it fully transparent, so it costs nothing visually
 * until a selection exists.
 */
export function buildBarangaySelectedLayer(
  sourceId: string = BARANGAY_RISK_SOURCE_ID,
): MapLayerSpec {
  const selected = ['boolean', ['feature-state', BARANGAY_SELECTED_STATE_KEY], false];
  return {
    id: BARANGAY_SELECTED_LAYER_ID,
    type: 'line',
    slot: APP_LAYER_SLOT,
    source: sourceId,
    paint: {
      'line-color': '#1f2933',
      'line-width': ['case', selected, 2.4, 0],
      'line-opacity': ['case', selected, 0.9, 0],
    },
  };
}

/** The minimal map surface needed to install the layer (real map or fake). */
export interface BarangayRiskMapAdapter {
  addSource(id: string, source: BarangayRiskSourceSpec): void;
  addLayer(layer: MapLayerSpec, beforeId?: string): void;
}

/** Result of installing the barangay risk layer, exposed for callers/tests. */
export interface InstalledBarangayRisk {
  readonly sourceId: string;
  readonly fillLayer: BarangayRiskFillLayerSpec;
  readonly outlineLayer: BarangayRiskOutlineLayerSpec;
}

/**
 * Installs the barangay-risk source + fill (registered through the registry at
 * its fixed z-position) + outline (added directly on top of the fill).
 *
 * The fill is the app-managed layer positioned by the {@link LayerRegistry};
 * the outline shares the source and sits just above the fill.
 */
export function installBarangayFloodRisk(
  map: BarangayRiskMapAdapter,
  registry: LayerRegistry,
): InstalledBarangayRisk {
  const source = buildBarangayRiskSource();
  map.addSource(BARANGAY_RISK_SOURCE_ID, source);

  const fillLayer = buildBarangayRiskFillLayer(BARANGAY_RISK_SOURCE_ID);
  const outlineLayer = buildBarangayRiskOutlineLayer(BARANGAY_RISK_SOURCE_ID);

  registry.addAppLayer(fillLayer);
  map.addLayer(outlineLayer);
  // The selection highlight sits directly above the fill/outline so the
  // selected barangay's stronger boundary reads clearly.
  map.addLayer(buildBarangaySelectedLayer(BARANGAY_RISK_SOURCE_ID));

  return {
    sourceId: BARANGAY_RISK_SOURCE_ID,
    fillLayer,
    outlineLayer,
  };
}

/** The minimal map surface for applying per-barangay risk via feature-state. */
export interface FeatureStateMap {
  setFeatureState(
    target: { source: string; id: string | number },
    state: Record<string, unknown>,
  ): void;
  removeFeatureState?(
    target: { source: string; id?: string | number },
    key?: string,
  ): void;
}

/**
 * Marks a single barangay as selected via feature-state, clearing any prior
 * selection. Pass `null` to clear the selection entirely. Guarded so a missing
 * `setFeatureState` (fake maps) is a safe no-op.
 *
 * @param map - A map exposing feature-state.
 * @param psgc - The barangay to select, or `null` to clear.
 * @param previousPsgc - The previously selected barangay to unset (if any).
 */
export function setSelectedBarangay(
  map: FeatureStateMap | null | undefined,
  psgc: string | null,
  previousPsgc: string | null,
): void {
  if (!map || typeof map.setFeatureState !== 'function') return;
  try {
    if (previousPsgc && previousPsgc !== psgc) {
      map.setFeatureState(
        { source: BARANGAY_RISK_SOURCE_ID, id: previousPsgc },
        { [BARANGAY_SELECTED_STATE_KEY]: false },
      );
    }
    if (psgc) {
      map.setFeatureState(
        { source: BARANGAY_RISK_SOURCE_ID, id: psgc },
        { [BARANGAY_SELECTED_STATE_KEY]: true },
      );
    }
  } catch {
    // A bad id must never break selection handling.
  }
}

/**
 * Applies computed risk levels to the barangay polygons via feature-state, so
 * the fill repaints WITHOUT rebuilding the source. Only barangays whose level
 * changed need updating, but applying all is cheap and idempotent. Guarded so a
 * missing `setFeatureState` (fake maps) is a safe no-op.
 *
 * @param map - A map exposing `setFeatureState`.
 * @param riskByBarangay - PSGC → current risk level.
 */
export function applyBarangayRiskStates(
  map: FeatureStateMap | null | undefined,
  riskByBarangay: ReadonlyMap<string, CurrentRiskLevel>,
): void {
  if (!map || typeof map.setFeatureState !== 'function') return;
  for (const [psgc, risk] of riskByBarangay) {
    try {
      map.setFeatureState(
        { source: BARANGAY_RISK_SOURCE_ID, id: psgc },
        { [BARANGAY_RISK_STATE_KEY]: risk },
      );
    } catch {
      // A single bad id must never break the whole update pass.
    }
  }
}
