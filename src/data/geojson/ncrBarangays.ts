/// <reference types="geojson" />
// src/data/geojson/ncrBarangays.ts
//
// Typed loader for the LOCAL NCR (Metro Manila) barangay-boundary GeoJSON asset.
//
// PROVENANCE:
//   Source = bendlikeabamboo/barangay-boundaries-repository release
//   v2026.4.13.0 `barangays.geojson` (snapshot 2023-10-24), which enriches
//   NAMRIA administrative boundaries with PSA PSGC codes. The full national
//   dataset (~42,000 barangays, 64 MB) was FILTERED at build-prep time to the
//   1,710 NCR barangays (region PSGC `PH13`), TRIMMED to the fields BahaRoute
//   needs, had each polygon's coordinates rounded to 5 decimals (~1 m) and a
//   representative CENTROID precomputed, then STORED LOCALLY here as
//   `ncrBarangays.geojson` (~0.5 MB). It is read at BUILD TIME (Vite `?raw`
//   import + JSON.parse) — BahaRoute never fetches barangay geometry from
//   GitHub or any network endpoint at runtime, and never loads the whole
//   Philippines into the active map.
//
//   Data © Philippine Statistics Authority (PSGC) and NAMRIA, redistributed by
//   the source repository. These are administrative boundaries only.
//
// IMPORTANT — ADMINISTRATIVE geometry, NOT flood data:
//   A barangay polygon is an administrative boundary. On its own it says
//   nothing about flooding. Current flood RISK is computed separately (see
//   `src/services/barangayRisk.ts`) and painted onto these polygons via Mapbox
//   feature-state; the geometry is just the canvas.

import rawBarangays from './ncrBarangays.geojson?raw';

/**
 * Trimmed per-barangay properties carried by the local NCR asset. `psgc` is the
 * stable primary key (PSGC / ADM4 pcode). `cLng`/`cLat` are the PRECOMPUTED
 * representative centroid used for rainfall sampling — no runtime centroid math
 * or per-frame geometry scans are required.
 */
export interface BarangayProperties {
  /** Stable barangay PSGC code (ADM4 pcode), e.g. "PH1303901001". Primary key. */
  psgc: string;
  /** Barangay display name, e.g. "Barangay 1". */
  brgy: string;
  /** City / municipality display name, e.g. "City of Manila". */
  city: string;
  /** City / municipality PSGC code (ADM3 pcode). */
  cityPsgc: string;
  /** Precomputed representative centroid longitude. */
  cLng: number;
  /** Precomputed representative centroid latitude. */
  cLat: number;
}

export type BarangayFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  BarangayProperties
>;

export type BarangayCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  BarangayProperties
>;

/**
 * The parsed local NCR barangay dataset. Parsed once at module load. The `?raw`
 * import + JSON.parse approach builds cleanly under both Vite and vitest
 * (jsdom) without special asset plugins.
 */
export const ncrBarangays: BarangayCollection = JSON.parse(
  rawBarangays,
) as BarangayCollection;

/** A lightweight, render-free view of a barangay used across services. */
export interface BarangayInfo {
  /** Stable barangay PSGC code — primary key everywhere in the app. */
  readonly psgc: string;
  /** Barangay display name. */
  readonly name: string;
  /** City / municipality display name. */
  readonly city: string;
  /** City / municipality PSGC code. */
  readonly cityPsgc: string;
  /** Precomputed representative centroid `[lng, lat]` (rainfall sampling). */
  readonly centroid: readonly [number, number];
}

/**
 * The 1,710 NCR barangays as lightweight {@link BarangayInfo} records, in the
 * asset's stable order. This is what the rainfall service and risk model
 * iterate over — they never touch geometry.
 */
export const ncrBarangayInfos: readonly BarangayInfo[] = ncrBarangays.features.map(
  (f) => ({
    psgc: f.properties.psgc,
    name: f.properties.brgy,
    city: f.properties.city,
    cityPsgc: f.properties.cityPsgc,
    centroid: [f.properties.cLng, f.properties.cLat] as const,
  }),
);

/** A PSGC → {@link BarangayInfo} lookup for O(1) resolution by id. */
export const barangayInfoByPsgc: ReadonlyMap<string, BarangayInfo> = new Map(
  ncrBarangayInfos.map((b) => [b.psgc, b] as const),
);
