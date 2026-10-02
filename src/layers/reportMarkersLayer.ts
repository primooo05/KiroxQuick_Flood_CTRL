// src/layers/reportMarkersLayer.ts
//
// Renders two point layers so their LayerControl toggles are real:
//   - communityReports  → unconfirmed community flood reports (circle markers)
//   - officialClosures   → official/admin CONFIRMED_NOT_PASSABLE barangays
//
// Both are current-condition overlays that sit ABOVE the barangay risk fill so
// the specific points read on top. Colors come from the reserved current-risk
// palette. Community reports are clearly unconfirmed; closures are clearly
// official/manual-demo confirmations (see the fixtures' source labels).

import { APP_LAYER_SLOT, LayerRegistry, type MapLayerSpec } from './LayerRegistry';
import { CURRENT_RISK_COLORS, FLOOD_STATE_COLORS } from '../map/basemap/colorTokens';
import type { CommunityReport } from '../types/report';
import type { OfficialStatus } from '../types/risk';
import { barangayInfoByPsgc } from '../data/geojson/ncrBarangays';

export type { MapLayerSpec };

export const COMMUNITY_REPORTS_SOURCE_ID = 'communityReports';
export const COMMUNITY_REPORTS_LAYER_ID = 'communityReports' as const;
export const OFFICIAL_CLOSURES_SOURCE_ID = 'officialClosures';
export const OFFICIAL_CLOSURES_LAYER_ID = 'officialClosures' as const;

/** Minimal GeoJSON source spec (structural). */
export interface PointSourceSpec {
  type: 'geojson';
  data: GeoJSON.FeatureCollection;
}

import { resolveBarangayForPoint } from '../services/reportResolution';

/** Projects community reports to point features (skips non-locatable). */
export function communityReportsToGeoJSON(
  reports: readonly CommunityReport[],
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: reports.map((r) => {
      const { lng, lat } = r.metadata.location;
      const psgc = resolveBarangayForPoint(lng, lat);
      const barangay = psgc ? (barangayInfoByPsgc.get(psgc)?.name ?? '') : '';
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: {
          id: r.id,
          state: r.state,
          source: r.metadata.source,
          updatedAt: r.metadata.updatedAt,
          barangay,
        },
      };
    }),
  };
}

/**
 * Projects official confirmations to point features at their barangay centroid.
 * Only `notPassable` confirmations that resolve to a known barangay are shown.
 */
export function officialClosuresToGeoJSON(
  officials: readonly OfficialStatus[],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const o of officials) {
    if (!o.notPassable) continue;
    const info = barangayInfoByPsgc.get(o.psgc);
    if (!info) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [info.centroid[0], info.centroid[1]] },
      properties: {
        psgc: o.psgc,
        source: o.source,
        note: o.note ?? '',
        barangay: info.name,
        updatedAt: o.confirmedAt,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

/** The minimal map surface for installing point layers. */
export interface PointLayerMapAdapter {
  addSource(id: string, source: PointSourceSpec): void;
}

/** A GeoJSON source whose data can be replaced at runtime (Mapbox-compatible). */
export interface UpdatableGeoJSONSource {
  setData(data: GeoJSON.FeatureCollection): void;
}

/** The minimal map surface for refreshing an installed point source. */
export interface PointSourceUpdateMap {
  getSource(id: string): UpdatableGeoJSONSource | undefined;
}

/**
 * Replaces the community-reports source data at runtime so a newly submitted
 * report appears without reinstalling the layer. Reuses the same projection as
 * the initial install ({@link communityReportsToGeoJSON}); a no-op if the source
 * is not present yet. Visibility is untouched — the caller decides whether to
 * reveal the layer.
 */
export function updateCommunityReportsSource(
  map: PointSourceUpdateMap,
  reports: readonly CommunityReport[],
): void {
  const source = map.getSource(COMMUNITY_REPORTS_SOURCE_ID);
  if (!source) return;
  source.setData(communityReportsToGeoJSON(reports));
}

/**
 * Builds the community-reports circle layer. Reports are drawn as SMALLER
 * circles colored by their reported state, with a DASHED-look thin white ring —
 * deliberately distinct from the larger, solid, dark-ringed official closures
 * so an unconfirmed report never looks official.
 */
export function buildCommunityReportsLayer(): MapLayerSpec {
  return {
    id: COMMUNITY_REPORTS_LAYER_ID,
    type: 'circle',
    slot: APP_LAYER_SLOT,
    source: COMMUNITY_REPORTS_SOURCE_ID,
    paint: {
      'circle-radius': 5,
      'circle-color': [
        'match',
        ['get', 'state'],
        'RED',
        FLOOD_STATE_COLORS.RED.hex,
        'ORANGE',
        FLOOD_STATE_COLORS.ORANGE.hex,
        'YELLOW',
        FLOOD_STATE_COLORS.YELLOW.hex,
        FLOOD_STATE_COLORS.GRAY.hex,
      ],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
      'circle-opacity': 0.85,
    },
  };
}

/** Builds the official-closures marker layer spec. */
export function buildOfficialClosuresLayer(): MapLayerSpec {
  return {
    id: OFFICIAL_CLOSURES_LAYER_ID,
    type: 'circle',
    slot: APP_LAYER_SLOT,
    source: OFFICIAL_CLOSURES_SOURCE_ID,
    paint: {
      'circle-radius': 7,
      'circle-color': CURRENT_RISK_COLORS.CONFIRMED_NOT_PASSABLE.hex,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
      'circle-opacity': 0.95,
    },
  };
}

/**
 * Installs the community-report and official-closure point layers. Both start
 * HIDDEN (visibility 'none') so they are opt-in via the LayerControl; the
 * primary current-risk fill is the default active layer.
 */
export function installReportMarkers(
  map: PointLayerMapAdapter,
  registry: LayerRegistry,
  reports: readonly CommunityReport[],
  officials: readonly OfficialStatus[],
): void {
  map.addSource(COMMUNITY_REPORTS_SOURCE_ID, {
    type: 'geojson',
    data: communityReportsToGeoJSON(reports),
  });
  map.addSource(OFFICIAL_CLOSURES_SOURCE_ID, {
    type: 'geojson',
    data: officialClosuresToGeoJSON(officials),
  });

  registry.addAppLayer(buildCommunityReportsLayer());
  registry.addAppLayer(buildOfficialClosuresLayer());

  // Opt-in overlays: hidden by default.
  registry.setVisibility(COMMUNITY_REPORTS_LAYER_ID, false);
  registry.setVisibility(OFFICIAL_CLOSURES_LAYER_ID, false);
}

// ---------------------------------------------------------------------------
// Click popups for the report + closure markers (Phase 2, Req 10).
// ---------------------------------------------------------------------------

/** A minimal lng/lat pair (structural, Mapbox-compatible). */
export interface LngLatLike {
  lng: number;
  lat: number;
}

/** Props the render callback receives for a clicked marker. */
export interface ReportPopupData {
  kind: 'community' | 'official';
  state?: 'RED' | 'ORANGE' | 'YELLOW' | 'GREEN' | 'GRAY';
  barangay?: string;
  note?: string;
  updatedAt: number | null;
  source: string;
}

interface MarkerClickEvent {
  features?: Array<{ properties?: Record<string, unknown> | null }>;
  lngLat: LngLatLike;
}

/** The minimal map surface needed to wire marker popups. */
export interface ReportPopupMap {
  on(
    event: 'click' | 'mouseenter' | 'mouseleave',
    layerId: string,
    handler: (event: MarkerClickEvent) => void,
  ): void;
  off(
    event: 'click' | 'mouseenter' | 'mouseleave',
    layerId: string,
    handler: (event: MarkerClickEvent) => void,
  ): void;
  getCanvas?: () => { style: { cursor: string } };
}

/** Callback that shows a report/closure popup. */
export type RenderReportPopup = (data: ReportPopupData, lngLat: LngLatLike) => void;

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Wires click popups for the community-report and official-closure marker
 * layers. Community reports render as unconfirmed; closures as official. Returns
 * a teardown fn.
 */
export function installReportPopups(
  map: ReportPopupMap,
  render: RenderReportPopup,
): () => void {
  const onCommunity = (e: MarkerClickEvent): void => {
    const p = e.features?.[0]?.properties ?? {};
    render(
      {
        kind: 'community',
        state: (p.state as ReportPopupData['state']) ?? undefined,
        barangay: str(p.barangay) || undefined,
        updatedAt: num(p.updatedAt),
        source: str(p.source),
      },
      e.lngLat,
    );
  };
  const onOfficial = (e: MarkerClickEvent): void => {
    const p = e.features?.[0]?.properties ?? {};
    render(
      {
        kind: 'official',
        barangay: str(p.barangay) || undefined,
        note: str(p.note) || undefined,
        updatedAt: num(p.updatedAt),
        source: str(p.source),
      },
      e.lngLat,
    );
  };
  const setCursor = (c: string): void => {
    const canvas = map.getCanvas?.();
    if (canvas) canvas.style.cursor = c;
  };
  const enter = (): void => setCursor('pointer');
  const leave = (): void => setCursor('');

  map.on('click', COMMUNITY_REPORTS_LAYER_ID, onCommunity);
  map.on('click', OFFICIAL_CLOSURES_LAYER_ID, onOfficial);
  for (const id of [COMMUNITY_REPORTS_LAYER_ID, OFFICIAL_CLOSURES_LAYER_ID]) {
    map.on('mouseenter', id, enter);
    map.on('mouseleave', id, leave);
  }

  return () => {
    map.off('click', COMMUNITY_REPORTS_LAYER_ID, onCommunity);
    map.off('click', OFFICIAL_CLOSURES_LAYER_ID, onOfficial);
    for (const id of [COMMUNITY_REPORTS_LAYER_ID, OFFICIAL_CLOSURES_LAYER_ID]) {
      map.off('mouseenter', id, enter);
      map.off('mouseleave', id, leave);
    }
  };
}
