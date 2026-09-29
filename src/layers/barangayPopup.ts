// src/layers/barangayPopup.ts
//
// Wires the barangay click/tap → info-panel interaction onto the map. On a
// click within the barangay-risk fill layer it reads the clicked feature's
// PSGC and asks the caller to resolve the CURRENT info-panel props for that
// barangay (rainfall, risk, reports, official status, etc. live in MapView
// state). Kept structural so a fake map can be injected in tests.

import { BARANGAY_RISK_FILL_LAYER_ID } from './barangayFloodRiskLayer';

/** A minimal lng/lat pair (Mapbox-compatible, structural). */
export interface LngLatLike {
  lng: number;
  lat: number;
}

/** A clicked barangay feature (structural). Carries id/properties. */
export interface BarangayFeatureLike {
  id?: string | number;
  properties?: Record<string, unknown> | null;
}

/** A layer-scoped click event carrying queried features + click position. */
export interface BarangayLayerClickEvent {
  features?: BarangayFeatureLike[];
  lngLat: LngLatLike;
}

export type BarangayMapEvent = 'click' | 'mouseenter' | 'mouseleave';

/** The minimal map surface needed to wire the barangay popup. */
export interface BarangayPopupMap {
  on(
    event: BarangayMapEvent,
    layerId: string,
    handler: (event: BarangayLayerClickEvent) => void,
  ): void;
  off(
    event: BarangayMapEvent,
    layerId: string,
    handler: (event: BarangayLayerClickEvent) => void,
  ): void;
  getCanvas?: () => { style: { cursor: string } };
}

/**
 * Resolves whether a barangay PSGC can be shown, returning the PSGC when it is
 * known/renderable or `null` otherwise. The actual panel props are derived by
 * the caller at render time (so the open panel can react to live data and the
 * timeline step). Supplied by MapView.
 */
export type ResolveBarangayInfo = (psgc: string) => string | null;

/** The callback that actually opens the panel for a PSGC at a position. */
export type RenderBarangayPanel = (psgc: string, lngLat: LngLatLike) => void;

/** Reads the barangay PSGC from a clicked feature (id or properties.psgc). */
export function psgcFromFeature(
  feature: BarangayFeatureLike | undefined,
): string | null {
  if (!feature) return null;
  if (typeof feature.id === 'string' && feature.id) return feature.id;
  const psgc = feature.properties?.psgc;
  return typeof psgc === 'string' && psgc ? psgc : null;
}

/** Teardown for {@link installBarangayPopup}. */
export type UninstallBarangayPopup = () => void;

/**
 * Wires the barangay click popup. On click it resolves the clicked barangay's
 * PSGC, asks `resolveInfo` for the current props, and (when present) calls
 * `renderPanel(props, lngLat)`. Also toggles a pointer cursor over barangays.
 */
export function installBarangayPopup(
  map: BarangayPopupMap,
  resolveInfo: ResolveBarangayInfo,
  renderPanel: RenderBarangayPanel,
): UninstallBarangayPopup {
  const onClick = (event: BarangayLayerClickEvent): void => {
    const psgc = psgcFromFeature(event.features?.[0]);
    if (!psgc) return;
    const resolved = resolveInfo(psgc);
    if (!resolved) return;
    renderPanel(resolved, event.lngLat);
  };

  const setCursor = (cursor: string): void => {
    const canvas = map.getCanvas?.();
    if (canvas) canvas.style.cursor = cursor;
  };
  const onEnter = (): void => setCursor('pointer');
  const onLeave = (): void => setCursor('');

  map.on('click', BARANGAY_RISK_FILL_LAYER_ID, onClick);
  map.on('mouseenter', BARANGAY_RISK_FILL_LAYER_ID, onEnter);
  map.on('mouseleave', BARANGAY_RISK_FILL_LAYER_ID, onLeave);

  return () => {
    map.off('click', BARANGAY_RISK_FILL_LAYER_ID, onClick);
    map.off('mouseenter', BARANGAY_RISK_FILL_LAYER_ID, onEnter);
    map.off('mouseleave', BARANGAY_RISK_FILL_LAYER_ID, onLeave);
  };
}
