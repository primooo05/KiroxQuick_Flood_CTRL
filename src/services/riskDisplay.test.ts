// src/services/riskDisplay.test.ts
//
// Phase-2 behavior: data-quality gating (UNKNOWN/STALE), freshness derivation,
// and deterministic confidence/signals from the risk engine.
import { describe, expect, it, vi } from 'vitest';
import { BarangayRiskController } from './barangayRiskController';
import { assessBarangayRisk, confidenceFor, signalsFor } from './barangayRisk';
import { dataFreshnessFor, FRESHNESS_STALE_SECONDS } from '../layers/riskLabels';
import type { FetchLike } from './rainfallService';
import type { RainfallSample, RiskInputs } from '../types/risk';
import { ncrBarangayInfos } from '../data/geojson/ncrBarangays';

const NOW = 1_800_000_000;

function sample(p: Partial<RainfallSample>): RainfallSample {
  return {
    nowMmHr: null,
    next30MmHr: null,
    next60MmHr: null,
    recentAccumMm: null,
    sampledAt: NOW,
    ...p,
  };
}
function inputs(p: Partial<RiskInputs>): RiskInputs {
  return {
    rainfall: null,
    baselineSusceptibility: null,
    recentReportCount: 0,
    reportState: null,
    official: null,
    ...p,
  };
}

describe('dataFreshnessFor', () => {
  it('null → unavailable', () => {
    expect(dataFreshnessFor(null, NOW)).toBe('unavailable');
  });
  it('recent timestamp → live', () => {
    expect(dataFreshnessFor(NOW - 30, NOW)).toBe('live');
  });
  it('past the freshness window → stale', () => {
    expect(dataFreshnessFor(NOW - FRESHNESS_STALE_SECONDS - 60, NOW)).toBe('stale');
  });
});

describe('confidenceFor (deterministic)', () => {
  it('official → verified', () => {
    expect(
      confidenceFor(
        inputs({ official: { psgc: 'x', notPassable: true, source: 'LGU', confirmedAt: NOW } }),
      ),
    ).toBe('verified');
  });
  it('no weather → none', () => {
    expect(confidenceFor(inputs({}))).toBe('none');
  });
  it('weather only → low', () => {
    expect(confidenceFor(inputs({ rainfall: sample({ nowMmHr: 5 }) }))).toBe('low');
  });
  it('weather + susceptibility → medium', () => {
    expect(
      confidenceFor(
        inputs({ rainfall: sample({ nowMmHr: 5 }), baselineSusceptibility: 'HIGH' }),
      ),
    ).toBe('medium');
  });
  it('weather + susceptibility + reports → high', () => {
    expect(
      confidenceFor(
        inputs({
          rainfall: sample({ nowMmHr: 5 }),
          baselineSusceptibility: 'HIGH',
          recentReportCount: 1,
          reportState: 'RED',
        }),
      ),
    ).toBe('high');
  });
});

describe('signalsFor (from actual signals only)', () => {
  it('includes rainfall + susceptibility bullets when present', () => {
    const s = signalsFor('heavy', 'rising', inputs({
      rainfall: sample({ nowMmHr: 20 }),
      baselineSusceptibility: 'HIGH',
    }));
    const keys = s.map((x) => x.key);
    expect(keys).toContain('rainfall');
    expect(keys).toContain('susceptibility');
    expect(keys).toContain('forecast'); // rising
  });
  it('does not fabricate report bullets when none exist', () => {
    const s = signalsFor('none', 'steady', inputs({ rainfall: sample({ nowMmHr: 0 }) }));
    expect(s.find((x) => x.key === 'reports')?.text).toMatch(/no recent flood reports/i);
  });
});

describe('assessBarangayRisk carries confidence + signals', () => {
  it('populates both fields', () => {
    const a = assessBarangayRisk('x', inputs({ rainfall: sample({ nowMmHr: 20 }) }), NOW);
    expect(a.confidence).toBe('low');
    expect(a.signals.length).toBeGreaterThan(0);
  });
});

// Controller display-risk gating -------------------------------------------

const dryFetch: FetchLike = vi.fn(async (url: string) => {
  const n = new URL(url).searchParams.get('latitude')!.split(',').length;
  return {
    ok: true,
    status: 200,
    json: async () =>
      Array.from({ length: n }, () => ({ current: { interval: 900, precipitation: 0 } })),
  };
});

async function startAndSettle(c: BarangayRiskController): Promise<void> {
  c.start();
  // Cover inter-batch throttle + one retry backoff across the grid batches.
  await new Promise((r) => setTimeout(r, 2500));
}

describe('controller display-risk gating (UNKNOWN/STALE)', () => {
  it('never loaded → panel shows UNKNOWN, not LOW', () => {
    const c = new BarangayRiskController({ fetchImpl: dryFetch });
    const info = c.infoFor(ncrBarangayInfos[0].psgc);
    expect(info!.currentRisk).toBe('UNKNOWN');
    // No fabricated rainfall value alongside "unavailable".
    expect(info!.rainfallNowMmHr).toBeNull();
  });

  it('loaded dry data → LOW with live freshness', async () => {
    const c = new BarangayRiskController({ fetchImpl: dryFetch, intervalMs: 999999 });
    await startAndSettle(c);
    c.stop();
    const info = c.infoFor(ncrBarangayInfos[0].psgc);
    expect(info!.currentRisk).toBe('LOW');
    expect(info!.freshness).toBe('live');
  });

  it('failed first fetch → status unavailable, panel UNKNOWN', async () => {
    const failing: FetchLike = vi.fn(async () => {
      throw new Error('down');
    });
    const c = new BarangayRiskController({ fetchImpl: failing, intervalMs: 999999 });
    await startAndSettle(c);
    c.stop();
    expect(c.status().dataUnavailable).toBe(true);
    expect(c.infoFor(ncrBarangayInfos[0].psgc)!.currentRisk).toBe('UNKNOWN');
  });
});
