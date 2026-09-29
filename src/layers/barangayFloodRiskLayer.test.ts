// src/layers/barangayFloodRiskLayer.test.ts
import { describe, expect, it, vi } from 'vitest';
import { LayerRegistry, type MapLayerAdapter, type MapLayerSpec } from './LayerRegistry';
import {
  BARANGAY_RISK_FILL_LAYER_ID,
  BARANGAY_RISK_OUTLINE_LAYER_ID,
  BARANGAY_RISK_SOURCE_ID,
  BARANGAY_RISK_STATE_KEY,
  BARANGAY_SELECTED_LAYER_ID,
  BARANGAY_SELECTED_STATE_KEY,
  applyBarangayRiskStates,
  buildBarangayRiskSource,
  installBarangayFloodRisk,
  setSelectedBarangay,
  type BarangayRiskMapAdapter,
} from './barangayFloodRiskLayer';
import type { CurrentRiskLevel } from '../types/risk';

/** A fake map recording source/layer adds, satisfying both adapters. */
class FakeMap implements MapLayerAdapter, BarangayRiskMapAdapter {
  readonly stack: string[] = [];
  readonly sources: string[] = [];
  addSource(id: string): void {
    this.sources.push(id);
  }
  addLayer(layer: MapLayerSpec, beforeId?: string): void {
    if (beforeId) {
      const i = this.stack.indexOf(beforeId);
      if (i !== -1) {
        this.stack.splice(i, 0, layer.id);
        return;
      }
    }
    this.stack.push(layer.id);
  }
  removeLayer(id: string): void {
    const i = this.stack.indexOf(id);
    if (i !== -1) this.stack.splice(i, 1);
  }
  setLayoutProperty(): void {}
  getLayer(id: string): unknown {
    return this.stack.includes(id) ? { id } : undefined;
  }
}

describe('buildBarangayRiskSource', () => {
  it('promotes psgc to the feature id for feature-state', () => {
    const src = buildBarangayRiskSource();
    expect(src.type).toBe('geojson');
    expect(src.promoteId).toBe('psgc');
    expect(src.data.features.length).toBeGreaterThan(1000);
  });
});

describe('installBarangayFloodRisk', () => {
  it('adds the source, the registry fill, and the outline on top', () => {
    const map = new FakeMap();
    const registry = new LayerRegistry(map);
    const installed = installBarangayFloodRisk(map, registry);

    expect(map.sources).toContain(BARANGAY_RISK_SOURCE_ID);
    expect(installed.fillLayer.id).toBe(BARANGAY_RISK_FILL_LAYER_ID);
    expect(installed.outlineLayer.id).toBe(BARANGAY_RISK_OUTLINE_LAYER_ID);
    expect(map.stack).toContain(BARANGAY_RISK_FILL_LAYER_ID);
    expect(map.stack).toContain(BARANGAY_RISK_OUTLINE_LAYER_ID);
    // The selected-barangay highlight layer is installed on top.
    expect(map.stack).toContain(BARANGAY_SELECTED_LAYER_ID);
    expect(registry.has('barangayFloodRisk')).toBe(true);
  });
});

describe('setSelectedBarangay', () => {
  it('marks the selected barangay and clears the previous one', () => {
    const setFeatureState = vi.fn();
    setSelectedBarangay({ setFeatureState }, 'PH-NEW', 'PH-OLD');
    expect(setFeatureState).toHaveBeenCalledWith(
      { source: BARANGAY_RISK_SOURCE_ID, id: 'PH-OLD' },
      { [BARANGAY_SELECTED_STATE_KEY]: false },
    );
    expect(setFeatureState).toHaveBeenCalledWith(
      { source: BARANGAY_RISK_SOURCE_ID, id: 'PH-NEW' },
      { [BARANGAY_SELECTED_STATE_KEY]: true },
    );
  });

  it('clears selection when psgc is null', () => {
    const setFeatureState = vi.fn();
    setSelectedBarangay({ setFeatureState }, null, 'PH-OLD');
    expect(setFeatureState).toHaveBeenCalledTimes(1);
    expect(setFeatureState).toHaveBeenCalledWith(
      { source: BARANGAY_RISK_SOURCE_ID, id: 'PH-OLD' },
      { [BARANGAY_SELECTED_STATE_KEY]: false },
    );
  });

  it('is a safe no-op without setFeatureState', () => {
    expect(() => setSelectedBarangay(null, 'X', null)).not.toThrow();
  });
});

describe('applyBarangayRiskStates', () => {
  it('sets feature-state per barangay via setFeatureState', () => {
    const setFeatureState = vi.fn();
    const risk = new Map<string, CurrentRiskLevel>([
      ['PH1303901001', 'HIGH'],
      ['PH1303901002', 'LOW'],
    ]);
    applyBarangayRiskStates({ setFeatureState }, risk);

    expect(setFeatureState).toHaveBeenCalledTimes(2);
    expect(setFeatureState).toHaveBeenCalledWith(
      { source: BARANGAY_RISK_SOURCE_ID, id: 'PH1303901001' },
      { [BARANGAY_RISK_STATE_KEY]: 'HIGH' },
    );
  });

  it('is a safe no-op when the map lacks setFeatureState', () => {
    expect(() =>
      applyBarangayRiskStates(null, new Map([['x', 'LOW']])),
    ).not.toThrow();
  });

  it('one bad id does not abort the whole update pass', () => {
    const setFeatureState = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('bad id');
      })
      .mockImplementation(() => undefined);
    const risk = new Map<string, CurrentRiskLevel>([
      ['bad', 'HIGH'],
      ['good', 'LOW'],
    ]);
    applyBarangayRiskStates({ setFeatureState }, risk);
    expect(setFeatureState).toHaveBeenCalledTimes(2);
  });
});
