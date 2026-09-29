// src/services/barangayRiskModel.ts
//
// Assembles the per-barangay CURRENT risk from all inputs — estimated rainfall,
// historical baseline susceptibility, recent community reports, and official
// confirmations — using the transparent pure model in `barangayRisk.ts`.
//
// This is the single place that combines the data streams into a PSGC →
// assessment map the map layer and info panel consume. It holds no rendering
// concerns and does no I/O.

import type { OfficialStatus, BarangayRiskAssessment } from '../types/risk';
import type { RainfallSample } from '../types/risk';
import type { CommunityReport } from '../types/report';
import { assessBarangayRisk } from './barangayRisk';
import { baselineSusceptibilityByBarangay } from './baselineSusceptibility';
import { ncrBarangayInfos } from '../data/geojson/ncrBarangays';
import { aggregateReportsByBarangay } from './reportResolution';

/** Inputs to a full-NCR assessment pass. All optional; missing → LOW/unknown. */
export interface AssessmentContext {
  /** PSGC → latest estimated rainfall sample (from RainfallService). */
  readonly rainfallByBarangay?: ReadonlyMap<string, RainfallSample>;
  /** Recent community reports (resolved to barangays internally). */
  readonly reports?: readonly CommunityReport[];
  /** Official confirmations (only source of CONFIRMED_NOT_PASSABLE). */
  readonly officials?: readonly OfficialStatus[];
  /** Reference time (epoch seconds). Defaults to wall clock. */
  readonly now?: number;
}

/**
 * Computes a fresh assessment for every NCR barangay. Iterates the precomputed
 * barangay list (no geometry work) and applies the pure model per barangay.
 *
 * @returns PSGC → {@link BarangayRiskAssessment}.
 */
export function assessAllBarangays(
  context: AssessmentContext = {},
): Map<string, BarangayRiskAssessment> {
  const now = context.now ?? Math.floor(Date.now() / 1000);
  const reportSignals = aggregateReportsByBarangay(context.reports ?? [], now);
  const officialByPsgc = new Map(
    (context.officials ?? []).map((o) => [o.psgc, o] as const),
  );

  const out = new Map<string, BarangayRiskAssessment>();
  for (const b of ncrBarangayInfos) {
    const rainfall = context.rainfallByBarangay?.get(b.psgc) ?? null;
    const baseline = baselineSusceptibilityByBarangay.get(b.psgc) ?? null;
    const signal = reportSignals.get(b.psgc);
    const official = officialByPsgc.get(b.psgc) ?? null;

    out.set(
      b.psgc,
      assessBarangayRisk(
        b.psgc,
        {
          rainfall,
          baselineSusceptibility: baseline,
          recentReportCount: signal?.count ?? 0,
          reportState: signal?.worst ?? null,
          official,
        },
        now,
      ),
    );
  }
  return out;
}
