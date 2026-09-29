// src/layers/floodSusceptibilityLayer.test.ts
//
// Unit tests for the flood-susceptibility layer definition (Task 10.1).
//
// These build the layer as DATA and drive a FAKE map adapter + a real
// LayerRegistry — no WebGL map is required (test env is jsdom). We assert:
//   - the fill layer is a translucent, zoom-faded area polygon (Req 2.1, 12.2);
//   - fill-color is data-driven by `level` using the reserved palette (Req 2.2,
//     13.1);
//   - opacity is < 1 at every stop (translucent, base features visible under);
//   - the layer registers ABOVE the basemap and in the fixed app z-order via
//     LayerRegistry (Req 9.1, 9.4);
//   - a NON-COLOR cue (per-level outline dash) is present (Req 11.4);
//   - the GeoJSON source is built from the demo fixtures and features carry
//     `level` + `source` + `updatedAt`.

import { describe, expect, it } from 'vitest';

import {
  SUSCEPTIBILITY_SOURCE_ID,
  SUSCEPTIBILITY_FILL_LAYER_ID,
  SUSCEPTIBILITY_OUTLINE_LAYER_ID,
  SUSCEPTIBILITY_OUTLINE_DASHARRAYS,
  buildSusceptibilityFillLayer,
  buildSusceptibilityOutlineLayer,
  buildSusceptibilitySource,
  susceptibilityFillColorExpression,
  installFloodSusceptibility,
  susceptibilityIsAreaPolygon,
  type MapLayerSpec,
} from './floodSusceptibilityLayer';
import {
  SUSCEPTIBILITY_OPACITY_STOPS,
  susceptibilityFillOpacityExpression,
} from './zoomOpacity';
import { SUSCEPTIBILITY_COLORS } from '../map/basemap/colorTokens';
import {
  APP_LAYER_ORDER,
  LayerRegistry,
  type MapLayerAdapter,
} from './LayerRegistry';

// ---------------------------------------------------------------------------
// Fake map: records addSource + addLayer, and models an ordered layer stack.
// ---------------------------------------------------------------------------

interface AddCall {
  id: string;
  beforeId: string | undefined;
}

/**
 * A fake adapter satisfying BOTH the LayerRegistry's MapLayerAdapter and the
 * susceptibility layer's map surface. It maintains an ordered stack (index 0 =
 * bottom, last = top) with Mapbox GL JS's insert-below-beforeId semantics.
 */
class FakeMap implements MapLayerAdapter {
  readonly stack: string[] = [];
  readonly addCalls: AddCall[] = [];
  readonly sources = new Map<string, unknown>();

  constructor(basemap: string[] = []) {
    this.stack.push(...basemap);
  }

  addSource(id: string, source: unknown): void {
    this.sources.set(id, source);
  }

  addLayer(layer: MapLayerSpec, beforeId?: string): void {
    this.addCalls.push({ id: layer.id, beforeId });
    if (beforeId !== undefined) {
      const index = this.stack.indexOf(beforeId);
      if (index !== -1) {
        this.stack.splice(index, 0, layer.id);
        return;
      }
    }
    this.stack.push(layer.id);
  }

  removeLayer(id: string): void {
    const index = this.stack.indexOf(id);
    if (index !== -1) this.stack.splice(index, 1);
  }

  setLayoutProperty(): void {
    /* not exercised here */
  }

  getLayer(id: string): unknown {
    return this.stack.includes(id) ? { id } : undefined;
  }
}

const BASEMAP = [
  'background',
  'water',
  'parks',
  'buildings',
  'roads',
  'labels',
  'boundaries',
];

// ---------------------------------------------------------------------------
// Fill layer: type, color, opacity
// ---------------------------------------------------------------------------

describe('buildSusceptibilityFillLayer (Req 12.2, 2.1)', () => {
  it('is an area-polygon fill layer with the fixed app id and source', () => {
    const layer = buildSusceptibilityFillLayer();
    expect(layer.id).toBe(SUSCEPTIBILITY_FILL_LAYER_ID);
    expect(layer.id).toBe('floodSusceptibility');
    expect(layer.type).toBe('fill');
    expect(layer.source).toBe(SUSCEPTIBILITY_SOURCE_ID);
  });

  it('uses the shared zoom-faded fill-opacity expression', () => {
    const layer = buildSusceptibilityFillLayer();
    expect(layer.paint['fill-opacity']).toEqual(
      susceptibilityFillOpacityExpression(),
    );
  });

  it('is translucent (opacity < 1) at every zoom stop, never fully opaque', () => {
    for (const stop of SUSCEPTIBILITY_OPACITY_STOPS) {
      expect(stop.opacity).toBeLessThan(1);
      expect(stop.opacity).toBeGreaterThan(0);
    }
  });

  it('has a non-increasing (zoom-faded) opacity: prominent at ~z10, faint by ~z17', () => {
    const stops = SUSCEPTIBILITY_OPACITY_STOPS;
    for (let i = 0; i < stops.length - 1; i += 1) {
      expect(stops[i].opacity).toBeGreaterThanOrEqual(stops[i + 1].opacity);
    }
    // Overview prominent, street level de-emphasized.
    expect(stops[0].opacity).toBeGreaterThan(stops[stops.length - 1].opacity);
  });

  it('maps HIGH/MODERATE/LOW to the reserved SUSCEPTIBILITY_COLORS hexes', () => {
    const expr = susceptibilityFillColorExpression();
    expect(expr[0]).toBe('match');
    expect(expr[1]).toEqual(['get', 'level']);

    // Structure: ["match", ["get","level"], "HIGH", <red>, "MODERATE",
    // <orange>, "LOW", <yellow>, <fallback>].
    expect(expr).toEqual([
      'match',
      ['get', 'level'],
      'HIGH',
      SUSCEPTIBILITY_COLORS.HIGH.hex,
      'MODERATE',
      SUSCEPTIBILITY_COLORS.MODERATE.hex,
      'LOW',
      SUSCEPTIBILITY_COLORS.LOW.hex,
      SUSCEPTIBILITY_COLORS.LOW.hex,
    ]);

    // And the fill layer carries exactly that expression.
    expect(buildSusceptibilityFillLayer().paint['fill-color']).toEqual(expr);
  });

  it('renders susceptibility as an AREA POLYGON, distinct from report symbols', () => {
    expect(susceptibilityIsAreaPolygon()).toBe(true);
    expect(buildSusceptibilityFillLayer().type).toBe('fill');
  });
});

// ---------------------------------------------------------------------------
// Non-color cue: outline dash per level
// ---------------------------------------------------------------------------

describe('buildSusceptibilityOutlineLayer non-color cue (Req 11.4)', () => {
  it('is a line layer over the same source with a per-level dash pattern', () => {
    const outline = buildSusceptibilityOutlineLayer();
    expect(outline.id).toBe(SUSCEPTIBILITY_OUTLINE_LAYER_ID);
    expect(outline.type).toBe('line');
    expect(outline.source).toBe(SUSCEPTIBILITY_SOURCE_ID);

    const dash = outline.paint['line-dasharray'];
    expect(dash[0]).toBe('match');
    expect(dash[1]).toEqual(['get', 'level']);
    // The dash expression references the per-level dash arrays.
    expect(dash).toContain('HIGH');
    expect(dash).toContain('MODERATE');
    expect(dash).toContain('LOW');
  });

  it('encodes distinct dash patterns per level (denser == higher)', () => {
    const { HIGH, MODERATE, LOW } = SUSCEPTIBILITY_OUTLINE_DASHARRAYS;
    expect(HIGH).not.toEqual(MODERATE);
    expect(MODERATE).not.toEqual(LOW);
    expect(HIGH).not.toEqual(LOW);
  });
});

// ---------------------------------------------------------------------------
// Registration z-order via LayerRegistry
// ---------------------------------------------------------------------------

describe('installFloodSusceptibility registration (Req 9.1, 9.4)', () => {
  it('adds the source and registers the fill above the basemap', async () => {
    const map = new FakeMap([...BASEMAP]);
    const registry = new LayerRegistry(map);

    const installed = await installFloodSusceptibility(map, registry);

    // Source added.
    expect(map.sources.has(SUSCEPTIBILITY_SOURCE_ID)).toBe(true);
    expect(installed.sourceId).toBe(SUSCEPTIBILITY_SOURCE_ID);

    const pos = (id: string): number => map.stack.indexOf(id);
    // Fill sits ABOVE every basemap layer.
    expect(pos('floodSusceptibility')).toBeGreaterThan(pos('boundaries'));
    expect(pos('floodSusceptibility')).toBeGreaterThan(pos('labels'));
    expect(pos('floodSusceptibility')).toBeGreaterThan(pos('roads'));
    expect(pos('floodSusceptibility')).toBeGreaterThan(pos('background'));
  });

  it('places susceptibility BELOW reports/routes/segments in the app z-order', async () => {
    const map = new FakeMap([...BASEMAP]);
    const registry = new LayerRegistry(map);

    // Pre-register the higher app layers so ordering is observable.
    registry.addAppLayer({ id: 'floodReports', type: 'symbol', source: 'r' });
    registry.addAppLayer({
      id: 'routeHighlights',
      type: 'line',
      source: 'rt',
    });
    registry.addAppLayer({
      id: 'roadFloodConditionSegments',
      type: 'line',
      source: 'seg',
    });

    await installFloodSusceptibility(map, registry);

    const pos = (id: string): number => map.stack.indexOf(id);
    // floodSusceptibility is the LOWEST app layer.
    expect(pos('floodSusceptibility')).toBeLessThan(
      pos('roadFloodConditionSegments'),
    );
    expect(pos('floodSusceptibility')).toBeLessThan(pos('routeHighlights'));
    expect(pos('floodSusceptibility')).toBeLessThan(pos('floodReports'));

    // The app subset order matches the design's fixed order for the layers
    // added here (cityFloodSummary is not installed in this test).
    const added = new Set([
      'floodReports',
      'routeHighlights',
      'roadFloodConditionSegments',
      'floodSusceptibility',
    ]);
    const appPart = map.stack.filter((id) => added.has(id));
    expect([...appPart].reverse()).toEqual(
      APP_LAYER_ORDER.filter((id) => added.has(id)),
    );
  });

  it('adds the outline companion on top of the fill (non-color cue is drawn)', async () => {
    const map = new FakeMap([...BASEMAP]);
    const registry = new LayerRegistry(map);

    await installFloodSusceptibility(map, registry);

    const pos = (id: string): number => map.stack.indexOf(id);
    expect(pos(SUSCEPTIBILITY_OUTLINE_LAYER_ID)).toBeGreaterThan(
      pos('floodSusceptibility'),
    );
  });
});

// ---------------------------------------------------------------------------
// GeoJSON source from demo fixtures
// ---------------------------------------------------------------------------

describe('buildSusceptibilitySource (from demo fixtures)', () => {
  it('builds a GeoJSON source whose features carry level + source + updatedAt', async () => {
    const source = await buildSusceptibilitySource();

    expect(source.type).toBe('geojson');
    expect(source.data.type).toBe('FeatureCollection');
    expect(source.data.features.length).toBeGreaterThan(0);

    for (const feature of source.data.features) {
      const props = feature.properties ?? {};
      expect(['HIGH', 'MODERATE', 'LOW']).toContain(props.level);
      expect(typeof props.source).toBe('string');
      expect((props.source as string).length).toBeGreaterThan(0);
      expect(typeof props.updatedAt).toBe('number');
      // Susceptibility geometry is a polygon area (not a point symbol).
      expect(['Polygon', 'MultiPolygon']).toContain(feature.geometry.type);
    }
  });

  it('includes all three susceptibility levels present in the demo fixtures', async () => {
    const source = await buildSusceptibilitySource();
    const levels = new Set(
      source.data.features.map((f) => (f.properties ?? {}).level),
    );
    expect(levels.has('HIGH')).toBe(true);
    expect(levels.has('MODERATE')).toBe(true);
    expect(levels.has('LOW')).toBe(true);
  });
});
