// src/layers/historicalHover.ts
//
// Wires a lightweight HOVER tooltip for the Historical Flood Risk layer. On
// mousemove over a historical barangay polygon it resolves the barangay's
// name, city, and derived historical class and reports them (with the cursor
// pixel position) to the caller, which renders a small tooltip. On mouseleave
// it clears. Kept structural so a fake map can be injected in tests.
//
// This is presentation only — it reads the STATIC historical dataset and
// changes no data, feature-state, or classification.

import { HISTORICAL_RISK_FILL_LAYER_ID } from './historicalFloodRisk';
import {
  historicalRiskByBarangay,
  type HistoricalRiskClass,
} from '../data/historical/ncrHistoricalFloodRisk';

/** Screen pixel position from a Mapbox mouse event. */
export interface HoverPoint {
  x: number;
  y: number;
}

/** The resolved hover payload the caller renders. */
export interface HistoricalHoverInfo {
  psgc: string;
  name: string;
  city: string;
  cls: HistoricalRiskClass;
  point: HoverPoint;
}

interface HistoricalHoverFeature {
  id?: string | number;
  properties?: Record<string, unknown> | null;
}

/** A layer-scoped mousemove event carrying features + a pixel point. */
export interface HistoricalHoverEvent {
  features?: HistoricalHoverFeature[];
  point?: HoverPoint;
}

export type HistoricalHoverMapEvent = 'mousemove' | 'mouseleave';

/** Minimal map surface needed to wire the historical hover. */
export interface HistoricalHoverMap {
  on(
    event: HistoricalHoverMapEvent,
    layerId: string,
    handler: (event: HistoricalHoverEvent) => void,
  ): void;
  off(
    event: HistoricalHoverMapEvent,
    layerId: string,
    handler: (event: HistoricalHoverEvent) => void,
  ): void;
}

/** Reads the PSGC from a hovered feature (id or properties.psgc). */
export function psgcFromHoverFeature(
  feature: HistoricalHoverFeature | undefined,
): string | null {
  if (!feature) return null;
  if (typeof feature.id === 'string' && feature.id) return feature.id;
  const psgc = feature.properties?.psgc;
  return typeof psgc === 'string' && psgc ? psgc : null;
}

/**
 * Resolves the hover payload for a hovered feature, or null when the PSGC is
 * unknown / unresolvable. Pure — testable without a map.
 */
export function resolveHoverInfo(
  event: HistoricalHoverEvent,
): HistoricalHoverInfo | null {
  const psgc = psgcFromHoverFeature(event.features?.[0]);
  if (!psgc) return null;
  const rec = historicalRiskByBarangay.get(psgc);
  if (!rec) return null;
  return {
    psgc,
    name: rec.name,
    city: rec.city,
    cls: rec.historicalRiskClass,
    point: event.point ?? { x: 0, y: 0 },
  };
}

/** Teardown for {@link installHistoricalHover}. */
export type UninstallHistoricalHover = () => void;

/**
 * Wires the historical hover tooltip. Calls `onHover(info)` with the resolved
 * barangay name/city/class + cursor position on mousemove, and `onHover(null)`
 * on mouseleave. No-ops safely if the map lacks `on`.
 */
export function installHistoricalHover(
  map: HistoricalHoverMap,
  onHover: (info: HistoricalHoverInfo | null) => void,
): UninstallHistoricalHover {
  const onMove = (event: HistoricalHoverEvent): void => {
    onHover(resolveHoverInfo(event));
  };
  const onLeave = (): void => onHover(null);

  map.on('mousemove', HISTORICAL_RISK_FILL_LAYER_ID, onMove);
  map.on('mouseleave', HISTORICAL_RISK_FILL_LAYER_ID, onLeave);

  return () => {
    map.off('mousemove', HISTORICAL_RISK_FILL_LAYER_ID, onMove);
    map.off('mouseleave', HISTORICAL_RISK_FILL_LAYER_ID, onLeave);
  };
}
