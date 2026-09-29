// src/services/barangayRisk.test.ts
import { describe, expect, it } from 'vitest';
import {
  assessBarangayRisk,
  rainfallBand,
  rainfallTrend,
} from './barangayRisk';
import type { RainfallSample, RiskInputs } from '../types/risk';

const NOW = 1_800_000_000;

function sample(partial: Partial<RainfallSample>): RainfallSample {
  return {
    nowMmHr: null,
    next30MmHr: null,
    next60MmHr: null,
    recentAccumMm: null,
    sampledAt: NOW,
    ...partial,
  };
}

function inputs(partial: Partial<RiskInputs>): RiskInputs {
  return {
    rainfall: null,
    baselineSusceptibility: null,
    recentReportCount: 0,
    reportState: null,
    official: null,
    ...partial,
  };
}

describe('rainfallBand', () => {
  it('classifies the reference bands', () => {
    expect(rainfallBand(null)).toBe('none');
    expect(rainfallBand(0)).toBe('none');
    expect(rainfallBand(2)).toBe('light');
    expect(rainfallBand(10)).toBe('moderate');
    expect(rainfallBand(20)).toBe('heavy');
    expect(rainfallBand(35)).toBe('intense');
  });
});

describe('rainfallTrend', () => {
  it('is unknown without both endpoints', () => {
    expect(rainfallTrend(null)).toBe('unknown');
    expect(rainfallTrend(sample({ nowMmHr: 5, next30MmHr: null }))).toBe('unknown');
  });
  it('detects rising / falling / steady', () => {
    expect(rainfallTrend(sample({ nowMmHr: 2, next30MmHr: 8 }))).toBe('rising');
    expect(rainfallTrend(sample({ nowMmHr: 8, next30MmHr: 2 }))).toBe('falling');
    expect(rainfallTrend(sample({ nowMmHr: 5, next30MmHr: 5 }))).toBe('steady');
  });
});

describe('assessBarangayRisk — separation of baseline and current', () => {
  it('HIGH baseline with NO current rain is Current Risk LOW (not a floor)', () => {
    const a = assessBarangayRisk(
      'x',
      inputs({ baselineSusceptibility: 'HIGH', rainfall: sample({ nowMmHr: 0 }) }),
      NOW,
    );
    expect(a.currentRisk).toBe('LOW');
    expect(a.baselineSusceptibility).toBe('HIGH'); // surfaced separately
  });

  it('no data at all → LOW', () => {
    expect(assessBarangayRisk('x', inputs({}), NOW).currentRisk).toBe('LOW');
  });

  it('light rain → ELEVATED', () => {
    const a = assessBarangayRisk('x', inputs({ rainfall: sample({ nowMmHr: 3 }) }), NOW);
    expect(a.currentRisk).toBe('ELEVATED');
  });

  it('heavy rain → HIGH', () => {
    const a = assessBarangayRisk('x', inputs({ rainfall: sample({ nowMmHr: 20 }) }), NOW);
    expect(a.currentRisk).toBe('HIGH');
  });

  it('intense rain → LIKELY_FLOODING (rainfall cap)', () => {
    const a = assessBarangayRisk('x', inputs({ rainfall: sample({ nowMmHr: 40 }) }), NOW);
    expect(a.currentRisk).toBe('LIKELY_FLOODING');
  });

  it('HIGH baseline nudges heavy rain up one step to LIKELY_FLOODING', () => {
    const a = assessBarangayRisk(
      'x',
      inputs({ rainfall: sample({ nowMmHr: 20 }), baselineSusceptibility: 'HIGH' }),
      NOW,
    );
    expect(a.currentRisk).toBe('LIKELY_FLOODING');
  });

  it('rainfall alone NEVER reaches CONFIRMED_NOT_PASSABLE at any intensity', () => {
    for (const mm of [8, 15, 30, 60, 200]) {
      const a = assessBarangayRisk(
        'x',
        inputs({
          rainfall: sample({ nowMmHr: mm, recentAccumMm: 500 }),
          baselineSusceptibility: 'HIGH',
        }),
        NOW,
      );
      expect(a.currentRisk).not.toBe('CONFIRMED_NOT_PASSABLE');
    }
  });
});

describe('assessBarangayRisk — community reports', () => {
  it('a recent RED/ORANGE report escalates to REPORTED_FLOODING', () => {
    const red = assessBarangayRisk(
      'x',
      inputs({ recentReportCount: 1, reportState: 'RED' }),
      NOW,
    );
    expect(red.currentRisk).toBe('REPORTED_FLOODING');
  });

  it('a YELLOW-only report does NOT escalate to REPORTED_FLOODING', () => {
    const y = assessBarangayRisk(
      'x',
      inputs({ recentReportCount: 1, reportState: 'YELLOW' }),
      NOW,
    );
    expect(y.currentRisk).not.toBe('REPORTED_FLOODING');
  });

  it('reports NEVER reach CONFIRMED_NOT_PASSABLE', () => {
    const a = assessBarangayRisk(
      'x',
      inputs({ recentReportCount: 5, reportState: 'RED' }),
      NOW,
    );
    expect(a.currentRisk).toBe('REPORTED_FLOODING');
  });
});

describe('assessBarangayRisk — official confirmation', () => {
  it('is the ONLY path to CONFIRMED_NOT_PASSABLE', () => {
    const a = assessBarangayRisk(
      'x',
      inputs({
        official: { psgc: 'x', notPassable: true, source: 'LGU', confirmedAt: NOW },
        rainfall: sample({ nowMmHr: 0 }),
      }),
      NOW,
    );
    expect(a.currentRisk).toBe('CONFIRMED_NOT_PASSABLE');
  });

  it('an official record that is NOT notPassable does not force the state', () => {
    const a = assessBarangayRisk(
      'x',
      inputs({
        official: { psgc: 'x', notPassable: false, source: 'LGU', confirmedAt: NOW },
      }),
      NOW,
    );
    expect(a.currentRisk).toBe('LOW');
  });
});
