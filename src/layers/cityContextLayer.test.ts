// src/layers/cityContextLayer.test.ts
import { describe, expect, it } from 'vitest';
import {
  CITY_BOUNDARY_LAYER_ID,
  CITY_CONTEXT_SOURCE_ID,
  CITY_LABEL_LAYER_ID,
  CITY_LABEL_SOURCE_ID,
  buildCityBoundaryLayer,
  buildCityContextSource,
  buildCityLabelLayer,
  buildCityLabelSource,
  groupBarangayValuesByCity,
  installCityContext,
  type CityContextMapAdapter,
  type CityLayerSpec,
  type GeoJsonSourceSpec,
} from './cityContextLayer';

class FakeMap implements CityContextMapAdapter {
  readonly sources: string[] = [];
  readonly layers: string[] = [];
  addSource(id: string, _source: GeoJsonSourceSpec): void {
    this.sources.push(id);
  }
  addLayer(layer: CityLayerSpec): void {
    this.layers.push(layer.id);
  }
  getLayer(id: string): unknown {
    return this.layers.includes(id) ? { id } : undefined;
  }
}

describe('city context sources', () => {
  it('boundary source has 17 polygon features', () => {
    const src = buildCityContextSource();
    expect(src.type).toBe('geojson');
    expect(src.data.features.length).toBe(17);
  });

  it('label source has 17 points carrying the city name', () => {
    const src = buildCityLabelSource();
    expect(src.data.features.length).toBe(17);
    for (const f of src.data.features) {
      expect(f.geometry.type).toBe('Point');
      expect(typeof (f.properties as { name?: string }).name).toBe('string');
    }
  });
});

describe('city context layers', () => {
  it('boundary is a subtle zoom-scaled line (never in the flood palette)', () => {
    const layer = buildCityBoundaryLayer();
    expect(layer.type).toBe('line');
    const paint = layer.paint as Record<string, unknown>;
    expect(paint['line-color']).toBe('#6b7280'); // neutral grey, not reserved
    // Zoom-interpolated width + opacity.
    expect(Array.isArray(paint['line-width'])).toBe(true);
    expect(Array.isArray(paint['line-opacity'])).toBe(true);
  });

  it('label layer is a symbol layer that fades out at deep zoom', () => {
    const layer = buildCityLabelLayer();
    expect(layer.type).toBe('symbol');
    const layout = layer.layout as Record<string, unknown>;
    expect(layout['text-field']).toEqual(['get', 'name']);
    expect(layout['text-allow-overlap']).toBe(false);
    const paint = layer.paint as Record<string, unknown>;
    // Opacity expression ends at 0 (hidden by street/barangay zoom).
    const op = paint['text-opacity'] as unknown[];
    expect(op[op.length - 1]).toBe(0);
  });
});

describe('installCityContext', () => {
  it('adds both sources and both layers (boundary + labels)', () => {
    const map = new FakeMap();
    const installed = installCityContext(map);
    expect(map.sources).toEqual([CITY_CONTEXT_SOURCE_ID, CITY_LABEL_SOURCE_ID]);
    expect(map.layers).toContain(CITY_BOUNDARY_LAYER_ID);
    expect(map.layers).toContain(CITY_LABEL_LAYER_ID);
    // Labels are added after the boundary so names render on top.
    expect(map.layers.indexOf(CITY_LABEL_LAYER_ID)).toBeGreaterThan(
      map.layers.indexOf(CITY_BOUNDARY_LAYER_ID),
    );
    expect(installed.boundaryLayer.id).toBe(CITY_BOUNDARY_LAYER_ID);
    expect(installed.labelLayer.id).toBe(CITY_LABEL_LAYER_ID);
  });
});

describe('groupBarangayValuesByCity (future-ready aggregation)', () => {
  it('regroups barangay values by their city PSGC without fabricating data', () => {
    const values = new Map<string, string>([
      ['b1', 'LOW'],
      ['b2', 'HIGH'],
      ['b3', 'LOW'],
    ]);
    const cityOf = new Map<string, string>([
      ['b1', 'PH1307404'],
      ['b2', 'PH1307404'],
      ['b3', 'PH1303901'],
    ]);
    const grouped = groupBarangayValuesByCity(values, cityOf);
    expect(grouped.get('PH1307404')).toEqual(['LOW', 'HIGH']);
    expect(grouped.get('PH1303901')).toEqual(['LOW']);
  });

  it('drops values whose barangay has no known city', () => {
    const grouped = groupBarangayValuesByCity(
      new Map([['x', 'LOW']]),
      new Map(),
    );
    expect(grouped.size).toBe(0);
  });
});
