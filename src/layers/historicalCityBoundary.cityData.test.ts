// src/layers/historicalCityBoundary.cityData.test.ts
//
// Regression guard for the selected-city "zig-zag" bug. The city/LGU outline is
// a Mapbox `line` layer; if the source geometry is un-dissolved barangay
// sub-polygons, the layer strokes every interior ring and the selected city
// shows a diagonal mesh. These tests assert the shipped city-boundary asset is
// a properly DISSOLVED per-LGU outline (one outer ring per part, no interior
// barangay seams) and still carries the join key the layer/hover use.

import { describe, expect, it } from 'vitest';
import { ncrCityBoundaries } from './historicalCityBoundary';
import { historicalCitySummaryByPsgc } from '../data/historical/ncrHistoricalFloodRisk';

/** Rings in one geometry: [polygonCount, totalRingCount]. */
function ringCounts(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): [number, number] {
  if (geometry.type === 'Polygon') return [1, geometry.coordinates.length];
  return [
    geometry.coordinates.length,
    geometry.coordinates.reduce((n, poly) => n + poly.length, 0),
  ];
}

describe('ncrCityBoundaries (dissolved city outline asset)', () => {
  it('has exactly the 17 NCR LGUs, each with a cityPsgc + feature id', () => {
    expect(ncrCityBoundaries.features).toHaveLength(17);
    for (const f of ncrCityBoundaries.features) {
      const psgc = (f.properties?.cityPsgc as string | undefined) ?? (f.id as string);
      expect(typeof psgc).toBe('string');
      expect(psgc).toBeTruthy();
      // The hover/summary join key must resolve.
      expect(historicalCitySummaryByPsgc.has(psgc)).toBe(true);
    }
  });

  it('is DISSOLVED: no city is a mesh of un-merged barangay sub-polygons', () => {
    // A correctly dissolved LGU is a single outer polygon (optionally a few
    // genuine detached parts for Caloocan / Las Piñas), each part with ONE outer
    // ring (holes allowed but rare here). The old bad asset had 41-486 polygons
    // per city; guard well under that.
    for (const f of ncrCityBoundaries.features) {
      const [polys, rings] = ringCounts(
        f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
      );
      // At most 2 genuine parts (Caloocan, Las Piñas); never dozens.
      expect(polys).toBeLessThanOrEqual(2);
      // Rings never explode (1 per part + the odd hole); never a seam mesh.
      expect(rings).toBeLessThanOrEqual(4);
    }
  });

  it('keeps Quezon City as a single clean polygon (the reported case)', () => {
    const qc = ncrCityBoundaries.features.find(
      (f) => ((f.properties?.cityPsgc as string) ?? f.id) === 'PH1307404',
    );
    expect(qc).toBeDefined();
    const [polys, rings] = ringCounts(
      qc!.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
    );
    expect(polys).toBe(1);
    expect(rings).toBe(1);
  });
});
