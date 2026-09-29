// src/services/rainfallGrid.test.ts
import { describe, expect, it } from 'vitest';
import { rainfallGridSamples, barangayToGridCell } from './rainfallGrid';
import { ncrBarangayInfos } from '../data/geojson/ncrBarangays';

describe('rainfall coarse grid', () => {
  it('produces far fewer samples than barangays (fits a single small request)', () => {
    expect(rainfallGridSamples.length).toBeGreaterThan(0);
    // The whole point of the fix: dramatically fewer requests.
    expect(rainfallGridSamples.length).toBeLessThan(120);
    expect(rainfallGridSamples.length).toBeLessThan(ncrBarangayInfos.length / 10);
  });

  it('assigns every barangay to a grid cell', () => {
    for (const b of ncrBarangayInfos) {
      expect(barangayToGridCell.has(b.psgc)).toBe(true);
    }
  });

  it('every barangay cell id corresponds to a real grid sample', () => {
    const sampleIds = new Set(rainfallGridSamples.map((s) => s.psgc));
    for (const b of ncrBarangayInfos) {
      const cell = barangayToGridCell.get(b.psgc)!;
      expect(sampleIds.has(cell)).toBe(true);
    }
  });

  it('grid sample coordinates are all valid and within NCR bounds', () => {
    for (const s of rainfallGridSamples) {
      expect(Number.isFinite(s.lat)).toBe(true);
      expect(Number.isFinite(s.lng)).toBe(true);
      expect(s.lat).toBeGreaterThan(14.2);
      expect(s.lat).toBeLessThan(14.9);
      expect(s.lng).toBeGreaterThan(120.8);
      expect(s.lng).toBeLessThan(121.2);
    }
  });
});
