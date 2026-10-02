// src/layers/historicalCityBoundary.test.ts
import { describe, expect, it, vi } from 'vitest';
import {
  ncrCityBoundaries,
  buildCityBoundarySource,
  applyCityFocus,
  resolveCityHover,
  cityPsgcFromFeature,
  installCityClick,
  CITY_BOUNDARY_SOURCE_ID,
  CITY_BOUNDARY_LAYER_ID,
  CITY_SELECTED_STATE_KEY,
  CITY_EMPHASIS_STATE_KEY,
  type CityClickMap,
} from './historicalCityBoundary';
import { historicalCitySummaries } from '../data/historical/ncrHistoricalFloodRisk';

describe('derived city boundaries (dissolved by cityPsgc)', () => {
  it('has one boundary per NCR LGU (17), each keyed by cityPsgc', () => {
    expect(ncrCityBoundaries.features.length).toBe(17);
    for (const f of ncrCityBoundaries.features) {
      expect(typeof f.properties?.cityPsgc).toBe('string');
      expect(f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon').toBe(true);
    }
  });

  it('city boundary PSGCs match the historical city summaries', () => {
    const boundaryPsgcs = new Set(
      ncrCityBoundaries.features.map((f) => f.properties!.cityPsgc as string),
    );
    for (const c of historicalCitySummaries) {
      expect(boundaryPsgcs.has(c.cityPsgc)).toBe(true);
    }
  });

  it('the source promotes cityPsgc to the feature id', () => {
    expect(buildCityBoundarySource().promoteId).toBe('cityPsgc');
  });
});

describe('applyCityFocus feature-state', () => {
  function fakeMap() {
    const states = new Map<string, Record<string, unknown>>();
    return {
      states,
      setFeatureState(t: { source: string; id: string | number }, s: Record<string, unknown>) {
        expect(t.source).toBe(CITY_BOUNDARY_SOURCE_ID);
        states.set(String(t.id), { ...(states.get(String(t.id)) ?? {}), ...s });
      },
    };
  }

  it('marks the selected city and dims the others when focused', () => {
    const map = fakeMap();
    const city = historicalCitySummaries[0];
    applyCityFocus(map, city.cityPsgc);
    expect(map.states.get(city.cityPsgc)?.[CITY_SELECTED_STATE_KEY]).toBe(true);
    const other = historicalCitySummaries[1];
    expect(map.states.get(other.cityPsgc)?.[CITY_SELECTED_STATE_KEY]).toBe(false);
    expect(map.states.get(other.cityPsgc)?.[CITY_EMPHASIS_STATE_KEY]).toBe('dim');
  });

  it('clears focus (all normal, none selected) for NCR overview', () => {
    const map = fakeMap();
    applyCityFocus(map, null);
    for (const c of historicalCitySummaries) {
      expect(map.states.get(c.cityPsgc)?.[CITY_SELECTED_STATE_KEY]).toBe(false);
      expect(map.states.get(c.cityPsgc)?.[CITY_EMPHASIS_STATE_KEY]).toBe('normal');
    }
  });

  it('is a safe no-op without setFeatureState', () => {
    expect(() => applyCityFocus(null, 'X')).not.toThrow();
  });
});

describe('city hover + click resolution', () => {
  const city = historicalCitySummaries[0];

  it('resolveCityHover returns city name + barangay count', () => {
    const info = resolveCityHover({ features: [{ id: city.cityPsgc }], point: { x: 1, y: 2 } });
    expect(info).not.toBeNull();
    expect(info!.cityName).toBe(city.cityName);
    expect(info!.barangayCount).toBe(city.barangayCount);
    expect(info!.point).toEqual({ x: 1, y: 2 });
  });

  it('cityPsgcFromFeature reads id or properties.cityPsgc', () => {
    expect(cityPsgcFromFeature({ id: 'PH1307404' })).toBe('PH1307404');
    expect(cityPsgcFromFeature({ properties: { cityPsgc: 'PH1303901' } })).toBe('PH1303901');
    expect(cityPsgcFromFeature(undefined)).toBeNull();
  });

  it('installCityClick fires onSelect with the clicked cityPsgc', () => {
    const handlers = new Map<string, (e: unknown) => void>();
    const map: CityClickMap = {
      on: (e, layer, h) => handlers.set(`${e}:${layer}`, h as (e: unknown) => void),
      off: (e, layer) => handlers.delete(`${e}:${layer}`),
      getCanvas: () => ({ style: { cursor: '' } }),
    };
    const onSelect = vi.fn();
    const teardown = installCityClick(map, onSelect);
    handlers.get(`click:${CITY_BOUNDARY_LAYER_ID}`)!({
      features: [{ id: city.cityPsgc, properties: { cityPsgc: city.cityPsgc } }],
    });
    expect(onSelect).toHaveBeenCalledWith(city.cityPsgc);
    teardown();
    expect(handlers.has(`click:${CITY_BOUNDARY_LAYER_ID}`)).toBe(false);
  });
});
