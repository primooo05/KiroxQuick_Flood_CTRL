// src/layers/LayerRegistry.test.ts
//
// Unit tests for LayerRegistry's fixed z-order insertion, visibility toggling,
// and removal. A FAKE map adapter records every addLayer/removeLayer/
// setLayoutProperty call and models a small layer stack, so none of this needs
// a real WebGL map (the test env is jsdom). Requirements 9.1, 9.2, 9.4;
// design → "Map layer ordering & z-index strategy".

import { describe, expect, it } from 'vitest';
import {
  APP_LAYER_ORDER,
  LayerRegistry,
  type AppLayerId,
  type MapLayerAdapter,
  type MapLayerSpec,
} from './LayerRegistry';

/** A single recorded addLayer call. */
interface AddCall {
  id: string;
  beforeId: string | undefined;
}

/**
 * A fake MapLayerAdapter that records calls and maintains an ordered stack of
 * layer ids (index 0 = bottom, last = top), mirroring Mapbox GL JS's
 * `addLayer(layer, beforeId)` insert-below-beforeId semantics. This lets tests
 * assert both the raw call sequence AND the resulting render order.
 */
class FakeMap implements MapLayerAdapter {
  /** Ordered layer ids, bottom (index 0) → top (last). */
  readonly stack: string[] = [];
  readonly addCalls: AddCall[] = [];
  readonly removeCalls: string[] = [];
  readonly layoutCalls: Array<{ id: string; name: string; value: unknown }> =
    [];

  /**
   * @param basemap - Pre-existing basemap layer ids, bottom → top, present
   *   before any app layer is added (mimics the style's own layers).
   */
  constructor(basemap: string[] = []) {
    this.stack.push(...basemap);
  }

  addLayer(layer: MapLayerSpec, beforeId?: string): void {
    this.addCalls.push({ id: layer.id, beforeId });
    if (beforeId !== undefined) {
      const index = this.stack.indexOf(beforeId);
      if (index !== -1) {
        // Insert BELOW beforeId (beforeId renders on top of the new layer).
        this.stack.splice(index, 0, layer.id);
        return;
      }
    }
    // No/unknown anchor → append on top.
    this.stack.push(layer.id);
  }

  removeLayer(id: string): void {
    this.removeCalls.push(id);
    const index = this.stack.indexOf(id);
    if (index !== -1) {
      this.stack.splice(index, 1);
    }
  }

  setLayoutProperty(id: string, name: string, value: unknown): void {
    this.layoutCalls.push({ id, name, value });
  }

  getLayer(id: string): unknown {
    return this.stack.includes(id) ? { id } : undefined;
  }
}

/** A minimal layer spec for an app layer id. */
function def(id: AppLayerId): MapLayerSpec {
  return { id, type: 'fill', source: id };
}

/** All four app layers as a defs map. */
function allDefs(): Partial<Record<AppLayerId, MapLayerSpec>> {
  return {
    floodReports: def('floodReports'),
    routeHighlights: def('routeHighlights'),
    roadFloodConditionSegments: def('roadFloodConditionSegments'),
    floodSusceptibility: def('floodSusceptibility'),
  };
}

/**
 * A realistic basemap stack, bottom → top, matching the design's basemap order
 * (background at the bottom, boundaries at the top of the basemap).
 */
const BASEMAP = [
  'background',
  'water',
  'parks',
  'buildings',
  'roads',
  'labels',
  'boundaries',
];

describe('LayerRegistry fixed z-order insertion (Req 9.1, 9.4)', () => {
  it('inserts app layers in the specified relative render order', () => {
    const map = new FakeMap([...BASEMAP]);
    const registry = new LayerRegistry(map);

    registry.addAppLayers(allDefs());

    // Resulting stack, bottom → top. The app layers must sit above the whole
    // basemap, and in the fixed relative order among themselves.
    const appPart = map.stack.filter((id) =>
      (APP_LAYER_ORDER as readonly string[]).includes(id),
    );
    // bottom → top of the app subset:
    expect(appPart).toEqual([
      'floodSusceptibility',
      'roadFloodConditionSegments',
      'routeHighlights',
      'floodReports',
    ]);

    // Top → bottom (render priority) is the reverse and must match the design
    // order for the four layers added here (cityFloodSummary is not added in
    // this test, so it is filtered out of the comparison).
    const addedIds = new Set(Object.keys(allDefs()));
    const topToBottom = [...appPart].reverse();
    expect(topToBottom).toEqual(
      APP_LAYER_ORDER.filter((id) => addedIds.has(id)),
    );
  });

  it('places flood reports above route highlights above segments above susceptibility', () => {
    const map = new FakeMap([...BASEMAP]);
    const registry = new LayerRegistry(map);

    registry.addAppLayers(allDefs());

    const pos = (id: string): number => map.stack.indexOf(id);
    // Higher index = closer to the top = rendered on top.
    expect(pos('floodReports')).toBeGreaterThan(pos('routeHighlights'));
    expect(pos('routeHighlights')).toBeGreaterThan(
      pos('roadFloodConditionSegments'),
    );
    expect(pos('roadFloodConditionSegments')).toBeGreaterThan(
      pos('floodSusceptibility'),
    );
  });

  it('places susceptibility ABOVE the basemap boundary/label/road layers', () => {
    const map = new FakeMap([...BASEMAP]);
    const registry = new LayerRegistry(map);

    registry.addAppLayers(allDefs());

    const pos = (id: string): number => map.stack.indexOf(id);
    // The lowest app layer still renders above every basemap layer.
    expect(pos('floodSusceptibility')).toBeGreaterThan(pos('boundaries'));
    expect(pos('floodSusceptibility')).toBeGreaterThan(pos('labels'));
    expect(pos('floodSusceptibility')).toBeGreaterThan(pos('roads'));
    expect(pos('floodSusceptibility')).toBeGreaterThan(pos('water'));
    expect(pos('floodSusceptibility')).toBeGreaterThan(pos('background'));
  });

  it('anchors each addLayer call with a beforeId that yields the fixed order', () => {
    const map = new FakeMap([...BASEMAP]);
    const registry = new LayerRegistry(map);

    registry.addAppLayers(allDefs());

    // Added top → bottom: the topmost app layer is appended on top of the whole
    // basemap (no beforeId); each lower layer is anchored BEFORE the app layer
    // directly above it, so Mapbox GL JS inserts it beneath that neighbour.
    expect(map.addCalls).toEqual([
      { id: 'floodReports', beforeId: undefined },
      { id: 'routeHighlights', beforeId: 'floodReports' },
      { id: 'roadFloodConditionSegments', beforeId: 'routeHighlights' },
      { id: 'floodSusceptibility', beforeId: 'roadFloodConditionSegments' },
    ]);
  });

  it('adding the top layer first appends above the basemap, then a lower layer slots beneath it', () => {
    const map = new FakeMap([...BASEMAP]);
    const registry = new LayerRegistry(map);

    // Add the TOP app layer alone: with no higher app layer present it is
    // appended on top of the whole basemap.
    registry.addAppLayer(def('floodReports'));
    expect(map.addCalls[0]).toEqual({
      id: 'floodReports',
      beforeId: undefined,
    });
    const pos = (id: string): number => map.stack.indexOf(id);
    expect(pos('floodReports')).toBeGreaterThan(pos('boundaries'));

    // Now add a lower app layer: it must land BELOW floodReports but still
    // ABOVE the basemap.
    registry.addAppLayer(def('floodSusceptibility'));
    expect(map.addCalls[1]).toEqual({
      id: 'floodSusceptibility',
      beforeId: 'floodReports',
    });
    expect(pos('floodReports')).toBeGreaterThan(pos('floodSusceptibility'));
    expect(pos('floodSusceptibility')).toBeGreaterThan(pos('boundaries'));
  });

  it('appends on top when there is no basemap at all (keeps map usable)', () => {
    const map = new FakeMap([]); // no basemap layers at all
    const registry = new LayerRegistry(map);

    registry.addAppLayers(allDefs());

    // The resulting relative order among app layers is still correct (only the
    // four layers in allDefs() were added).
    const addedIds = new Set(Object.keys(allDefs()));
    const topToBottom = [...map.stack].reverse();
    expect(topToBottom).toEqual(
      APP_LAYER_ORDER.filter((id) => addedIds.has(id)),
    );
  });

  it('rejects a non-app-managed layer id', () => {
    const map = new FakeMap([...BASEMAP]);
    const registry = new LayerRegistry(map);
    expect(() => registry.addAppLayer({ id: 'roads' })).toThrow();
  });
});

describe('LayerRegistry.setVisibility toggles without reordering (Req 9.2, 9.4)', () => {
  it('toggles visibility via setLayoutProperty and never removes/re-adds', () => {
    const map = new FakeMap([...BASEMAP]);
    const registry = new LayerRegistry(map);
    registry.addAppLayers(allDefs());

    const stackBefore = [...map.stack];
    const addCountBefore = map.addCalls.length;

    registry.setVisibility('floodSusceptibility', false);
    registry.setVisibility('floodReports', false);
    registry.setVisibility('floodSusceptibility', true);

    // Visibility changes go through setLayoutProperty('visibility', ...).
    expect(map.layoutCalls).toEqual([
      { id: 'floodSusceptibility', name: 'visibility', value: 'none' },
      { id: 'floodReports', name: 'visibility', value: 'none' },
      { id: 'floodSusceptibility', name: 'visibility', value: 'visible' },
    ]);

    // No remove/re-add happened, and the stack order is unchanged.
    expect(map.removeCalls).toHaveLength(0);
    expect(map.addCalls).toHaveLength(addCountBefore);
    expect(map.stack).toEqual(stackBefore);
  });

  it('is a no-op for a layer that was never added', () => {
    const map = new FakeMap([...BASEMAP]);
    const registry = new LayerRegistry(map);

    registry.setVisibility('floodReports', false);
    expect(map.layoutCalls).toHaveLength(0);
  });
});

describe('LayerRegistry.removeAppLayer (Req 9.4)', () => {
  it('removes the layer from the map and clears tracking', () => {
    const map = new FakeMap([...BASEMAP]);
    const registry = new LayerRegistry(map);
    registry.addAppLayers(allDefs());

    expect(registry.has('floodReports')).toBe(true);

    registry.removeAppLayer('floodReports');

    expect(map.removeCalls).toEqual(['floodReports']);
    expect(map.stack).not.toContain('floodReports');
    expect(registry.has('floodReports')).toBe(false);

    // The rest of the stack keeps its relative order.
    const appPart = map.stack.filter((id) =>
      (APP_LAYER_ORDER as readonly string[]).includes(id),
    );
    expect(appPart).toEqual([
      'floodSusceptibility',
      'roadFloodConditionSegments',
      'routeHighlights',
    ]);
  });

  it('is a no-op when removing a layer that was never added', () => {
    const map = new FakeMap([...BASEMAP]);
    const registry = new LayerRegistry(map);

    registry.removeAppLayer('floodReports');
    expect(map.removeCalls).toHaveLength(0);
  });
});
