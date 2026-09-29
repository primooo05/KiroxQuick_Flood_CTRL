// src/services/baselineSusceptibility.ts
//
// Bridges each NCR barangay to a BASELINE (historical/modeled) susceptibility
// class, reusing the existing per-city demo susceptibility summary as the
// source of truth. This is deliberately SEPARATE from current risk: the value
// here is historical exposure only and is surfaced alongside — never merged
// into — the computed current risk.
//
// The existing city susceptibility fixtures are keyed by BahaRoute city id
// (e.g. "quezon-city"); the barangay dataset carries the PSGC city code
// (ADM3 pcode, e.g. "PH1307404"). This module maps barangay cityPsgc → city id
// → susceptibility level so no susceptibility data is duplicated.

import type { SusceptibilityLevel } from '../types/flood';
import { cityFloodSusceptibilityFixtures } from '../data/fixtures/cityFloodSusceptibility';
import { ncrBarangayInfos } from '../data/geojson/ncrBarangays';

/**
 * Maps the barangay dataset's ADM3 city PSGC code to the BahaRoute city id used
 * by the existing city susceptibility fixtures. Explicit (no string munging)
 * so it fails loudly if the datasets drift.
 */
const CITY_PSGC_TO_CITY_ID: Readonly<Record<string, string>> = {
  PH1307501: 'caloocan',
  PH1307601: 'las-pinas',
  PH1307602: 'makati',
  PH1307502: 'malabon',
  PH1307401: 'mandaluyong',
  PH1303901: 'manila',
  PH1307402: 'marikina',
  PH1307603: 'muntinlupa',
  PH1307503: 'navotas',
  PH1307604: 'paranaque',
  PH1307403: 'pasig',
  PH1307405: 'san-juan',
  PH1307504: 'valenzuela',
  PH1307605: 'pasay',
  PH1307606: 'pateros',
  PH1307404: 'quezon-city',
  PH1307607: 'taguig',
};

/** city id → modeled susceptibility level, from the existing city fixtures. */
const CITY_ID_TO_LEVEL: ReadonlyMap<string, SusceptibilityLevel> = new Map(
  cityFloodSusceptibilityFixtures.map((c) => [c.cityId, c.level] as const),
);

/**
 * Resolves the baseline (historical) susceptibility level for a barangay by its
 * city PSGC code. Returns `null` when the city is unmapped (degrades to an
 * unknown baseline rather than throwing, so a data drift never breaks the map).
 */
export function baselineSusceptibilityForCityPsgc(
  cityPsgc: string,
): SusceptibilityLevel | null {
  const cityId = CITY_PSGC_TO_CITY_ID[cityPsgc];
  if (!cityId) return null;
  return CITY_ID_TO_LEVEL.get(cityId) ?? null;
}

/**
 * A PSGC(barangay) → baseline susceptibility lookup, precomputed once for all
 * 1,710 NCR barangays. Every barangay in a mapped city inherits that city's
 * modeled susteptibility class as its historical baseline.
 */
export const baselineSusceptibilityByBarangay: ReadonlyMap<
  string,
  SusceptibilityLevel | null
> = new Map(
  ncrBarangayInfos.map(
    (b) =>
      [b.psgc, baselineSusceptibilityForCityPsgc(b.cityPsgc)] as const,
  ),
);
