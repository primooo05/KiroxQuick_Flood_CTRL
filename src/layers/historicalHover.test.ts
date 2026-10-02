// src/layers/historicalHover.test.ts
import { describe, expect, it, vi } from 'vitest';
import {
  installHistoricalHover,
  resolveHoverInfo,
  psgcFromHoverFeature,
  type HistoricalHoverEvent,
  type HistoricalHoverMap,
} from './historicalHover';
import { HISTORICAL_RISK_FILL_LAYER_ID } from './historicalFloodRisk';
import { historicalRiskRecords } from '../data/historical/ncrHistoricalFloodRisk';

const sample = historicalRiskRecords[0];

describe('resolveHoverInfo', () => {
  it('resolves name / city / class + point from a hovered feature', () => {
    const info = resolveHoverInfo({
      features: [{ id: sample.psgc }],
      point: { x: 10, y: 20 },
    });
    expect(info).not.toBeNull();
    expect(info!.name).toBe(sample.name);
    expect(info!.city).toBe(sample.city);
    expect(info!.cls).toBe(sample.historicalRiskClass);
    expect(info!.point).toEqual({ x: 10, y: 20 });
  });

  it('returns null for an unknown / missing feature', () => {
    expect(resolveHoverInfo({ features: [] })).toBeNull();
    expect(resolveHoverInfo({ features: [{ id: 'NOPE' }] })).toBeNull();
  });

  it('reads PSGC from id or properties.psgc', () => {
    expect(psgcFromHoverFeature({ id: 'PH13X' })).toBe('PH13X');
    expect(psgcFromHoverFeature({ properties: { psgc: 'PH13Y' } })).toBe('PH13Y');
    expect(psgcFromHoverFeature(undefined)).toBeNull();
  });
});

describe('installHistoricalHover', () => {
  function fakeMap() {
    const handlers = new Map<string, (e: HistoricalHoverEvent) => void>();
    const map: HistoricalHoverMap = {
      on(event, layerId, handler) {
        handlers.set(`${event}:${layerId}`, handler as (e: HistoricalHoverEvent) => void);
      },
      off(event, layerId) {
        handlers.delete(`${event}:${layerId}`);
      },
    };
    return { map, handlers };
  }

  it('binds mousemove + mouseleave on the historical fill and reports hover', () => {
    const { map, handlers } = fakeMap();
    const onHover = vi.fn();
    installHistoricalHover(map, onHover);
    const move = handlers.get(`mousemove:${HISTORICAL_RISK_FILL_LAYER_ID}`)!;
    const leave = handlers.get(`mouseleave:${HISTORICAL_RISK_FILL_LAYER_ID}`)!;
    move({ features: [{ id: sample.psgc }], point: { x: 5, y: 6 } });
    expect(onHover).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: sample.name, cls: sample.historicalRiskClass }),
    );
    leave({});
    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it('uninstall removes both handlers', () => {
    const { map, handlers } = fakeMap();
    const uninstall = installHistoricalHover(map, vi.fn());
    expect(handlers.size).toBe(2);
    uninstall();
    expect(handlers.size).toBe(0);
  });
});
