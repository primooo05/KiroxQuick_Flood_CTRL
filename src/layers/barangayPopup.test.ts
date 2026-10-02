// src/layers/barangayPopup.test.ts
import { describe, expect, it, vi } from 'vitest';
import {
  installBarangayPopup,
  psgcFromFeature,
  type BarangayPopupMap,
  type BarangayLayerClickEvent,
} from './barangayPopup';
import { BARANGAY_RISK_FILL_LAYER_ID } from './barangayFloodRiskLayer';
import { HISTORICAL_RISK_FILL_LAYER_ID } from './historicalFloodRisk';

/** A fake map that records which (event, layerId) handlers were bound. */
function fakeMap() {
  const handlers = new Map<string, (e: BarangayLayerClickEvent) => void>();
  const key = (event: string, layerId: string) => `${event}:${layerId}`;
  const map: BarangayPopupMap = {
    on(event, layerId, handler) {
      handlers.set(key(event, layerId), handler as (e: BarangayLayerClickEvent) => void);
    },
    off(event, layerId) {
      handlers.delete(key(event, layerId));
    },
    getCanvas: () => ({ style: { cursor: '' } }),
  };
  return { map, handlers, key };
}

describe('psgcFromFeature', () => {
  it('prefers feature.id then properties.psgc', () => {
    expect(psgcFromFeature({ id: 'PH13X' })).toBe('PH13X');
    expect(psgcFromFeature({ properties: { psgc: 'PH13Y' } })).toBe('PH13Y');
    expect(psgcFromFeature(undefined)).toBeNull();
  });
});

describe('installBarangayPopup layer binding', () => {
  it('binds click on the current-risk fill by default', () => {
    const { map, handlers, key } = fakeMap();
    installBarangayPopup(map, (p) => p, vi.fn());
    expect(handlers.has(key('click', BARANGAY_RISK_FILL_LAYER_ID))).toBe(true);
    // No historical binding unless requested.
    expect(handlers.has(key('click', HISTORICAL_RISK_FILL_LAYER_ID))).toBe(false);
  });

  it('ALSO binds click on the historical fill when passed (fixes dead clicks in Historical-only mode)', () => {
    const { map, handlers, key } = fakeMap();
    installBarangayPopup(map, (p) => p, vi.fn(), [HISTORICAL_RISK_FILL_LAYER_ID]);
    expect(handlers.has(key('click', BARANGAY_RISK_FILL_LAYER_ID))).toBe(true);
    expect(handlers.has(key('click', HISTORICAL_RISK_FILL_LAYER_ID))).toBe(true);
  });

  it('a click on the historical fill opens the panel with the clicked PSGC', () => {
    const { map, handlers, key } = fakeMap();
    const render = vi.fn();
    installBarangayPopup(map, (p) => p, render, [HISTORICAL_RISK_FILL_LAYER_ID]);
    const handler = handlers.get(key('click', HISTORICAL_RISK_FILL_LAYER_ID))!;
    handler({ features: [{ id: 'PH1307404001' }], lngLat: { lng: 121, lat: 14.6 } });
    expect(render).toHaveBeenCalledWith('PH1307404001', { lng: 121, lat: 14.6 });
  });

  it('uninstall removes every bound handler (both layers)', () => {
    const { map, handlers } = fakeMap();
    const uninstall = installBarangayPopup(map, (p) => p, vi.fn(), [
      HISTORICAL_RISK_FILL_LAYER_ID,
    ]);
    expect(handlers.size).toBeGreaterThan(0);
    uninstall();
    expect(handlers.size).toBe(0);
  });
});
