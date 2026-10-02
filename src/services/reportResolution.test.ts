// src/services/reportResolution.test.ts
import { describe, expect, it } from 'vitest';
import {
  REPORT_TTL_SECONDS,
  aggregateReportsByBarangay,
  resolveBarangayForPoint,
} from './reportResolution';
import type { CommunityReport } from '../types/report';
import { ncrBarangayInfos } from '../data/geojson/ncrBarangays';

const NOW = 1_800_000_000;

function report(
  lng: number,
  lat: number,
  state: CommunityReport['state'],
  updatedAt = NOW,
): CommunityReport {
  return {
    id: `r-${lng}-${lat}`,
    state,
    metadata: {
      location: { lng, lat },
      source: 'test',
      dataType: 'COMMUNITY_REPORT',
      updatedAt,
      verificationStatus: 'UNCONFIRMED',
    },
  };
}

describe('resolveBarangayForPoint', () => {
  it('resolves a barangay centroid to that barangay', () => {
    const b = ncrBarangayInfos[0];
    const psgc = resolveBarangayForPoint(b.centroid[0], b.centroid[1]);
    // The centroid should fall within its own polygon for most barangays.
    expect(psgc).toBe(b.psgc);
  });

  it('returns null for a point far outside NCR', () => {
    expect(resolveBarangayForPoint(0, 0)).toBeNull();
  });
});

describe('aggregateReportsByBarangay', () => {
  it('buckets active reports by barangay and keeps the worst state', () => {
    const b = ncrBarangayInfos[0];
    const [lng, lat] = b.centroid;
    const map = aggregateReportsByBarangay(
      [report(lng, lat, 'YELLOW'), report(lng, lat, 'RED')],
      NOW,
    );
    expect(map.get(b.psgc)?.count).toBe(2);
    expect(map.get(b.psgc)?.worst).toBe('RED');
  });

  it('decays reports older than the TTL', () => {
    const b = ncrBarangayInfos[0];
    const [lng, lat] = b.centroid;
    const stale = report(lng, lat, 'RED', NOW - REPORT_TTL_SECONDS - 10);
    const map = aggregateReportsByBarangay([stale], NOW);
    expect(map.has(b.psgc)).toBe(false);
  });

  it('ignores GREEN/GRAY (non-active) states', () => {
    const b = ncrBarangayInfos[0];
    const [lng, lat] = b.centroid;
    const map = aggregateReportsByBarangay([report(lng, lat, 'GRAY')], NOW);
    expect(map.size).toBe(0);
  });
});

import {
  reportFreshness,
  reportFreshnessLabel,
  REPORT_FRESH_SECONDS,
} from './reportResolution';

describe('reportFreshness (presentation-only TTL cue)', () => {
  it('is fresh within the first third of the TTL window', () => {
    expect(reportFreshness(NOW - 60, NOW)).toBe('fresh');
    expect(reportFreshness(NOW - REPORT_FRESH_SECONDS, NOW)).toBe('fresh');
  });

  it('is aging past the first third but within the TTL', () => {
    expect(reportFreshness(NOW - (REPORT_FRESH_SECONDS + 60), NOW)).toBe('aging');
    expect(reportFreshness(NOW - (REPORT_TTL_SECONDS - 60), NOW)).toBe('aging');
  });

  it('is expired once older than the TTL', () => {
    expect(reportFreshness(NOW - (REPORT_TTL_SECONDS + 60), NOW)).toBe('expired');
  });

  it('labels never claim verification or safety', () => {
    for (const f of ['fresh', 'aging', 'expired'] as const) {
      const label = reportFreshnessLabel(f).toLowerCase();
      expect(label).not.toContain('confirmed');
      expect(label).not.toContain('verified');
      expect(label).not.toContain('safe');
    }
  });
});
