import { describe, expect, it } from 'vitest';
import { buildMetroManilaClipMask } from './metroManilaClipMask';
import { metroManilaCityBoundaries } from '../data/geojson/metroManilaCityBoundaries';

describe('buildMetroManilaClipMask', () => {
  const mask = buildMetroManilaClipMask(metroManilaCityBoundaries);
  const [outer, ...holes] = mask.geometry.coordinates;

  it('is a world-covering polygon', () => {
    expect(mask.geometry.type).toBe('Polygon');
    expect(outer).toContainEqual([-180, -85]);
    expect(outer).toContainEqual([180, 85]);
  });

  it('cuts one hole per NCR city polygon part (17 cities, 2 MultiPolygons)', () => {
    const parts = metroManilaCityBoundaries.features.reduce(
      (n, f) => n + (f.geometry.type === 'Polygon' ? 1 : f.geometry.coordinates.length),
      0,
    );
    expect(metroManilaCityBoundaries.features).toHaveLength(17);
    expect(holes).toHaveLength(parts);
    expect(parts).toBeGreaterThanOrEqual(17);
  });
});
