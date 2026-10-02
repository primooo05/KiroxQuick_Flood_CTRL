// src/services/reportResolution.ts
//
// Resolves community reports to the barangay that contains their coordinate,
// and applies time-based decay so stale reports stop escalating risk. Reports
// carry coordinates, a timestamp (epoch seconds), and a flood state/severity;
// they may escalate a barangay to REPORTED_FLOODING but NEVER to
// CONFIRMED_NOT_PASSABLE (that requires official confirmation).

import type { CommunityReport } from '../types/report';
import { bboxOf, pointInGeometry } from './pointInPolygon';
import {
  ncrBarangays,
  type BarangayFeature,
} from '../data/geojson/ncrBarangays';

/** How long a community report stays "recent" (seconds). Older → decayed. */
export const REPORT_TTL_SECONDS = 6 * 60 * 60; // 6 hours

/**
 * Freshness of a single community report relative to the TTL window. This is a
 * presentation-only cue so a commuter can see how current an UNCONFIRMED report
 * is — it does NOT change verification (reports stay unconfirmed) or escalation
 * (expired reports already stop escalating risk via the same TTL):
 *   - `fresh`   — within the first third of the TTL (clearly recent),
 *   - `aging`   — within the TTL but past the first third,
 *   - `expired` — older than the TTL (no longer counts toward risk).
 */
export type ReportFreshness = 'fresh' | 'aging' | 'expired';

/** Age (seconds) within which a report reads as clearly fresh (TTL/3). */
export const REPORT_FRESH_SECONDS = Math.floor(REPORT_TTL_SECONDS / 3);

/**
 * Classifies a report's freshness from its `updatedAt` (epoch seconds) against
 * {@link REPORT_TTL_SECONDS}. Pure and deterministic; `now` is injectable.
 */
export function reportFreshness(
  updatedAt: number,
  now: number = Math.floor(Date.now() / 1000),
): ReportFreshness {
  const age = Math.max(0, now - updatedAt);
  if (age > REPORT_TTL_SECONDS) return 'expired';
  if (age <= REPORT_FRESH_SECONDS) return 'fresh';
  return 'aging';
}

/** Short commuter-facing label for a report freshness state. */
export function reportFreshnessLabel(freshness: ReportFreshness): string {
  switch (freshness) {
    case 'fresh':
      return 'Fresh report';
    case 'aging':
      return 'Aging report';
    case 'expired':
      return 'Expired — no longer counted';
  }
}

/** A barangay feature paired with its precomputed bounding box. */
interface IndexedBarangay {
  readonly feature: BarangayFeature;
  readonly bbox: [number, number, number, number];
}

/** Barangay features indexed with bounding boxes for fast containment tests. */
const INDEXED: readonly IndexedBarangay[] = ncrBarangays.features.map((f) => ({
  feature: f,
  bbox: bboxOf(f.geometry),
}));

/**
 * Resolves a coordinate to the PSGC of the containing barangay, or `null` when
 * the point is outside NCR. Uses a bounding-box pre-filter before the exact
 * point-in-polygon test.
 */
export function resolveBarangayForPoint(lng: number, lat: number): string | null {
  for (const { feature, bbox } of INDEXED) {
    if (lng < bbox[0] || lng > bbox[2] || lat < bbox[1] || lat > bbox[3]) {
      continue;
    }
    if (pointInGeometry(lng, lat, feature.geometry)) {
      return feature.properties.psgc;
    }
  }
  return null;
}

/** The most severe report state (RED > ORANGE > YELLOW), ignoring GREEN/GRAY. */
type ActiveReportState = 'RED' | 'ORANGE' | 'YELLOW';

function severityRank(state: ActiveReportState): number {
  return { YELLOW: 1, ORANGE: 2, RED: 3 }[state];
}

/** Aggregated, non-decayed community-report signal for one barangay. */
export interface BarangayReportSignal {
  readonly count: number;
  readonly worst: ActiveReportState | null;
}

/**
 * Buckets community reports by barangay, keeping only reports that are NOT
 * expired (within {@link REPORT_TTL_SECONDS} of `now`) and whose state is an
 * active concern (RED/ORANGE/YELLOW). Returns a PSGC → aggregated signal map.
 *
 * @param reports - Community reports (each with a coordinate + updatedAt).
 * @param now - Reference time (epoch seconds). Defaults to wall clock.
 */
export function aggregateReportsByBarangay(
  reports: readonly CommunityReport[],
  now: number = Math.floor(Date.now() / 1000),
): Map<string, BarangayReportSignal> {
  const byBarangay = new Map<string, BarangayReportSignal>();

  for (const report of reports) {
    const { state, metadata } = report;
    if (state !== 'RED' && state !== 'ORANGE' && state !== 'YELLOW') continue;
    // Decay: skip reports older than the TTL.
    if (now - metadata.updatedAt > REPORT_TTL_SECONDS) continue;

    const psgc = resolveBarangayForPoint(
      metadata.location.lng,
      metadata.location.lat,
    );
    if (!psgc) continue;

    const prev = byBarangay.get(psgc);
    const worst =
      prev?.worst && severityRank(prev.worst) >= severityRank(state)
        ? prev.worst
        : state;
    byBarangay.set(psgc, { count: (prev?.count ?? 0) + 1, worst });
  }

  return byBarangay;
}
