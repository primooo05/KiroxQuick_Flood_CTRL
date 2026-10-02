// src/layers/historicalFloodRisk.ts
//
// PURE logic + Mapbox layer specs for the HISTORICAL Flood Risk layer: NCR
// barangay polygons colored by their DERIVED historical susceptibility class
// (Low/Moderate/High/Unknown) from the Project NOAH / Phil-LiDAR dataset.
//
// This layer is INDEPENDENT of the current-risk layer:
//   - separate GeoJSON source + fill layer + feature-state key ('histRisk'),
//   - a distinct INDIGO/VIOLET color ramp (current risk is a green→red ramp),
//   - painted from a STATIC preprocessed dataset (no live API calls),
//   - a barangay may be historically High while currently Low, and vice versa;
//     the two are never merged (see docs/FLOOD_SEMANTICS.md).
//
// The filtering logic (view level, city, barangay, risk class) is kept PURE and
// framework-free so it is exhaustively unit-testable; the layer install/paint
// wrappers use the same minimal map adapters as the current-risk layer.

import { APP_LAYER_SLOT, type MapLayerSpec } from './LayerRegistry';
import { HISTORICAL_RISK_COLORS } from '../map/basemap/colorTokens';
import { ncrBarangays, ncrBarangayInfos } from '../data/geojson/ncrBarangays';
import {
  historicalRiskByBarangay,
  historicalCitySummaryByPsgc,
  type HistoricalRiskClass,
} from '../data/historical/ncrHistoricalFloodRisk';

export type { MapLayerSpec };

/** The GeoJSON source id for the historical barangay polygons. */
export const HISTORICAL_RISK_SOURCE_ID = 'historicalFloodRisk';
/** The historical fill layer id. */
export const HISTORICAL_RISK_FILL_LAYER_ID = 'historicalFloodRisk' as const;
/** The historical outline layer id. */
export const HISTORICAL_RISK_OUTLINE_LAYER_ID = 'historicalFloodRisk-outline';
/** Feature-state key carrying the derived historical class per barangay. */
export const HISTORICAL_RISK_STATE_KEY = 'histRisk';
/**
 * Feature-state key marking whether a barangay is EMPHASIZED under the active
 * filter. `true` = matches (emphasized), `false` = does not match (DIMMED, not
 * hidden — every barangay stays colored by its class). Named `histShown` for
 * backward compatibility with existing callers/tests.
 */
export const HISTORICAL_FILTER_STATE_KEY = 'histShown';
/** Feature-state key marking the single selected barangay (stronger outline). */
export const HISTORICAL_SELECTED_STATE_KEY = 'histSelected';
/** The selected-barangay highlight outline layer id. */
export const HISTORICAL_SELECTED_LAYER_ID = 'historicalFloodRisk-selected';
/** The zoom-aware barangay NAME+CLASS label layer id (symbol, city-scoped). */
export const HISTORICAL_LABEL_LAYER_ID = 'historicalFloodRisk-labels';
/** The ALWAYS-VISIBLE selected-barangay label layer id (symbol). */
export const HISTORICAL_LABEL_SELECTED_LAYER_ID = 'historicalFloodRisk-labels-selected';
/** Dedicated point source id for barangay labels (centroid points + display props). */
export const HISTORICAL_LABEL_SOURCE_ID = 'historicalBarangayLabels';
/** Zoom at/above which barangay labels begin to appear (never at NCR overview). */
export const HISTORICAL_LABEL_MIN_ZOOM = 12.5;
/**
 * Feature-state key carrying the drill-down EMPHASIS tier per barangay:
 *   'focus' — the selected barangay (Barangay focus mode)
 *   'in'    — inside the active scope AND matches the risk filter (full color)
 *   'dim'   — inside the active scope but filtered out / not the focus (muted)
 *   'out'   — outside the active scope (heavily muted context)
 * Every barangay ALWAYS keeps its class color; only opacity changes by tier.
 */
export const HISTORICAL_EMPHASIS_STATE_KEY = 'histEmphasis';

/** The drill-down emphasis tier for a barangay. */
export type HistoricalEmphasis = 'focus' | 'in' | 'dim' | 'out';

/** The three view levels for the Historical Flood Risk panel. */
export type HistoricalViewLevel = 'ncr' | 'city' | 'barangay';

/** The risk filter, including "all". */
export type HistoricalRiskFilter = 'all' | HistoricalRiskClass;

/** The full filter state driven by the UI controls. */
export interface HistoricalFilterState {
  /** View by NCR / City / Barangay. */
  readonly view: HistoricalViewLevel;
  /** Selected city PSGC (city/barangay views); null = none selected. */
  readonly cityPsgc: string | null;
  /** Selected barangay PSGC (barangay view); null = none selected. */
  readonly barangayPsgc: string | null;
  /** Risk-class filter. */
  readonly risk: HistoricalRiskFilter;
}

/** The default filter state: whole NCR, all risk classes. */
export const DEFAULT_HISTORICAL_FILTER: HistoricalFilterState = {
  view: 'ncr',
  cityPsgc: null,
  barangayPsgc: null,
  risk: 'all',
};

/**
 * Decides whether a single barangay is VISIBLE under the active filter. Pure and
 * exhaustively testable. Rules:
 *   - risk filter: when not 'all', the barangay's derived class must match
 *     (Unknown is a real, selectable class — never silently dropped).
 *   - view 'ncr': all barangays (subject to the risk filter).
 *   - view 'city': only barangays in the selected city (none selected → none).
 *   - view 'barangay': only the selected barangay (none selected → none).
 */
export function isBarangayShown(
  psgc: string,
  cityPsgc: string,
  histClass: HistoricalRiskClass,
  filter: HistoricalFilterState,
): boolean {
  if (filter.risk !== 'all' && histClass !== filter.risk) return false;
  switch (filter.view) {
    case 'ncr':
      return true;
    case 'city':
      return filter.cityPsgc != null && cityPsgc === filter.cityPsgc;
    case 'barangay':
      return filter.barangayPsgc != null && psgc === filter.barangayPsgc;
    default:
      return true;
  }
}

/**
 * Computes the shown/hidden decision for EVERY barangay under a filter. Returns
 * PSGC → boolean over the full historical dataset, so the caller can drive
 * feature-state consistently (barangays absent from the dataset are Unknown).
 */
export function computeShownByBarangay(
  filter: HistoricalFilterState,
): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const rec of historicalRiskByBarangay.values()) {
    out.set(
      rec.psgc,
      isBarangayShown(rec.psgc, rec.cityPsgc, rec.historicalRiskClass, filter),
    );
  }
  return out;
}

/** Count of barangays that pass the filter (for empty-state UI). */
export function shownCount(filter: HistoricalFilterState): number {
  let n = 0;
  for (const v of computeShownByBarangay(filter).values()) if (v) n += 1;
  return n;
}

/**
 * The drill-down EMPHASIS tier for one barangay under the active filter. Pure.
 *
 *   NCR view      : in-scope = all barangays. Risk filter dims non-matching.
 *   City view     : in-scope = the selected city's barangays; others are 'out'.
 *                   Within the city, non-matching risk → 'dim'.
 *   Barangay view : the selected barangay is 'focus'; other barangays in its
 *                   city are 'dim'; barangays outside that city are 'out'.
 *
 * A matching in-scope barangay is 'in'. Every tier still renders the barangay's
 * class color — only opacity differs (dim-not-hide is preserved).
 */
export function emphasisFor(
  psgc: string,
  cityPsgc: string,
  histClass: HistoricalRiskClass,
  filter: HistoricalFilterState,
): HistoricalEmphasis {
  const matchesRisk = filter.risk === 'all' || histClass === filter.risk;

  if (filter.view === 'barangay') {
    // Scope is the selected city (parent context); focus is the barangay.
    const inCity = filter.cityPsgc == null || cityPsgc === filter.cityPsgc;
    if (!inCity) return 'out';
    if (filter.barangayPsgc != null && psgc === filter.barangayPsgc) return 'focus';
    return 'dim';
  }

  if (filter.view === 'city') {
    if (filter.cityPsgc == null) {
      // No city chosen yet: behave like NCR (all in-scope), risk filter dims.
      return matchesRisk ? 'in' : 'dim';
    }
    if (cityPsgc !== filter.cityPsgc) return 'out';
    return matchesRisk ? 'in' : 'dim';
  }

  // NCR view: everything in scope; risk filter dims non-matching.
  return matchesRisk ? 'in' : 'dim';
}

/** Computes the emphasis tier for EVERY barangay under a filter. */
export function computeEmphasisByBarangay(
  filter: HistoricalFilterState,
): Map<string, HistoricalEmphasis> {
  const out = new Map<string, HistoricalEmphasis>();
  for (const rec of historicalRiskByBarangay.values()) {
    out.set(
      rec.psgc,
      emphasisFor(rec.psgc, rec.cityPsgc, rec.historicalRiskClass, filter),
    );
  }
  return out;
}

/**
 * Data-driven fill color keyed on the historical feature-state `histRisk`.
 * Falls back to Unknown (never a classified level) when no state is set.
 */
export function historicalFillColorExpression(): unknown {
  const c = (k: HistoricalRiskClass): string => HISTORICAL_RISK_COLORS[k].hex;
  return [
    'match',
    ['feature-state', HISTORICAL_RISK_STATE_KEY],
    'High',
    c('High'),
    'Moderate',
    c('Moderate'),
    'Low',
    c('Low'),
    'Unknown',
    c('Unknown'),
    c('Unknown'),
  ];
}

/**
 * Fill opacity keyed on BOTH the emphasis state (`histShown`) and the class.
 *
 * DIM-NOT-HIDE: every barangay stays colored by its class in every view. A
 * barangay that does NOT match the active filter (city / barangay / risk) is
 * DIMMED to a faint fill rather than hidden, so users always see the full NCR
 * mosaic and can tell what was de-emphasized. Matching barangays get the full
 * class fill. Unknown is always faint (honest "no data") but never zero.
 */
export function historicalFillOpacityExpression(): unknown {
  const tier = ['feature-state', HISTORICAL_EMPHASIS_STATE_KEY];
  const state = ['feature-state', HISTORICAL_RISK_STATE_KEY];
  const isUnknown = ['any', ['==', state, 'Unknown'], ['==', state, null]];
  // Full (in-scope) opacity ramp per zoom for classified classes.
  const fullClass = ['interpolate', ['linear'], ['zoom'], 9, 0.5, 13, 0.42, 16, 0.34];
  const focusClass = ['interpolate', ['linear'], ['zoom'], 9, 0.62, 13, 0.55, 16, 0.48];
  return [
    'case',
    // Selected barangay (Barangay focus): strongest fill.
    ['==', tier, 'focus'],
    ['case', isUnknown, 0.18, focusClass],
    // Outside the active scope: heavily muted context (still colored).
    ['==', tier, 'out'],
    ['case', isUnknown, 0.02, 0.06],
    // In scope but filtered out / not the focus: dimmed.
    ['==', tier, 'dim'],
    ['case', isUnknown, 0.04, 0.12],
    // In scope + matching (or no state yet → treat as in-scope): full color.
    isUnknown,
    0.1,
    fullClass,
  ];
}

/** The historical source spec (barangay polygons, PSGC promoted to id). */
export interface HistoricalSourceSpec {
  type: 'geojson';
  data: GeoJSON.FeatureCollection;
  promoteId: string;
}

/** Builds the historical barangay polygon source (PSGC as feature id). */
export function buildHistoricalSource(): HistoricalSourceSpec {
  return {
    type: 'geojson',
    data: ncrBarangays as unknown as GeoJSON.FeatureCollection,
    promoteId: 'psgc',
  };
}

/** Builds the historical FILL layer (feature-state driven). */
export function buildHistoricalFillLayer(
  sourceId: string = HISTORICAL_RISK_SOURCE_ID,
): MapLayerSpec {
  return {
    id: HISTORICAL_RISK_FILL_LAYER_ID,
    type: 'fill',
    slot: APP_LAYER_SLOT,
    source: sourceId,
    paint: {
      'fill-color': historicalFillColorExpression(),
      'fill-opacity': historicalFillOpacityExpression(),
    },
  };
}

/**
 * Builds the historical OUTLINE layer. A dotted hairline (distinct from the
 * current-risk solid outline) that only appears for SHOWN barangays, so the
 * historical layer's boundaries read differently from the current layer.
 */
export function buildHistoricalOutlineLayer(
  sourceId: string = HISTORICAL_RISK_SOURCE_ID,
): MapLayerSpec {
  const tier = ['feature-state', HISTORICAL_EMPHASIS_STATE_KEY];
  // In-scope (in/focus) barangays get a firmer boundary; dim/out get fainter.
  const inScope = ['any', ['==', tier, 'in'], ['==', tier, 'focus'], ['==', tier, null]];
  return {
    id: HISTORICAL_RISK_OUTLINE_LAYER_ID,
    type: 'line',
    slot: APP_LAYER_SLOT,
    source: sourceId,
    paint: {
      'line-color': '#3f2b96',
      'line-dasharray': [1, 1.5],
      'line-width': [
        'case',
        inScope,
        ['interpolate', ['linear'], ['zoom'], 11, 0.3, 15, 0.9],
        ['interpolate', ['linear'], ['zoom'], 11, 0.2, 15, 0.4],
      ],
      'line-opacity': [
        'case',
        inScope,
        ['interpolate', ['linear'], ['zoom'], 11, 0, 13, 0.35, 16, 0.55],
        ['interpolate', ['linear'], ['zoom'], 11, 0, 13, 0.1, 16, 0.16],
      ],
    },
  };
}

/**
 * Builds the SELECTED-barangay highlight outline for the historical layer: a
 * strong, solid indigo border driven by the `histSelected` feature-state, so
 * exactly one barangay reads with a clearly stronger boundary than the normal
 * barangay outlines. Non-selected features render it fully transparent.
 */
export function buildHistoricalSelectedLayer(
  sourceId: string = HISTORICAL_RISK_SOURCE_ID,
): MapLayerSpec {
  const selected = ['boolean', ['feature-state', HISTORICAL_SELECTED_STATE_KEY], false];
  return {
    id: HISTORICAL_SELECTED_LAYER_ID,
    type: 'line',
    slot: APP_LAYER_SLOT,
    source: sourceId,
    paint: {
      'line-color': '#2a1a6b',
      'line-width': ['case', selected, 3, 0],
      'line-opacity': ['case', selected, 1, 0],
    },
  };
}

/** A GeoJSON source spec for the barangay label points. */
export interface BarangayLabelSourceSpec {
  type: 'geojson';
  data: GeoJSON.FeatureCollection;
  promoteId: string;
}

/**
 * Builds the dedicated barangay LABEL point source: one Point feature per
 * barangay at its PRECOMPUTED centroid, carrying DISPLAY-ONLY properties read
 * from existing data — the official barangay name (`brgy`), the derived
 * historical class (`cls`), plus `city`/`cityPsgc`/`psgc` for filtering.
 *
 * This is a pure RENDERING PROJECTION of data the app already ships
 * (`ncrBarangayInfos` geometry centroids + `historicalRiskByBarangay` classes).
 * It introduces no new geometry, changes no classification/PSGC mapping, and is
 * NOT a second source of truth for risk — the polygon fill (feature-state) stays
 * the authoritative risk visualization; these points only carry label text.
 * The class is materialized as a PROPERTY here because Mapbox `text-field`
 * cannot read `feature-state`.
 */
export function buildBarangayLabelSource(): BarangayLabelSourceSpec {
  const features: GeoJSON.Feature[] = ncrBarangayInfos.map((b) => {
    const cls = historicalRiskByBarangay.get(b.psgc)?.historicalRiskClass ?? 'Unknown';
    return {
      type: 'Feature',
      id: b.psgc,
      geometry: { type: 'Point', coordinates: [b.centroid[0], b.centroid[1]] },
      properties: {
        psgc: b.psgc,
        brgy: b.name, // official barangay name, verbatim (e.g. "Barangay 176-A")
        city: b.city,
        cityPsgc: b.cityPsgc,
        cls,
      },
    };
  });
  return {
    type: 'geojson',
    data: { type: 'FeatureCollection', features },
    promoteId: 'psgc',
  };
}

/**
 * The two-line label text expression: official barangay name on the first line,
 * UPPERCASE historical class on the second (e.g. "Barangay 184" / "LOW"). The
 * polygon color remains the primary risk cue; this just helps identify the
 * polygon and its class. No alias line is emitted — the app ships no verified
 * alias dataset, and official names are shown verbatim (never invented).
 */
function barangayLabelTextField(): unknown {
  return [
    'format',
    ['get', 'brgy'],
    {},
    '\n',
    {},
    ['upcase', ['to-string', ['get', 'cls']]],
    { 'font-scale': 0.82 },
  ];
}

/**
 * Builds the zoom-aware barangay NAME+CLASS label layer (a Mapbox `symbol`
 * layer on the dedicated label point source). Labels read the official `brgy`
 * name + derived `cls` property; one point label per barangay centroid.
 *
 * Readability + "don't overcrowd the city" are handled by Mapbox's built-in
 * collision engine plus zoom gating:
 *   - `minzoom` {@link HISTORICAL_LABEL_MIN_ZOOM}: NO labels at NCR/low zoom.
 *   - `text-opacity` fades in just above minzoom.
 *   - `text-size` grows with zoom so more labels fit as the user zooms in.
 *   - `text-allow-overlap:false` + `text-ignore-placement:false`: colliding
 *     labels are dropped (the engine keeps the non-overlapping subset), so at
 *     mid-city zoom only the labels that fit are shown and more appear closer in.
 *
 * The layer carries no filter here; the caller scopes it to the SELECTED city
 * via {@link cityLabelFilter} (so only that city's barangays are label
 * candidates, never all 1,710 NCR barangays).
 */
export function buildHistoricalBarangayLabelLayer(
  sourceId: string = HISTORICAL_LABEL_SOURCE_ID,
): MapLayerSpec {
  return {
    id: HISTORICAL_LABEL_LAYER_ID,
    type: 'symbol',
    slot: APP_LAYER_SLOT,
    source: sourceId,
    minzoom: HISTORICAL_LABEL_MIN_ZOOM,
    // Start with a filter that matches nothing, so no labels show until a city
    // is selected (NCR overview stays clean). The caller swaps this via setFilter.
    filter: ['==', ['get', 'cityPsgc'], '__none__'],
    layout: {
      'symbol-placement': 'point',
      'text-field': barangayLabelTextField(),
      'text-size': ['interpolate', ['linear'], ['zoom'], 12.5, 10, 14, 11, 16, 13],
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-optional': true,
      'text-padding': 2,
      'text-max-width': 8,
      'text-line-height': 1.1,
    },
    paint: {
      'text-color': '#2a1a6b',
      'text-halo-color': 'rgba(255,255,255,0.9)',
      'text-halo-width': 1.2,
      // Fade labels in just above the min zoom so they never pop abruptly.
      'text-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, 0, 13, 1],
    },
  };
}

/**
 * Builds the ALWAYS-VISIBLE selected-barangay label layer. Same point source +
 * two-line name/class text as the general layer, but with NO minzoom and
 * `text-allow-overlap: true` so the SELECTED barangay's label is shown at every
 * zoom (including the NCR/city overview) and never dropped by collision. Scoped
 * to the single selected barangay via {@link selectedLabelFilter} (nothing when
 * none selected, so the overview stays clean).
 */
export function buildHistoricalSelectedLabelLayer(
  sourceId: string = HISTORICAL_LABEL_SOURCE_ID,
): MapLayerSpec {
  return {
    id: HISTORICAL_LABEL_SELECTED_LAYER_ID,
    type: 'symbol',
    slot: APP_LAYER_SLOT,
    source: sourceId,
    filter: ['==', ['get', 'psgc'], '__none__'],
    layout: {
      'symbol-placement': 'point',
      'text-field': barangayLabelTextField(),
      'text-size': 12,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'text-padding': 2,
      'text-max-width': 10,
      'text-line-height': 1.1,
    },
    paint: {
      'text-color': '#1b1147',
      'text-halo-color': 'rgba(255,255,255,0.95)',
      'text-halo-width': 1.6,
    },
  };
}

/**
 * The Mapbox filter expression scoping the barangay label layer to a single
 * city's barangays (or NOTHING when no city is selected, keeping NCR overview
 * label-free). When a RISK filter is active (not 'all'), labels are further
 * restricted to barangays whose derived `cls` matches — so the visible labels
 * stay consistent with the panel count and the fill emphasis (which both apply
 * the same risk filter). Uses the existing `cityPsgc` + `cls` properties — no
 * new data. The always-visible SELECTED-barangay label is unaffected (it has
 * its own filter), so an explicitly chosen barangay keeps its label regardless.
 */
export function cityLabelFilter(
  cityPsgc: string | null,
  risk: HistoricalRiskFilter = 'all',
): unknown {
  const cityMatch = ['==', ['get', 'cityPsgc'], cityPsgc ?? '__none__'];
  if (risk === 'all') return cityMatch;
  return ['all', cityMatch, ['==', ['get', 'cls'], risk]];
}

/**
 * The filter scoping the always-visible selected-barangay label to ONE barangay
 * (or NOTHING when none is selected). Keyed by the official `psgc`.
 */
export function selectedLabelFilter(psgc: string | null): unknown {
  return ['==', ['get', 'psgc'], psgc ?? '__none__'];
}

/**
 * A DIMMED variant of the historical fill opacity, used purely for visual
 * co-existence when BOTH the current and historical layers are enabled and the
 * user is focused on the Current tab. The historical layer recedes to a faint
 * overlay so the two color families never produce a muddy double-fill. This is
 * a paint-only concern — it changes no data, feature-state, or classification.
 */
export function historicalFillOpacityDimmedExpression(): unknown {
  const tier = ['feature-state', HISTORICAL_EMPHASIS_STATE_KEY];
  const state = ['feature-state', HISTORICAL_RISK_STATE_KEY];
  const isUnknown = ['any', ['==', state, 'Unknown'], ['==', state, null]];
  return [
    'case',
    ['==', tier, 'focus'],
    0.2,
    ['==', tier, 'out'],
    0.02,
    ['==', tier, 'dim'],
    0.03,
    isUnknown,
    0.04,
    0.14,
  ];
}

/** Minimal map surface for feature-state paints (shared with current risk). */
export interface HistoricalFeatureStateMap {
  setFeatureState(
    target: { source: string; id: string | number },
    state: Record<string, unknown>,
  ): void;
}

/**
 * Paints each barangay's derived historical class via feature-state, so the
 * fill repaints WITHOUT rebuilding the source (like the current-risk layer).
 * Applied once on install; the class is STATIC (never changes at runtime).
 */
export function applyHistoricalRiskStates(
  map: HistoricalFeatureStateMap | null | undefined,
): void {
  if (!map || typeof map.setFeatureState !== 'function') return;
  for (const rec of historicalRiskByBarangay.values()) {
    try {
      map.setFeatureState(
        { source: HISTORICAL_RISK_SOURCE_ID, id: rec.psgc },
        { [HISTORICAL_RISK_STATE_KEY]: rec.historicalRiskClass },
      );
    } catch {
      // A single bad id must never break the whole pass.
    }
  }
}

/**
 * Applies the filter to the map by writing the `histShown` feature-state per
 * barangay. Idempotent; cheap enough to reapply on every filter change.
 */
export function applyHistoricalFilter(
  map: HistoricalFeatureStateMap | null | undefined,
  filter: HistoricalFilterState,
): void {
  if (!map || typeof map.setFeatureState !== 'function') return;
  const emphasis = computeEmphasisByBarangay(filter);
  const shown = computeShownByBarangay(filter);
  for (const [psgc, tier] of emphasis) {
    try {
      map.setFeatureState(
        { source: HISTORICAL_RISK_SOURCE_ID, id: psgc },
        {
          // Primary driver of the drill-down opacity tiers.
          [HISTORICAL_EMPHASIS_STATE_KEY]: tier,
          // Kept for backward compatibility (older readers / tests).
          [HISTORICAL_FILTER_STATE_KEY]: shown.get(psgc) ?? true,
        },
      );
    } catch {
      // Ignore a single bad id.
    }
  }
}

/** Minimal adapter to install the historical source + layers. */
export interface HistoricalMapAdapter {
  addSource(id: string, source: HistoricalSourceSpec | BarangayLabelSourceSpec): void;
  addLayer(layer: MapLayerSpec, beforeId?: string): void;
}

/**
 * Marks a single barangay as the historical selection via feature-state,
 * clearing any prior selection. Pass `null` to clear entirely. Guarded so a
 * missing `setFeatureState` (fake maps) is a safe no-op.
 */
export function setSelectedHistoricalBarangay(
  map: HistoricalFeatureStateMap | null | undefined,
  psgc: string | null,
  previousPsgc: string | null,
): void {
  if (!map || typeof map.setFeatureState !== 'function') return;
  try {
    if (previousPsgc && previousPsgc !== psgc) {
      map.setFeatureState(
        { source: HISTORICAL_RISK_SOURCE_ID, id: previousPsgc },
        { [HISTORICAL_SELECTED_STATE_KEY]: false },
      );
    }
    if (psgc) {
      map.setFeatureState(
        { source: HISTORICAL_RISK_SOURCE_ID, id: psgc },
        { [HISTORICAL_SELECTED_STATE_KEY]: true },
      );
    }
  } catch {
    // A bad id must never break selection handling.
  }
}

/** Installs the historical source + fill + outline + selection (built once). */
export function installHistoricalFloodRisk(map: HistoricalMapAdapter): void {
  map.addSource(HISTORICAL_RISK_SOURCE_ID, buildHistoricalSource());
  map.addLayer(buildHistoricalFillLayer(HISTORICAL_RISK_SOURCE_ID));
  map.addLayer(buildHistoricalOutlineLayer(HISTORICAL_RISK_SOURCE_ID));
  map.addLayer(buildHistoricalSelectedLayer(HISTORICAL_RISK_SOURCE_ID));
  // Dedicated label point source (centroid points carrying official name +
  // derived class as display properties). Zoom-aware city-scoped labels + an
  // always-visible selected-barangay label render from it.
  map.addSource(HISTORICAL_LABEL_SOURCE_ID, buildBarangayLabelSource());
  map.addLayer(buildHistoricalBarangayLabelLayer(HISTORICAL_LABEL_SOURCE_ID));
  map.addLayer(buildHistoricalSelectedLabelLayer(HISTORICAL_LABEL_SOURCE_ID));
}

/** Resolves the city name for a city PSGC (for panels/labels). */
export function cityNameFor(cityPsgc: string): string | null {
  return historicalCitySummaryByPsgc.get(cityPsgc)?.cityName ?? null;
}

/** A Mapbox-compatible bounds tuple `[[west, south], [east, north]]`. */
export type BoundsTuple = [[number, number], [number, number]];

/** Accumulates a lng/lat point into a mutable bounds accumulator. */
interface BoundsAcc {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}
function emptyAcc(): BoundsAcc {
  return {
    minLng: Infinity,
    minLat: Infinity,
    maxLng: -Infinity,
    maxLat: -Infinity,
  };
}
function extend(acc: BoundsAcc, lng: number, lat: number): void {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
  if (lng < acc.minLng) acc.minLng = lng;
  if (lat < acc.minLat) acc.minLat = lat;
  if (lng > acc.maxLng) acc.maxLng = lng;
  if (lat > acc.maxLat) acc.maxLat = lat;
}
function finish(acc: BoundsAcc): BoundsTuple | null {
  if (!Number.isFinite(acc.minLng) || !Number.isFinite(acc.maxLng)) return null;
  return [
    [acc.minLng, acc.minLat],
    [acc.maxLng, acc.maxLat],
  ];
}

/** Walks every [lng,lat] position of a Polygon/MultiPolygon geometry. */
function eachPosition(
  geometry: GeoJSON.Geometry,
  visit: (lng: number, lat: number) => void,
): void {
  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates)
      for (const [lng, lat] of ring) visit(lng, lat);
  } else if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates)
      for (const ring of poly) for (const [lng, lat] of ring) visit(lng, lat);
  }
}

/** PSGC → feature, built once from the local NCR asset for bounds lookups. */
const featureByPsgc: ReadonlyMap<string, GeoJSON.Feature> = new Map(
  (ncrBarangays as unknown as GeoJSON.FeatureCollection).features
    .filter((f) => typeof f.properties?.psgc === 'string')
    .map((f) => [String(f.properties!.psgc), f] as const),
);

/**
 * Bounds of a SINGLE barangay from its polygon geometry (tight fit). Returns
 * null for an unknown PSGC. Used to frame the Barangay view.
 */
export function barangayBounds(psgc: string): BoundsTuple | null {
  const f = featureByPsgc.get(psgc);
  if (!f?.geometry) return null;
  const acc = emptyAcc();
  eachPosition(f.geometry, (lng, lat) => extend(acc, lng, lat));
  return finish(acc);
}

/**
 * Bounds covering every barangay geometry in a city (by city PSGC). Returns
 * null when the city has no barangays. Used to frame the City / LGU view.
 */
export function cityBounds(cityPsgc: string): BoundsTuple | null {
  const acc = emptyAcc();
  for (const rec of historicalRiskByBarangay.values()) {
    if (rec.cityPsgc !== cityPsgc) continue;
    const f = featureByPsgc.get(rec.psgc);
    if (f?.geometry) eachPosition(f.geometry, (lng, lat) => extend(acc, lng, lat));
  }
  return finish(acc);
}
