// src/services/barangayRiskController.test.ts
import { describe, expect, it, vi } from 'vitest';
import { BarangayRiskController } from './barangayRiskController';
import type { FetchLike } from './rainfallService';
import type { CommunityReport } from '../types/report';
import { ncrBarangayInfos } from '../data/geojson/ncrBarangays';
import { officialConfirmationFixtures } from '../data/fixtures/officialConfirmations';

/** Fetch returning zero rain for however many coords were requested. */
const dryFetch: FetchLike = vi.fn(async (url: string) => {
  const n = new URL(url).searchParams.get('latitude')!.split(',').length;
  return {
    ok: true,
    status: 200,
    json: async () =>
      Array.from({ length: n }, () => ({
        current: { interval: 900, precipitation: 0 },
      })),
  };
});

/**
 * Settles the immediate async refresh triggered by start(). Waits long enough
 * to cover the inter-batch throttle + one retry backoff across the grid batches
 * (2 batches → ≤ ~2.1s worst case).
 */
async function startAndSettle(controller: BarangayRiskController): Promise<void> {
  controller.start();
  await new Promise((r) => setTimeout(r, 2500));
}

describe('BarangayRiskController.infoFor', () => {
  it('is UNKNOWN (never LOW) before any data has loaded', () => {
    const controller = new BarangayRiskController({ fetchImpl: dryFetch });
    const b = ncrBarangayInfos[0];
    const info = controller.infoFor(b.psgc);
    expect(info).not.toBeNull();
    expect(info!.barangayName).toBe(b.name);
    expect(info!.cityName).toBe(b.city);
    // No data loaded → UNKNOWN, NOT LOW (the phase-2 contradiction fix).
    expect(info!.currentRisk).toBe('UNKNOWN');
    expect(info!.freshness).toBe('unavailable');
    expect(info!.officialStatus).toBe('Not confirmed');
  });

  it('returns LOW once dry (no-rain) data has loaded', async () => {
    const controller = new BarangayRiskController({
      fetchImpl: dryFetch,
      intervalMs: 999999,
    });
    await startAndSettle(controller);
    controller.stop();
    const b = ncrBarangayInfos[0];
    const info = controller.infoFor(b.psgc);
    expect(info!.currentRisk).toBe('LOW');
    expect(info!.freshness).toBe('live');
  });

  it('returns null for an unknown PSGC', () => {
    const controller = new BarangayRiskController({ fetchImpl: dryFetch });
    expect(controller.infoFor('DOES-NOT-EXIST')).toBeNull();
  });

  it('reflects an official confirmation as CONFIRMED_NOT_PASSABLE (even before load)', () => {
    const controller = new BarangayRiskController({
      fetchImpl: dryFetch,
      officials: officialConfirmationFixtures,
    });
    const psgc = officialConfirmationFixtures[0].psgc;
    const info = controller.infoFor(psgc);
    // Official confirmation is authoritative regardless of weather freshness.
    expect(info!.currentRisk).toBe('CONFIRMED_NOT_PASSABLE');
    expect(info!.officialStatus).toContain('Confirmed closure');
    expect(info!.confidence).toBe('verified');
  });
});

describe('BarangayRiskController.addReport (community escalation)', () => {
  it('escalates a barangay to REPORTED_FLOODING from a runtime report', () => {
    const controller = new BarangayRiskController({ fetchImpl: dryFetch });
    const b = ncrBarangayInfos[0];
    const report: CommunityReport = {
      id: 'runtime-1',
      state: 'RED',
      metadata: {
        location: { lng: b.centroid[0], lat: b.centroid[1] },
        source: 'test',
        dataType: 'COMMUNITY_REPORT',
        updatedAt: Math.floor(Date.now() / 1000),
        verificationStatus: 'UNCONFIRMED',
      },
    };
    controller.addReport(report);
    expect(controller.assessmentFor(b.psgc)?.currentRisk).toBe('REPORTED_FLOODING');
  });

  it('a runtime report NEVER creates CONFIRMED_NOT_PASSABLE', () => {
    const controller = new BarangayRiskController({ fetchImpl: dryFetch });
    const b = ncrBarangayInfos[1];
    controller.addReport({
      id: 'runtime-2',
      state: 'RED',
      metadata: {
        location: { lng: b.centroid[0], lat: b.centroid[1] },
        source: 'test',
        dataType: 'COMMUNITY_REPORT',
        updatedAt: Math.floor(Date.now() / 1000),
        verificationStatus: 'UNCONFIRMED',
      },
    });
    expect(controller.assessmentFor(b.psgc)?.currentRisk).not.toBe(
      'CONFIRMED_NOT_PASSABLE',
    );
  });

  it('notifies onReportsChanged with the new report and exposes it (marker refresh seam)', () => {
    const controller = new BarangayRiskController({ fetchImpl: dryFetch });
    const b = ncrBarangayInfos[2];
    const seen: CommunityReport[][] = [];
    const unsubscribe = controller.onReportsChanged((reports) => {
      seen.push([...reports]);
    });
    const report: CommunityReport = {
      id: 'runtime-3',
      state: 'ORANGE',
      metadata: {
        location: { lng: b.centroid[0], lat: b.centroid[1] },
        source: 'test',
        dataType: 'COMMUNITY_REPORT',
        updatedAt: Math.floor(Date.now() / 1000),
        verificationStatus: 'UNCONFIRMED',
      },
    };
    controller.addReport(report);

    expect(seen).toHaveLength(1);
    expect(seen[0].some((r) => r.id === 'runtime-3')).toBe(true);
    expect(controller.communityReports().some((r) => r.id === 'runtime-3')).toBe(true);
    // The submitted report stays UNCONFIRMED (never verified/official).
    const stored = controller.communityReports().find((r) => r.id === 'runtime-3');
    expect(stored?.metadata.verificationStatus).toBe('UNCONFIRMED');

    unsubscribe();
    controller.addReport({ ...report, id: 'runtime-4' });
    // After unsubscribe the listener no longer fires.
    expect(seen).toHaveLength(1);
  });
});

describe('BarangayRiskController status fail-safe', () => {
  it('reports liveUnavailable when the fetch fails', async () => {
    const failing: FetchLike = vi.fn(async () => {
      throw new Error('down');
    });
    const controller = new BarangayRiskController({
      fetchImpl: failing,
      intervalMs: 999999,
    });
    let status = controller.status();
    const unsub = controller.onStatus((s) => {
      status = s;
    });
    // Manually run one refresh cycle via start (immediate refresh), then stop.
    controller.start();
    // allow the immediate async refresh to settle
    await new Promise((r) => setTimeout(r, 0));
    controller.stop();
    unsub();
    expect(status.dataUnavailable).toBe(true);
    expect(status.freshness).toBe('unavailable');
  });
});

describe('BarangayRiskController.repaint (source-ready reapply)', () => {
  /** A fake feature-state map recording the last risk written per PSGC. */
  function fakeFeatureStateMap() {
    const states = new Map<string, string>();
    let calls = 0;
    return {
      states,
      get calls() {
        return calls;
      },
      setFeatureState(
        target: { source: string; id: string | number },
        state: Record<string, unknown>,
      ): void {
        calls += 1;
        if (typeof state.risk === 'string') {
          states.set(String(target.id), state.risk);
        }
      },
    };
  }

  it('re-applies the latest risk snapshot verbatim (fixes the dropped-state race)', async () => {
    const controller = new BarangayRiskController({
      fetchImpl: dryFetch,
      intervalMs: 999999,
    });
    const map = fakeFeatureStateMap();
    controller.attachMap(map);
    await startAndSettle(controller);
    controller.stop();

    const b = ncrBarangayInfos[0];
    // After dry data loads, the barangay is LOW and was written to the map.
    expect(map.states.get(b.psgc)).toBe('LOW');

    // Simulate a source that dropped early writes: clear and reapply.
    map.states.clear();
    const before = map.calls;
    controller.repaint();
    expect(map.calls).toBeGreaterThan(before);
    // The exact same snapshot lands again — reapply matches the calculated state.
    expect(map.states.get(b.psgc)).toBe('LOW');
  });

  it('repaint before any paint computes and applies current state (no throw)', () => {
    const controller = new BarangayRiskController({ fetchImpl: dryFetch });
    const map = fakeFeatureStateMap();
    controller.attachMap(map);
    // No data yet → everything UNKNOWN (never LOW), and it is applied.
    map.states.clear();
    controller.repaint();
    const b = ncrBarangayInfos[0];
    expect(map.states.get(b.psgc)).toBe('UNKNOWN');
  });
});
