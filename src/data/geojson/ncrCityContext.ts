/// <reference types="geojson" />
// src/data/geojson/ncrCityContext.ts
//
// The Metro Manila (NCR) City/LGU CONTEXT dataset — one geometry per LGU, used
// for BahaRoute's own city boundary + label layers so city names stay readable
// regardless of Mapbox basemap label collision.
//
// SOURCE (reused, not a new dataset):
//   The 17 real administrative LGU boundaries already stored locally in
//   `metroManilaCityBoundaries.geojson` (source: rolex-esto/roberto
//   `city_boundaries.geojson`, adapted). Each feature carries `city_norm`; the
//   explicit table in `cityNameNormalization.ts` maps that to a stable
//   BahaRoute city id + display name. We pair each boundary with a precomputed
//   LABEL POINT here (once, at module load — never per render), plus the ADM3
//   city PSGC used by the barangay dataset so future code can aggregate barangay
//   current-risk states per city WITHOUT a separate city risk model.
//
// This module derives everything at load time from data already in the repo; it
// introduces no new external dataset and draws no boundaries by hand.

import {
  metroManilaCityBoundaries,
  type CityBoundaryFeature,
} from './metroManilaCityBoundaries';
import { normalizeCityNorm } from './cityNameNormalization';

/**
 * BahaRoute city id → ADM3 city PSGC (matches `properties.cityPsgc` in the
 * barangay dataset). Explicit so a dataset drift fails loudly. This is the join
 * key for future per-city aggregation of barangay results.
 */
const CITY_ID_TO_PSGC: Readonly<Record<string, string>> = {
  caloocan: 'PH1307501',
  'las-pinas': 'PH1307601',
  makati: 'PH1307602',
  malabon: 'PH1307502',
  mandaluyong: 'PH1307401',
  manila: 'PH1303901',
  marikina: 'PH1307402',
  muntinlupa: 'PH1307603',
  navotas: 'PH1307503',
  paranaque: 'PH1307604',
  pasig: 'PH1307403',
  'san-juan': 'PH1307405',
  valenzuela: 'PH1307504',
  pasay: 'PH1307605',
  pateros: 'PH1307606',
  'quezon-city': 'PH1307404',
  taguig: 'PH1307607',
};

/** Properties carried by each derived City/LGU context feature. */
export interface CityContextProperties {
  /** Stable BahaRoute city id (e.g. "quezon-city"). */
  id: string;
  /** Display name (e.g. "Quezon City"). */
  name: string;
  /** ADM3 city PSGC — the join key to the barangay dataset's `cityPsgc`. */
  cityPsgc: string;
  /** Precomputed label longitude. */
  labelLng: number;
  /** Precomputed label latitude. */
  labelLat: number;
}

export type CityContextFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  CityContextProperties
>;

export type CityContextCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  CityContextProperties
>;

/** Signed area (shoelace) of a linear ring. */
function ringArea(ring: GeoJSON.Position[]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return a / 2;
}

/** Area-weighted centroid of a single ring. */
function ringCentroid(ring: GeoJSON.Position[]): [number, number, number] {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-12) {
    // Degenerate ring: fall back to the vertex average.
    const n = ring.length || 1;
    let sx = 0;
    let sy = 0;
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
    }
    return [sx / n, sy / n, 0];
  }
  return [cx / (6 * a), cy / (6 * a), Math.abs(a)];
}

/**
 * A representative LABEL POINT for a city: the centroid of its LARGEST outer
 * ring (by absolute area). Using the largest ring keeps the label inside the
 * mainland body for MultiPolygon LGUs (e.g. Caloocan, Las Piñas) rather than
 * drifting toward a detached islet or the bounding-box center.
 */
function labelPointFor(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): [number, number] {
  const outerRings =
    geometry.type === 'Polygon'
      ? [geometry.coordinates[0]]
      : geometry.coordinates.map((poly) => poly[0]);
  let best: [number, number] = [0, 0];
  let bestArea = -1;
  for (const ring of outerRings) {
    if (!ring || ring.length < 4) continue;
    const [cx, cy] = ringCentroid(ring);
    const area = Math.abs(ringArea(ring));
    if (area > bestArea) {
      bestArea = area;
      best = [cx, cy];
    }
  }
  const round = (n: number): number => Math.round(n * 1e5) / 1e5;
  return [round(best[0]), round(best[1])];
}

/**
 * Builds the 17 NCR City/LGU context features from the real boundary geometry.
 * Fails LOUDLY if a `city_norm` cannot be normalized or a city has no PSGC — so
 * coverage stays honest and no LGU is silently dropped.
 */
function buildCityContext(): CityContextCollection {
  const features = metroManilaCityBoundaries.features as CityBoundaryFeature[];

  const out: CityContextFeature[] = features.map((feature) => {
    const cityNorm = feature.properties?.city_norm;
    if (typeof cityNorm !== 'string' || cityNorm.trim() === '') {
      throw new Error('ncrCityContext: boundary feature missing "city_norm".');
    }
    const city = normalizeCityNorm(cityNorm);
    if (!city) {
      throw new Error(`ncrCityContext: unknown city_norm "${cityNorm}".`);
    }
    const cityPsgc = CITY_ID_TO_PSGC[city.id];
    if (!cityPsgc) {
      throw new Error(
        `ncrCityContext: no PSGC mapped for city "${city.name}" (id "${city.id}").`,
      );
    }
    const [labelLng, labelLat] = labelPointFor(feature.geometry);
    return {
      type: 'Feature',
      id: city.id,
      geometry: feature.geometry,
      properties: { id: city.id, name: city.name, cityPsgc, labelLng, labelLat },
    };
  });

  return { type: 'FeatureCollection', features: out };
}

/** The 17 NCR City/LGU context features (boundary geometry + label metadata). */
export const ncrCityContext: CityContextCollection = buildCityContext();

/** A lightweight, render-free view of one LGU. */
export interface CityInfo {
  readonly id: string;
  readonly name: string;
  readonly cityPsgc: string;
  readonly labelPoint: readonly [number, number];
}

/** The 17 LGUs as lightweight records, in the source order. */
export const ncrCityInfos: readonly CityInfo[] = ncrCityContext.features.map(
  (f) => ({
    id: f.properties.id,
    name: f.properties.name,
    cityPsgc: f.properties.cityPsgc,
    labelPoint: [f.properties.labelLng, f.properties.labelLat] as const,
  }),
);

/** cityPsgc → CityInfo, the join key used for future per-city aggregation. */
export const cityInfoByPsgc: ReadonlyMap<string, CityInfo> = new Map(
  ncrCityInfos.map((c) => [c.cityPsgc, c] as const),
);
