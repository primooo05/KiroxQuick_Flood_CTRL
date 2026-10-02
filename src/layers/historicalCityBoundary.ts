// src/layers/historicalCityBoundary.ts
//
// The CITY / LGU boundary layer for the Historical Flood Risk drill-down. City
// polygons are DERIVED by dissolving barangay geometries by `cityPsgc` (done
// offline; see src/data/geojson/ncrCityBoundaries.geojson) so each city outline
// exactly matches the union of its barangays and carries the same PSGC used by
// the historical dataset.
//
// These polygons are used for the city OUTER BOUNDARY, city selection, city
// hover, city focus and fitBounds — they NEVER replace the per-barangay risk
// fill (each barangay keeps its own historical color). This is a separate
// source + separate line layers, distinct from the barangay fill/outline.

import { APP_LAYER_SLOT, type MapLayerSpec } from './LayerRegistry';
import rawCityBoundaries from '../data/geojson/ncrCityBoundaries.geojson?raw';

/** GeoJSON source id for the derived city boundaries. */
export const CITY_BOUNDARY_SOURCE_ID = 'historicalCityBoundary';
/** The base (all-cities) boundary line layer id. */
export const CITY_BOUNDARY_LAYER_ID = 'historicalCityBoundary-line';
/** The selected-city emphasized boundary line layer id. */
export const CITY_BOUNDARY_SELECTED_LAYER_ID = 'historicalCityBoundary-selected';
/** Feature-state key: is this the selected (focused) city? */
export const CITY_SELECTED_STATE_KEY = 'citySelected';
/** Feature-state key: emphasis tier for the city boundary (`dim` when a
 *  different city is focused). */
export const CITY_EMPHASIS_STATE_KEY = 'cityEmphasis';

/** Parsed city-boundary FeatureCollection (dissolved by cityPsgc). */
export const ncrCityBoundaries = JSON.parse(
  rawCityBoundaries,
) as GeoJSON.FeatureCollection;

/** The city-boundary GeoJSON source spec (PSGC promoted to feature id). */
export interface CityBoundarySourceSpec {
  type: 'geojson';
  data: GeoJSON.FeatureCollection;
  promoteId: string;
}

/** Builds the city-boundary source with cityPsgc as the feature id. */
export function buildCityBoundarySource(): CityBoundarySourceSpec {
  return {
    type: 'geojson',
    data: ncrCityBoundaries,
    promoteId: 'cityPsgc',
  };
}

/**
 * The base city-boundary line: a subtle outline for every LGU so NCR overview
 * shows all 17 city boundaries. When a city is focused, non-selected cities are
 * further muted via the `cityEmphasis` state.
 */
export function buildCityBoundaryLayer(
  sourceId: string = CITY_BOUNDARY_SOURCE_ID,
): MapLayerSpec {
  const dim = ['==', ['feature-state', CITY_EMPHASIS_STATE_KEY], 'dim'];
  return {
    id: CITY_BOUNDARY_LAYER_ID,
    type: 'line',
    slot: APP_LAYER_SLOT,
    source: sourceId,
    paint: {
      'line-color': '#5b4b9e',
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 12, 1, 15, 1.4],
      // Subtle by default; muted further for non-selected cities during focus.
      'line-opacity': ['case', dim, 0.12, 0.4],
    },
  };
}

/**
 * The selected-city boundary: a strong outline for the focused LGU, rendered
 * above the barangay fills (but below the selected-barangay outline). Fully
 * transparent for non-selected cities.
 */
export function buildCityBoundarySelectedLayer(
  sourceId: string = CITY_BOUNDARY_SOURCE_ID,
): MapLayerSpec {
  const selected = ['boolean', ['feature-state', CITY_SELECTED_STATE_KEY], false];
  return {
    id: CITY_BOUNDARY_SELECTED_LAYER_ID,
    type: 'line',
    slot: APP_LAYER_SLOT,
    source: sourceId,
    paint: {
      'line-color': '#3f2b96',
      'line-width': ['case', selected, 3.5, 0],
      'line-opacity': ['case', selected, 0.95, 0],
    },
  };
}

/** PSGC → barangay count, for the city hover tooltip. */
import { historicalCitySummaryByPsgc } from '../data/historical/ncrHistoricalFloodRisk';

/** Resolved city hover payload (name + count + cursor point). */
export interface CityHoverInfo {
  cityPsgc: string;
  cityName: string;
  barangayCount: number;
  point: { x: number; y: number };
}

interface CityFeatureLike {
  id?: string | number;
  properties?: Record<string, unknown> | null;
}
interface CityLayerEvent {
  features?: CityFeatureLike[];
  point?: { x: number; y: number };
}
type CityMapEvent = 'mousemove' | 'mouseleave' | 'click';

/** Minimal map surface for city hover. */
export interface CityHoverMap {
  on(e: CityMapEvent, layer: string, h: (ev: CityLayerEvent) => void): void;
  off(e: CityMapEvent, layer: string, h: (ev: CityLayerEvent) => void): void;
}
/** Minimal map surface for city click. */
export type CityClickMap = CityHoverMap & {
  getCanvas?: () => { style: { cursor: string } };
};

/** Reads a cityPsgc from a hovered/clicked city feature. */
export function cityPsgcFromFeature(f: CityFeatureLike | undefined): string | null {
  if (!f) return null;
  if (typeof f.id === 'string' && f.id) return f.id;
  const p = f.properties?.cityPsgc;
  return typeof p === 'string' && p ? p : null;
}

/** Resolves the city hover payload, or null when unknown. Pure. */
export function resolveCityHover(ev: CityLayerEvent): CityHoverInfo | null {
  const cityPsgc = cityPsgcFromFeature(ev.features?.[0]);
  if (!cityPsgc) return null;
  const summary = historicalCitySummaryByPsgc.get(cityPsgc);
  if (!summary) return null;
  return {
    cityPsgc,
    cityName: summary.cityName,
    barangayCount: summary.barangayCount,
    point: ev.point ?? { x: 0, y: 0 },
  };
}

/** Wires the city hover tooltip on the base city-boundary line layer. */
export function installCityHover(
  map: CityHoverMap,
  onHover: (info: CityHoverInfo | null) => void,
): () => void {
  const onMove = (ev: CityLayerEvent): void => onHover(resolveCityHover(ev));
  const onLeave = (): void => onHover(null);
  map.on('mousemove', CITY_BOUNDARY_LAYER_ID, onMove);
  map.on('mouseleave', CITY_BOUNDARY_LAYER_ID, onLeave);
  return () => {
    map.off('mousemove', CITY_BOUNDARY_LAYER_ID, onMove);
    map.off('mouseleave', CITY_BOUNDARY_LAYER_ID, onLeave);
  };
}

/** Wires city selection by clicking the city boundary line (city mode). */
export function installCityClick(
  map: CityClickMap,
  onSelect: (cityPsgc: string) => void,
): () => void {
  const onClick = (ev: CityLayerEvent): void => {
    const psgc = cityPsgcFromFeature(ev.features?.[0]);
    if (psgc) onSelect(psgc);
  };
  const setCursor = (c: string): void => {
    const canvas = map.getCanvas?.();
    if (canvas) canvas.style.cursor = c;
  };
  const onEnter = (): void => setCursor('pointer');
  const onLeave = (): void => setCursor('');
  map.on('click', CITY_BOUNDARY_LAYER_ID, onClick);
  map.on('mousemove', CITY_BOUNDARY_LAYER_ID, onEnter);
  map.on('mouseleave', CITY_BOUNDARY_LAYER_ID, onLeave);
  return () => {
    map.off('click', CITY_BOUNDARY_LAYER_ID, onClick);
    map.off('mousemove', CITY_BOUNDARY_LAYER_ID, onEnter);
    map.off('mouseleave', CITY_BOUNDARY_LAYER_ID, onLeave);
  };
}

/** Minimal map surface for city-boundary feature-state paints. */
export interface CityBoundaryFeatureStateMap {
  setFeatureState(
    target: { source: string; id: string | number },
    state: Record<string, unknown>,
  ): void;
}

/** Minimal adapter to install the city-boundary source + layers. */
export interface CityBoundaryMapAdapter {
  addSource(id: string, source: CityBoundarySourceSpec): void;
  addLayer(layer: MapLayerSpec, beforeId?: string): void;
}

/** Installs the city-boundary source + base line + selected line (once). */
export function installHistoricalCityBoundary(map: CityBoundaryMapAdapter): void {
  map.addSource(CITY_BOUNDARY_SOURCE_ID, buildCityBoundarySource());
  map.addLayer(buildCityBoundaryLayer(CITY_BOUNDARY_SOURCE_ID));
  map.addLayer(buildCityBoundarySelectedLayer(CITY_BOUNDARY_SOURCE_ID));
}

/**
 * Applies the city-focus state to the boundaries: the selected city (if any)
 * gets `citySelected=true`; every other city gets `cityEmphasis='dim'` while a
 * city is focused, or `'normal'` when there is no focus (NCR overview). Pass
 * `null` to clear focus (NCR overview: all boundaries subtle + equal).
 */
export function applyCityFocus(
  map: CityBoundaryFeatureStateMap | null | undefined,
  selectedCityPsgc: string | null,
): void {
  if (!map || typeof map.setFeatureState !== 'function') return;
  const focused = selectedCityPsgc != null;
  for (const f of ncrCityBoundaries.features) {
    const psgc = (f.properties?.cityPsgc as string | undefined) ?? (f.id as string);
    if (!psgc) continue;
    const isSelected = psgc === selectedCityPsgc;
    try {
      map.setFeatureState(
        { source: CITY_BOUNDARY_SOURCE_ID, id: psgc },
        {
          [CITY_SELECTED_STATE_KEY]: isSelected,
          [CITY_EMPHASIS_STATE_KEY]: focused && !isSelected ? 'dim' : 'normal',
        },
      );
    } catch {
      // A single bad id must never break the pass.
    }
  }
}
