// src/data/geojson/ncrCityContext.test.ts
import { describe, expect, it } from 'vitest';
import {
  ncrCityContext,
  ncrCityInfos,
  cityInfoByPsgc,
} from './ncrCityContext';

const EXPECTED_LGUS = [
  'Caloocan',
  'Las Piñas',
  'Makati',
  'Malabon',
  'Mandaluyong',
  'Manila',
  'Marikina',
  'Muntinlupa',
  'Navotas',
  'Parañaque',
  'Pasay',
  'Pasig',
  'Quezon City',
  'San Juan',
  'Taguig',
  'Valenzuela',
  'Pateros',
];

describe('NCR City/LGU context dataset', () => {
  it('has exactly 17 LGUs', () => {
    expect(ncrCityContext.features.length).toBe(17);
    expect(ncrCityInfos.length).toBe(17);
  });

  it('covers all 17 Metro Manila LGUs by name', () => {
    const names = new Set(ncrCityInfos.map((c) => c.name));
    for (const expected of EXPECTED_LGUS) {
      expect(names.has(expected)).toBe(true);
    }
    expect(names.size).toBe(17);
  });

  it('explicitly includes the easy-to-miss smaller/irregular LGUs', () => {
    const names = new Set(ncrCityInfos.map((c) => c.name));
    for (const tricky of [
      'Caloocan',
      'Navotas',
      'San Juan',
      'Makati',
      'Taguig',
      'Muntinlupa',
      'Pateros',
    ]) {
      expect(names.has(tricky)).toBe(true);
    }
  });

  it('handles Polygon and MultiPolygon geometries', () => {
    const types = new Set(ncrCityContext.features.map((f) => f.geometry.type));
    for (const f of ncrCityContext.features) {
      expect(['Polygon', 'MultiPolygon']).toContain(f.geometry.type);
    }
    // The dataset contains at least one MultiPolygon LGU (e.g. Caloocan).
    expect(types.has('MultiPolygon')).toBe(true);
  });

  it('gives every LGU a stable id, cityPsgc, and label point within NCR', () => {
    for (const c of ncrCityInfos) {
      expect(c.id.length).toBeGreaterThan(0);
      expect(c.cityPsgc.startsWith('PH13')).toBe(true);
      const [lng, lat] = c.labelPoint;
      expect(lng).toBeGreaterThan(120.85);
      expect(lng).toBeLessThan(121.2);
      expect(lat).toBeGreaterThan(14.3);
      expect(lat).toBeLessThan(14.85);
    }
  });

  it('cityPsgc values are unique and indexed', () => {
    const psgcs = new Set(ncrCityInfos.map((c) => c.cityPsgc));
    expect(psgcs.size).toBe(17);
    expect(cityInfoByPsgc.size).toBe(17);
    const manila = cityInfoByPsgc.get('PH1303901');
    expect(manila?.name).toBe('Manila');
  });

  it('every feature carries id === properties.id for feature-state stability', () => {
    for (const f of ncrCityContext.features) {
      expect(f.id).toBe(f.properties.id);
    }
  });
});
