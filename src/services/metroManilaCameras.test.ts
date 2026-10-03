import { describe, expect, it } from 'vitest';
import { ncrCityInfos } from '../data/geojson/ncrCityContext';
import { metroManilaCityBoundaries } from '../data/geojson/metroManilaCityBoundaries';
import type { TrafficCamera } from '../types/camera';
import { filterMetroManilaCameras } from './metroManilaCameras';

function camera(id: string, coordinates: readonly [number, number], areaLabel?: string): TrafficCamera {
  return {
    sourceId: id, source: 'Windy', name: `Camera ${id}`, coordinates,
    mediaKind: 'image', mediaUrl: 'https://images.example.test/current.jpg', areaLabel,
  };
}

describe('filterMetroManilaCameras', () => {
  it('assigns samples from all 17 NCR city label points using boundary geometry', () => {
    const results = filterMetroManilaCameras(ncrCityInfos.map((city) =>
      camera(city.id, city.labelPoint),
    ));
    expect(results).toHaveLength(17);
    expect(new Set(results.map((item) => item.city.id))).toEqual(new Set(ncrCityInfos.map((city) => city.id)));
  });

  it('excludes outside points, invalid coordinates, and points on an ambiguous boundary', () => {
    const edge = metroManilaCityBoundaries.features[0].geometry.type === 'Polygon'
      ? metroManilaCityBoundaries.features[0].geometry.coordinates[0][0]
      : metroManilaCityBoundaries.features[0].geometry.coordinates[0][0][0];
    const results = filterMetroManilaCameras([
      camera('outside', [0, 0]),
      camera('bad-lng', [Number.NaN, 14.6]),
      camera('edge', [edge[0], edge[1]]),
    ]);
    expect(results).toEqual([]);
  });

  it('uses the polygon city when the provider area label disagrees', () => {
    const pasig = ncrCityInfos.find((city) => city.id === 'pasig');
    expect(pasig).toBeDefined();
    const [result] = filterMetroManilaCameras([camera('mislabeled', pasig!.labelPoint, 'Makati')]);
    expect(result.city).toEqual({ id: 'pasig', name: 'Pasig' });
    expect(result.areaLabel).toBe('Makati');
  });

  it('deduplicates repeated records by provider and source ID, but keeps IDs from distinct sources', () => {
    const point = ncrCityInfos.find((city) => city.id === 'manila')!.labelPoint;
    const records = [camera('same', point), camera('same', point), { ...camera('same', point), source: 'Other' }];
    const results = filterMetroManilaCameras(records);
    expect(results).toHaveLength(2);
  });
});
