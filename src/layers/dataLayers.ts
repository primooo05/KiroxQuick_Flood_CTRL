/// <reference types="geojson" />
// src/layers/dataLayers.ts
//
// Per-category DataLayer implementations backed by the isolated demo fixtures
// in `src/data/fixtures`. Each LayerId gets a concrete DataLayer<TItem> whose:
//
//   - `meta` carries a human label, `isDemo: true`, and a sensible
//     `defaultVisible` (design → "DataLayer interface abstraction", Req 15.1,
//     15.2, 15.4).
//   - `load()` validates every fixture item and SKIPS malformed ones without
//     throwing, counting them in `skipped` (Req 18.2).
//   - `toGeoJSON(items)` projects items to a GeoJSON FeatureCollection; an
//     empty input list yields a well-formed empty collection (Req 18.3).
//
// Labels here are plain human text describing the demo fixture category. They
// are NOT AI-generated and do NOT invent authoritative flood APIs (Req 15.5).

import type {
  DataLayer,
  DataLayerMeta,
  LayerId,
  LoadResult,
} from '../types/layer';
import type {
  FloodReport,
  FloodSusceptibility,
  GeoLocation,
} from '../types/flood';
import type { CommunityReport } from '../types/report';
import type { Route, RouteFloodSegment } from '../types/route';
import type { EvacuationCenter } from '../types/evacuation';

import { validateFloodMetadata } from './floodClassification';

import {
  boundaryFixtures,
  type BoundaryFeature,
} from '../data/fixtures/boundaries';
import { floodSusceptibilityFixtures } from '../data/fixtures/floodSusceptibility';
import {
  cityFloodSusceptibilityFixtures,
  type CitySusceptibilitySummary,
} from '../data/fixtures/cityFloodSusceptibility';
import { floodReportFixtures } from '../data/fixtures/floodReports';
import { communityReportFixtures } from '../data/fixtures/communityReports';
import { routeFixtures } from '../data/fixtures/routes';
import { routeFloodSegmentFixtures } from '../data/fixtures/routeFloodSegments';
import { evacuationCenterFixtures } from '../data/fixtures/evacuationCenters';

/** A well-formed empty FeatureCollection (Req 18.3). */
function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Minimal GeoLocation shape check for geometry-only layers. */
function isValidLocation(location: unknown): location is GeoLocation {
  if (!isObject(location)) {
    return false;
  }
  return isFiniteNumber(location.lng) && isFiniteNumber(location.lat);
}

/** Minimal GeoJSON geometry shape check (has a non-empty coordinates array). */
function hasGeometry(
  value: unknown,
  expectedType: GeoJSON.GeoJsonGeometryTypes,
): boolean {
  if (!isObject(value)) {
    return false;
  }
  return value.type === expectedType && Array.isArray(value.coordinates);
}

/**
 * Shared load implementation: runs `isValid` over each candidate item, keeps
 * only the valid subset, and reports `skipped` for the rest. Never throws on a
 * malformed item — a validation predicate that throws is treated as "invalid"
 * so a single bad item can never abort the load (Req 18.2).
 */
function loadValidated<TItem>(
  candidates: readonly unknown[],
  isValid: (item: unknown) => item is TItem,
  isDemo: boolean,
): LoadResult<TItem> {
  const items: TItem[] = [];
  let skipped = 0;

  for (const candidate of candidates) {
    let valid = false;
    try {
      valid = isValid(candidate);
    } catch {
      valid = false;
    }
    if (valid) {
      items.push(candidate as TItem);
    } else {
      skipped += 1;
    }
  }

  return { items, skipped, isDemo };
}

// ---------------------------------------------------------------------------
// Per-category validators
// ---------------------------------------------------------------------------

/** Flood items (susceptibility/report/community) are gated on their metadata. */
function hasValidFloodMetadata(item: unknown): boolean {
  return (
    isObject(item) &&
    isObject(item.metadata) &&
    validateFloodMetadata(item.metadata)
  );
}

function isValidSusceptibility(item: unknown): item is FloodSusceptibility {
  if (!isObject(item) || !hasValidFloodMetadata(item)) {
    return false;
  }
  return (
    hasGeometry(item.geometry, 'Polygon') ||
    hasGeometry(item.geometry, 'MultiPolygon')
  );
}

function isValidCitySusceptibility(
  item: unknown,
): item is CitySusceptibilitySummary {
  if (!isObject(item) || !hasValidFloodMetadata(item)) {
    return false;
  }
  return (
    typeof item.cityId === 'string' &&
    typeof item.cityName === 'string' &&
    (hasGeometry(item.geometry, 'Polygon') ||
      hasGeometry(item.geometry, 'MultiPolygon'))
  );
}

function isValidFloodReport(item: unknown): item is FloodReport {
  return hasValidFloodMetadata(item);
}

function isValidCommunityReport(item: unknown): item is CommunityReport {
  return hasValidFloodMetadata(item);
}

function isValidBoundary(item: unknown): item is BoundaryFeature {
  return isObject(item) && hasGeometry(item.geometry, 'Polygon');
}

function isValidRoute(item: unknown): item is Route {
  return isObject(item) && hasGeometry(item.geometry, 'LineString');
}

function isValidRouteFloodSegment(item: unknown): item is RouteFloodSegment {
  return isObject(item) && hasGeometry(item.segment, 'LineString');
}

function isValidEvacuationCenter(item: unknown): item is EvacuationCenter {
  return isObject(item) && isValidLocation(item.location);
}

// ---------------------------------------------------------------------------
// Per-category GeoJSON projections
// ---------------------------------------------------------------------------

function floodMetadataProperties(
  metadata: FloodReport['metadata'],
): GeoJSON.GeoJsonProperties {
  // Downstream popups/tests read source and updatedAt off feature properties.
  return {
    source: metadata.source,
    updatedAt: metadata.updatedAt,
    dataType: metadata.dataType,
    verificationStatus: metadata.verificationStatus,
    isDemo: true,
  };
}

function pointFeature(
  location: GeoLocation,
  id: string,
  properties: GeoJSON.GeoJsonProperties,
): GeoJSON.Feature {
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: [location.lng, location.lat] },
    properties,
  };
}

// ---------------------------------------------------------------------------
// DataLayer factory
// ---------------------------------------------------------------------------

interface LayerConfig<TItem> {
  id: LayerId;
  label: string;
  defaultVisible: boolean;
  fixtures: readonly unknown[];
  isValid: (item: unknown) => item is TItem;
  project: (items: TItem[]) => GeoJSON.Feature[];
}

function makeLayer<TItem>(config: LayerConfig<TItem>): DataLayer<TItem> {
  const meta: DataLayerMeta = {
    id: config.id,
    label: config.label,
    isDemo: true,
    defaultVisible: config.defaultVisible,
  };

  return {
    meta,
    load(): Promise<LoadResult<TItem>> {
      return Promise.resolve(
        loadValidated<TItem>(config.fixtures, config.isValid, true),
      );
    },
    toGeoJSON(items: TItem[]): GeoJSON.FeatureCollection {
      if (!Array.isArray(items) || items.length === 0) {
        return emptyFeatureCollection();
      }
      return { type: 'FeatureCollection', features: config.project(items) };
    },
  };
}

// ---------------------------------------------------------------------------
// The seven per-category DataLayers
// ---------------------------------------------------------------------------

export const boundariesLayer: DataLayer<BoundaryFeature> = makeLayer({
  id: 'boundaries',
  label: 'NCR jurisdiction boundaries (demo)',
  defaultVisible: true,
  fixtures: boundaryFixtures,
  isValid: isValidBoundary,
  project: (items) =>
    items.map((b) => ({
      type: 'Feature',
      id: b.id,
      geometry: b.geometry,
      properties: { name: b.name, isDemo: true, source: b.source },
    })),
});

export const floodSusceptibilityLayer: DataLayer<FloodSusceptibility> =
  makeLayer({
    id: 'floodSusceptibility',
    label: 'Baseline Flood Susceptibility (historical, demo)',
    defaultVisible: true,
    fixtures: floodSusceptibilityFixtures,
    isValid: isValidSusceptibility,
    project: (items) =>
      items.map((s) => ({
        type: 'Feature',
        id: s.id,
        geometry: s.geometry,
        properties: {
          level: s.level,
          ...floodMetadataProperties(s.metadata),
        },
      })),
  });

export const cityFloodSummaryLayer: DataLayer<CitySusceptibilitySummary> =
  makeLayer({
    id: 'cityFloodSummary',
    label: 'Baseline Flood Susceptibility — city summary (historical)',
    defaultVisible: true,
    fixtures: cityFloodSusceptibilityFixtures,
    isValid: isValidCitySusceptibility,
    project: (items) =>
      items.map((c) => ({
        type: 'Feature',
        id: c.cityId,
        geometry: c.geometry,
        properties: {
          level: c.level,
          // `name` doubles as the popup "Area" label (the city name).
          name: c.cityName,
          cityName: c.cityName,
          ...floodMetadataProperties(c.metadata),
        },
      })),
  });

export const floodReportsLayer: DataLayer<FloodReport> = makeLayer({
  id: 'floodReports',
  label: 'Flood reports (current/recent, demo)',
  defaultVisible: false,
  fixtures: floodReportFixtures,
  isValid: isValidFloodReport,
  project: (items) =>
    items.map((r) =>
      pointFeature(r.metadata.location, r.id, {
        state: r.state,
        passable: r.passable ?? null,
        ...floodMetadataProperties(r.metadata),
      }),
    ),
});

export const communityReportsLayer: DataLayer<CommunityReport> = makeLayer({
  id: 'communityReports',
  label: 'Community reports (unconfirmed, demo)',
  defaultVisible: false,
  fixtures: communityReportFixtures,
  isValid: isValidCommunityReport,
  project: (items) =>
    items.map((c) =>
      pointFeature(c.metadata.location, c.id, {
        state: c.state,
        passable: c.passable ?? null,
        ...floodMetadataProperties(c.metadata),
      }),
    ),
});

export const routesLayer: DataLayer<Route> = makeLayer({
  id: 'routes',
  label: 'Routes (demo geometry)',
  defaultVisible: false,
  fixtures: routeFixtures,
  isValid: isValidRoute,
  project: (items) =>
    items.map((r) => ({
      type: 'Feature',
      id: r.id,
      geometry: r.geometry,
      properties: { label: r.label, isDemo: true },
    })),
});

export const routeFloodSegmentsLayer: DataLayer<RouteFloodSegment> = makeLayer({
  id: 'routeFloodSegments',
  label: 'Route flood segments (demo)',
  defaultVisible: false,
  fixtures: routeFloodSegmentFixtures,
  isValid: isValidRouteFloodSegment,
  project: (items) =>
    items.map((seg, index) => ({
      type: 'Feature',
      id: `${seg.routeId}-segment-${index}`,
      geometry: seg.segment,
      properties: { routeId: seg.routeId, state: seg.state, isDemo: true },
    })),
});

export const evacuationCentersLayer: DataLayer<EvacuationCenter> = makeLayer({
  id: 'evacuationCenters',
  label: 'Evacuation centers (demo)',
  defaultVisible: false,
  fixtures: evacuationCenterFixtures,
  isValid: isValidEvacuationCenter,
  project: (items) =>
    items.map((e) =>
      pointFeature(e.location, e.id, {
        name: e.name,
        description: e.description,
        isDemo: true,
      }),
    ),
});

/**
 * All FIXTURE-backed DataLayers keyed by LayerId. `FixtureDataSource` reads this
 * registry. It is a Partial because some LayerIds (e.g. `barangayFloodRisk`,
 * `officialClosures`) are app-managed live/derived layers, not fixture layers,
 * and therefore have no entry here.
 */
export const fixtureLayers: Partial<Record<LayerId, DataLayer<unknown>>> = {
  boundaries: boundariesLayer as DataLayer<unknown>,
  cityFloodSummary: cityFloodSummaryLayer as DataLayer<unknown>,
  floodSusceptibility: floodSusceptibilityLayer as DataLayer<unknown>,
  floodReports: floodReportsLayer as DataLayer<unknown>,
  communityReports: communityReportsLayer as DataLayer<unknown>,
  routes: routesLayer as DataLayer<unknown>,
  routeFloodSegments: routeFloodSegmentsLayer as DataLayer<unknown>,
  evacuationCenters: evacuationCentersLayer as DataLayer<unknown>,
};

/** The complete, ordered list of LayerIds this source provides. */
export const ALL_LAYER_IDS: readonly LayerId[] = [
  'boundaries',
  'cityFloodSummary',
  'floodSusceptibility',
  'floodReports',
  'communityReports',
  'routes',
  'routeFloodSegments',
  'evacuationCenters',
];

// Re-exported helpers so tests can exercise the validate/project path directly.
export {
  loadValidated,
  emptyFeatureCollection,
  isValidSusceptibility,
  isValidCitySusceptibility,
  isValidFloodReport,
  isValidCommunityReport,
  isValidBoundary,
  isValidRoute,
  isValidRouteFloodSegment,
  isValidEvacuationCenter,
};
