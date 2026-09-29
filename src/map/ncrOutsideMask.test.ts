// src/map/ncrOutsideMask.test.ts
import { describe, expect, it, vi } from 'vitest';
import {
  NCR_OUTSIDE_MASK_COLOR,
  NCR_OUTSIDE_MASK_LAYER_ID,
  NCR_OUTSIDE_MASK_OPACITY,
  NCR_OUTSIDE_MASK_SOURCE_ID,
  buildNcrOutsideMask,
  buildNcrOutsideMaskLayer,
  installNcrOutsideMask,
  type MaskFillLayerSpec,
  type MaskMapAdapter,
  type MaskSourceSpec,
} from './ncrOutsideMask';
import { metroManilaCityBoundaries } from '../data/geojson/metroManilaCityBoundaries';

describe('buildNcrOutsideMask', () => {
  it('is one world polygon with a hole per NCR city outer ring', () => {
    const mask = buildNcrOutsideMask();
    expect(mask.geometry.type).toBe('Polygon');
    const rings = mask.geometry.coordinates;
    // First ring is the world outer ring; the rest are the NCR holes.
    const expectedHoles = metroManilaCityBoundaries.features.reduce((sum, f) => {
      const polys =
        f.geometry.type === 'Polygon' ? 1 : f.geometry.coordinates.length;
      return sum + polys;
    }, 0);
    expect(rings.length).toBe(1 + expectedHoles);
    // The world ring spans the globe (covers everything outside NCR).
    const world = rings[0];
    const lngs = world.map((p) => p[0]);
    const lats = world.map((p) => p[1]);
    expect(Math.min(...lngs)).toBeLessThanOrEqual(-180);
    expect(Math.max(...lngs)).toBeGreaterThanOrEqual(180);
    expect(Math.min(...lats)).toBeLessThanOrEqual(-85);
    expect(Math.max(...lats)).toBeGreaterThanOrEqual(85);
  });

  it('holes cover all 17 LGUs (>= 17 hole rings)', () => {
    const mask = buildNcrOutsideMask();
    const holes = mask.geometry.coordinates.length - 1;
    expect(holes).toBeGreaterThanOrEqual(17);
  });
});

describe('buildNcrOutsideMaskLayer', () => {
  it('is a fully opaque light-neutral fill (hides all content outside NCR)', () => {
    const layer = buildNcrOutsideMaskLayer();
    expect(layer.type).toBe('fill');
    expect(layer.paint['fill-color']).toBe(NCR_OUTSIDE_MASK_COLOR);
    expect(layer.paint['fill-opacity']).toBe(NCR_OUTSIDE_MASK_OPACITY);
    // Strictly NCR-only: the outside must be completely hidden, not translucent.
    expect(layer.paint['fill-opacity']).toBe(1);
  });
});

class FakeMaskMap implements MaskMapAdapter {
  readonly sources: string[] = [];
  readonly layers: string[] = [];
  addSource(id: string, _s: MaskSourceSpec): void {
    this.sources.push(id);
  }
  addLayer(l: MaskFillLayerSpec): void {
    this.layers.push(l.id);
  }
  getLayer(id: string): unknown {
    return this.layers.includes(id) ? { id } : undefined;
  }
}

describe('installNcrOutsideMask', () => {
  it('adds one source and one fill layer', () => {
    const map = new FakeMaskMap();
    expect(installNcrOutsideMask(map)).toBe(true);
    expect(map.sources).toEqual([NCR_OUTSIDE_MASK_SOURCE_ID]);
    expect(map.layers).toEqual([NCR_OUTSIDE_MASK_LAYER_ID]);
  });

  it('is idempotent (does not re-add if already present)', () => {
    const map = new FakeMaskMap();
    installNcrOutsideMask(map);
    installNcrOutsideMask(map);
    expect(map.layers).toEqual([NCR_OUTSIDE_MASK_LAYER_ID]);
    expect(map.sources).toEqual([NCR_OUTSIDE_MASK_SOURCE_ID]);
  });

  it('is a safe no-op on a map lacking style APIs (jsdom fake)', () => {
    const bare = {} as unknown as MaskMapAdapter;
    expect(installNcrOutsideMask(bare)).toBe(false);
  });

  it('never registers a pointer handler (mask cannot intercept NCR clicks)', () => {
    // The adapter only exposes addSource/addLayer/getLayer — installing the
    // mask must not require or use any `on`/event API.
    const on = vi.fn();
    const map = Object.assign(new FakeMaskMap(), { on });
    installNcrOutsideMask(map);
    expect(on).not.toHaveBeenCalled();
  });
});
