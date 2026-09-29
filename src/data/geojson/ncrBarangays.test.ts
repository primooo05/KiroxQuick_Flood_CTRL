// src/data/geojson/ncrBarangays.test.ts
import { describe, expect, it } from 'vitest';
import {
  ncrBarangays,
  ncrBarangayInfos,
  barangayInfoByPsgc,
} from './ncrBarangays';

describe('NCR barangay dataset', () => {
  it('is a non-empty FeatureCollection of polygons', () => {
    expect(ncrBarangays.type).toBe('FeatureCollection');
    expect(ncrBarangays.features.length).toBeGreaterThan(1000);
    for (const f of ncrBarangays.features.slice(0, 50)) {
      expect(['Polygon', 'MultiPolygon']).toContain(f.geometry.type);
    }
  });

  it('every barangay has a stable PSGC id used as the feature id', () => {
    for (const f of ncrBarangays.features) {
      expect(typeof f.properties.psgc).toBe('string');
      expect(f.properties.psgc.length).toBeGreaterThan(0);
      expect(f.id).toBe(f.properties.psgc);
    }
  });

  it('PSGC ids are unique', () => {
    const ids = new Set(ncrBarangays.features.map((f) => f.properties.psgc));
    expect(ids.size).toBe(ncrBarangays.features.length);
  });

  it('is NCR-only (all PSGC codes are region 13)', () => {
    for (const f of ncrBarangays.features) {
      // PSGC pcode format: "PH13...." — region 13 is NCR.
      expect(f.properties.psgc.startsWith('PH13')).toBe(true);
    }
  });

  it('carries name, city, and a precomputed centroid within NCR bounds', () => {
    for (const b of ncrBarangayInfos) {
      expect(b.name.length).toBeGreaterThan(0);
      expect(b.city.length).toBeGreaterThan(0);
      const [lng, lat] = b.centroid;
      // Rough NCR bounding box.
      expect(lng).toBeGreaterThan(120.9);
      expect(lng).toBeLessThan(121.15);
      expect(lat).toBeGreaterThan(14.3);
      expect(lat).toBeLessThan(14.8);
    }
  });

  it('exposes a PSGC → info lookup matching the feature count', () => {
    expect(barangayInfoByPsgc.size).toBe(ncrBarangays.features.length);
    const first = ncrBarangays.features[0];
    expect(barangayInfoByPsgc.get(first.properties.psgc)?.name).toBe(
      first.properties.brgy,
    );
  });
});
