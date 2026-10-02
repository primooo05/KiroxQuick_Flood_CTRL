// src/data/historical/ncrHistoricalFloodRisk.ts
//
// Typed loader for the DERIVED per-barangay HISTORICAL flood-risk dataset and
// the per-city (LGU) summary. This is HISTORICAL / MODELED susceptibility —
// deliberately SEPARATE from the CURRENT flood-risk pipeline (rainfall → risk).
// A barangay may be historically HIGH while its current risk is LOW, and vice
// versa; the two are never merged (see docs/FLOOD_SEMANTICS.md).
//
// PROVENANCE:
//   Derived offline (data-processing/build_historical_flood_risk.py) by spatial
//   intersection of NCR barangay boundaries (PSA/NAMRIA + PSGC) with Project
//   NOAH / Phil-LiDAR flood-hazard polygons (bettergovph Hugging Face archive,
//   ODbL) at ~10 m resolution, per 5/25/100-year rainfall return period. The
//   100-year return period is the shipped default. Values are TRANSPARENTLY
//   DERIVED, never fabricated; a barangay with no mapped hazard coverage is
//   `Unknown`, NEVER silently `Low`. See README + docs/HISTORICAL_FLOOD_RISK.md.

import rawBarangay from './ncrBarangayHistoricalFloodRisk.json?raw';
import rawCity from './ncrCityHistoricalFloodSummary.json?raw';

/** The derived BahaRoute historical-risk class. Distinct from CurrentRiskLevel. */
export type HistoricalRiskClass = 'Low' | 'Moderate' | 'High' | 'Unknown';

/** Source hazard depth class (Phil-LiDAR), preserved separately from the derived class. */
export type SourceHazardClass = 'Low' | 'Medium' | 'High' | 'None';

/** Per-barangay historical flood-risk record (compact runtime shape). */
export interface BarangayHistoricalRisk {
  readonly psgc: string;
  readonly name: string;
  readonly city: string;
  readonly cityPsgc: string;
  /** % of barangay area in Low-depth (0–0.5 m) hazard. */
  readonly pctLow: number;
  /** % of barangay area in Medium-depth (0.5–1.5 m) hazard. */
  readonly pctMedium: number;
  /** % of barangay area in High-depth (>1.5 m) hazard. */
  readonly pctHigh: number;
  /** % of barangay area with no mapped hazard. */
  readonly pctNoHazard: number;
  /** Total area in any hazard zone (km²). */
  readonly exposedAreaKm2: number;
  /** Source hazard class covering the largest area share. */
  readonly dominantHazard: SourceHazardClass;
  /** Highest source hazard class present anywhere in the barangay. */
  readonly maxHazard: SourceHazardClass;
  /** The derived BahaRoute class (documented rule; Unknown = no coverage). */
  readonly historicalRiskClass: HistoricalRiskClass;
  /** Return period of the shipped metrics (default "100yr"). */
  readonly returnPeriod: string;
  /** Confidence rating (resolution + vintage aware). */
  readonly confidence: 'High' | 'Medium' | 'Low';
  /** Dataset name + version. */
  readonly source: string;
  /** Year of source data production. */
  readonly sourceYear: number;
}

/** Per-city (LGU) aggregate summary, derived from the barangay dataset. */
export interface CityHistoricalSummary {
  readonly cityName: string;
  readonly cityPsgc: string;
  readonly regionCode: string;
  readonly barangayCount: number;
  readonly lowCount: number;
  readonly moderateCount: number;
  readonly highCount: number;
  readonly unknownCount: number;
  readonly totalExposedAreaKm2: number;
  readonly areaWeightedPctLow: number;
  readonly areaWeightedPctMedium: number;
  readonly areaWeightedPctHigh: number;
  readonly dominantHistoricalRiskClass: HistoricalRiskClass;
  readonly source: string;
  readonly sourceYear: number;
  readonly returnPeriod: string;
}

/** Dataset-level provenance metadata surfaced in the UI/attribution. */
export interface HistoricalDatasetMeta {
  readonly regionCode: string;
  readonly source: string;
  readonly sourceYear: number;
  readonly license: string;
  readonly returnPeriod: string;
  readonly returnPeriodsAvailable: readonly string[];
  readonly classificationRule: string;
}

interface RawBarangayFile {
  region_code: string;
  source: string;
  source_year: number;
  license: string;
  return_period: string;
  return_periods_available: string[];
  classification_rule: string;
  barangays: Record<string, Omit<BarangayHistoricalRisk, 'psgc'>>;
}

interface RawCityFile {
  region_code: string;
  source: string;
  source_year: number;
  license: string;
  return_period: string;
  cities: Array<{
    city_name: string;
    city_psgc: string;
    region_code: string;
    barangay_count: number;
    low_count: number;
    moderate_count: number;
    high_count: number;
    unknown_count: number;
    total_exposed_area_km2: number;
    area_weighted_pct_low: number;
    area_weighted_pct_medium: number;
    area_weighted_pct_high: number;
    dominant_historical_risk_class: HistoricalRiskClass;
    source: string;
    source_year: number;
    return_period: string;
  }>;
}

const barangayFile = JSON.parse(rawBarangay) as RawBarangayFile;
const cityFile = JSON.parse(rawCity) as RawCityFile;

/** Dataset provenance metadata (for attribution + UI). */
export const historicalDatasetMeta: HistoricalDatasetMeta = {
  regionCode: barangayFile.region_code,
  source: barangayFile.source,
  sourceYear: barangayFile.source_year,
  license: barangayFile.license,
  returnPeriod: barangayFile.return_period,
  returnPeriodsAvailable: barangayFile.return_periods_available,
  classificationRule: barangayFile.classification_rule,
};

/** All per-barangay historical records, keyed by PSGC. */
export const historicalRiskByBarangay: ReadonlyMap<string, BarangayHistoricalRisk> =
  new Map(
    Object.entries(barangayFile.barangays).map(
      ([psgc, r]) => [psgc, { psgc, ...r }] as const,
    ),
  );

/** All per-barangay records as an array (stable insertion order). */
export const historicalRiskRecords: readonly BarangayHistoricalRisk[] = [
  ...historicalRiskByBarangay.values(),
];

/** Per-city summaries, keyed by city PSGC. */
export const historicalCitySummaryByPsgc: ReadonlyMap<string, CityHistoricalSummary> =
  new Map(
    cityFile.cities.map(
      (c) =>
        [
          c.city_psgc,
          {
            cityName: c.city_name,
            cityPsgc: c.city_psgc,
            regionCode: c.region_code,
            barangayCount: c.barangay_count,
            lowCount: c.low_count,
            moderateCount: c.moderate_count,
            highCount: c.high_count,
            unknownCount: c.unknown_count,
            totalExposedAreaKm2: c.total_exposed_area_km2,
            areaWeightedPctLow: c.area_weighted_pct_low,
            areaWeightedPctMedium: c.area_weighted_pct_medium,
            areaWeightedPctHigh: c.area_weighted_pct_high,
            dominantHistoricalRiskClass: c.dominant_historical_risk_class,
            source: c.source,
            sourceYear: c.source_year,
            returnPeriod: c.return_period,
          },
        ] as const,
    ),
  );

/** All city summaries as an array, sorted by city name. */
export const historicalCitySummaries: readonly CityHistoricalSummary[] = [
  ...historicalCitySummaryByPsgc.values(),
].sort((a, b) => a.cityName.localeCompare(b.cityName));

/** O(1) historical class lookup by barangay PSGC (Unknown when absent). */
export function historicalClassFor(psgc: string): HistoricalRiskClass {
  return historicalRiskByBarangay.get(psgc)?.historicalRiskClass ?? 'Unknown';
}
