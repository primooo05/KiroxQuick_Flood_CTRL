// src/layers/historicalFloodRisk.test.ts
import { describe, expect, it } from 'vitest';
import {
  isBarangayShown,
  computeShownByBarangay,
  shownCount,
  emphasisFor,
  computeEmphasisByBarangay,
  applyHistoricalRiskStates,
  applyHistoricalFilter,
  historicalFillOpacityExpression,
  setSelectedHistoricalBarangay,
  barangayBounds,
  cityBounds,
  DEFAULT_HISTORICAL_FILTER,
  HISTORICAL_RISK_SOURCE_ID,
  HISTORICAL_RISK_STATE_KEY,
  HISTORICAL_FILTER_STATE_KEY,
  HISTORICAL_SELECTED_STATE_KEY,
  HISTORICAL_EMPHASIS_STATE_KEY,
  type HistoricalFilterState,
} from './historicalFloodRisk';
import {
  historicalRiskRecords,
  historicalRiskByBarangay,
  historicalCitySummaries,
  historicalClassFor,
  historicalDatasetMeta,
} from '../data/historical/ncrHistoricalFloodRisk';

const withFilter = (o: Partial<HistoricalFilterState>): HistoricalFilterState => ({
  ...DEFAULT_HISTORICAL_FILTER,
  ...o,
});

describe('historical dataset loader + provenance', () => {
  it('loads 1,710 NCR barangays with derived classes', () => {
    expect(historicalRiskRecords.length).toBe(1710);
  });

  it('preserves provenance on every record (never fabricated)', () => {
    for (const r of historicalRiskRecords.slice(0, 50)) {
      expect(r.source).toContain('Project NOAH');
      expect(r.sourceYear).toBeGreaterThan(2010);
      expect(r.returnPeriod).toBe('100yr');
      expect(['High', 'Medium', 'Low']).toContain(r.confidence);
    }
  });

  it('exposes dataset-level license + classification rule', () => {
    expect(historicalDatasetMeta.license).toBe('ODbL');
    expect(historicalDatasetMeta.classificationRule).toMatch(/Unknown/);
    expect(historicalDatasetMeta.returnPeriodsAvailable).toEqual(
      expect.arrayContaining(['5yr', '25yr', '100yr']),
    );
  });

  it('aggregates all 17 NCR LGUs, derived from the barangay dataset', () => {
    expect(historicalCitySummaries.length).toBe(17);
    for (const c of historicalCitySummaries) {
      const sum =
        c.lowCount + c.moderateCount + c.highCount + c.unknownCount;
      expect(sum).toBe(c.barangayCount);
    }
  });

  it('never classifies missing coverage as Low (Unknown instead)', () => {
    // Every Unknown must have zero exposed area; no exposed barangay is Unknown.
    for (const r of historicalRiskRecords) {
      if (r.historicalRiskClass === 'Unknown') {
        expect(r.exposedAreaKm2).toBe(0);
      }
    }
  });

  it('historicalClassFor returns Unknown for an unknown PSGC', () => {
    expect(historicalClassFor('DOES-NOT-EXIST')).toBe('Unknown');
  });
});

describe('historical filter logic (pure)', () => {
  const sample = historicalRiskRecords[0];

  it('NCR view shows all barangays when risk = all', () => {
    expect(shownCount(withFilter({ view: 'ncr', risk: 'all' }))).toBe(1710);
  });

  it('risk filter matches only that class (Unknown selectable)', () => {
    const unknownCount = historicalRiskRecords.filter(
      (r) => r.historicalRiskClass === 'Unknown',
    ).length;
    expect(shownCount(withFilter({ risk: 'Unknown' }))).toBe(unknownCount);
    expect(unknownCount).toBeGreaterThan(0);
  });

  it('city view shows only the selected city, none when unset', () => {
    const city = historicalCitySummaries.find((c) => c.barangayCount > 0)!;
    const shown = shownCount(withFilter({ view: 'city', cityPsgc: city.cityPsgc }));
    expect(shown).toBe(city.barangayCount);
    expect(shownCount(withFilter({ view: 'city', cityPsgc: null }))).toBe(0);
  });

  it('barangay view shows only the selected barangay', () => {
    expect(
      shownCount(withFilter({ view: 'barangay', barangayPsgc: sample.psgc })),
    ).toBe(1);
    expect(shownCount(withFilter({ view: 'barangay', barangayPsgc: null }))).toBe(0);
  });

  it('combines city + risk filters', () => {
    const city = historicalCitySummaries.find((c) => c.highCount > 0)!;
    const shown = computeShownByBarangay(
      withFilter({ view: 'city', cityPsgc: city.cityPsgc, risk: 'High' }),
    );
    for (const [psgc, isShown] of shown) {
      if (isShown) {
        const rec = historicalRiskByBarangay.get(psgc)!;
        expect(rec.cityPsgc).toBe(city.cityPsgc);
        expect(rec.historicalRiskClass).toBe('High');
      }
    }
  });

  it('isBarangayShown respects the risk filter regardless of view', () => {
    expect(
      isBarangayShown('X', 'CITY', 'Low', withFilter({ view: 'ncr', risk: 'High' })),
    ).toBe(false);
    expect(
      isBarangayShown('X', 'CITY', 'High', withFilter({ view: 'ncr', risk: 'High' })),
    ).toBe(true);
  });
});

describe('historical feature-state paints', () => {
  function fakeMap() {
    const risk = new Map<string, string>();
    const shown = new Map<string, boolean>();
    return {
      risk,
      shown,
      setFeatureState(
        t: { source: string; id: string | number },
        s: Record<string, unknown>,
      ): void {
        expect(t.source).toBe(HISTORICAL_RISK_SOURCE_ID);
        if (typeof s[HISTORICAL_RISK_STATE_KEY] === 'string') {
          risk.set(String(t.id), s[HISTORICAL_RISK_STATE_KEY] as string);
        }
        if (typeof s[HISTORICAL_FILTER_STATE_KEY] === 'boolean') {
          shown.set(String(t.id), s[HISTORICAL_FILTER_STATE_KEY] as boolean);
        }
      },
    };
  }

  it('writes the derived class for every barangay', () => {
    const map = fakeMap();
    applyHistoricalRiskStates(map);
    expect(map.risk.size).toBe(1710);
    const s = historicalRiskRecords[0];
    expect(map.risk.get(s.psgc)).toBe(s.historicalRiskClass);
  });

  it('writes shown=true for NCR/all and false for filtered-out', () => {
    const map = fakeMap();
    const city = historicalCitySummaries[0];
    applyHistoricalFilter(map, {
      view: 'city',
      cityPsgc: city.cityPsgc,
      barangayPsgc: null,
      risk: 'all',
    });
    // A barangay outside the city must be hidden.
    const outside = historicalRiskRecords.find((r) => r.cityPsgc !== city.cityPsgc)!;
    expect(map.shown.get(outside.psgc)).toBe(false);
    const inside = historicalRiskRecords.find((r) => r.cityPsgc === city.cityPsgc)!;
    expect(map.shown.get(inside.psgc)).toBe(true);
  });

  it('is a safe no-op on a map without setFeatureState', () => {
    expect(() => applyHistoricalRiskStates(null)).not.toThrow();
    expect(() =>
      applyHistoricalFilter(undefined, DEFAULT_HISTORICAL_FILTER),
    ).not.toThrow();
  });
});

describe('drill-down emphasis tiers (scope-aware)', () => {
  const wf = (o: Partial<HistoricalFilterState>): HistoricalFilterState => ({
    ...DEFAULT_HISTORICAL_FILTER,
    ...o,
  });

  it('NCR view: everything in scope; risk filter dims non-matching', () => {
    expect(emphasisFor('X', 'C', 'High', wf({ view: 'ncr', risk: 'all' }))).toBe('in');
    expect(emphasisFor('X', 'C', 'Low', wf({ view: 'ncr', risk: 'High' }))).toBe('dim');
    expect(emphasisFor('X', 'C', 'High', wf({ view: 'ncr', risk: 'High' }))).toBe('in');
  });

  it('City view: outside the city is "out"; inside matches "in", non-match "dim"', () => {
    const f = wf({ view: 'city', cityPsgc: 'C1', risk: 'High' });
    expect(emphasisFor('a', 'C2', 'High', f)).toBe('out');
    expect(emphasisFor('a', 'C1', 'High', f)).toBe('in');
    expect(emphasisFor('a', 'C1', 'Low', f)).toBe('dim');
  });

  it('Barangay view: selected barangay is "focus", siblings "dim", others "out"', () => {
    const f = wf({ view: 'barangay', cityPsgc: 'C1', barangayPsgc: 'b1' });
    expect(emphasisFor('b1', 'C1', 'Low', f)).toBe('focus');
    expect(emphasisFor('b2', 'C1', 'High', f)).toBe('dim');
    expect(emphasisFor('b3', 'C2', 'High', f)).toBe('out');
  });

  it('computeEmphasisByBarangay covers every barangay', () => {
    const m = computeEmphasisByBarangay(wf({ view: 'ncr' }));
    expect(m.size).toBe(1710);
  });

  it('applyHistoricalFilter writes the emphasis tier per barangay', () => {
    const states = new Map<string, string>();
    const map = {
      setFeatureState(t: { id: string | number }, s: Record<string, unknown>) {
        if (typeof s[HISTORICAL_EMPHASIS_STATE_KEY] === 'string') {
          states.set(String(t.id), s[HISTORICAL_EMPHASIS_STATE_KEY] as string);
        }
      },
    };
    const city = historicalCitySummaries.find((c) => c.barangayCount > 3)!;
    applyHistoricalFilter(map, {
      view: 'city',
      cityPsgc: city.cityPsgc,
      barangayPsgc: null,
      risk: 'all',
    });
    const inside = historicalRiskRecords.find((r) => r.cityPsgc === city.cityPsgc)!;
    const outside = historicalRiskRecords.find((r) => r.cityPsgc !== city.cityPsgc)!;
    expect(states.get(inside.psgc)).toBe('in');
    expect(states.get(outside.psgc)).toBe('out');
  });
});

describe('historical DIM-NOT-HIDE emphasis (fill opacity)', () => {
  // The fill opacity is a Mapbox `case` expression. We assert its SHAPE encodes
  // "de-emphasized barangays stay visible (non-zero), not hidden".
  it('keeps every tier visible (dim/out are low but non-zero, never hidden)', () => {
    const expr = historicalFillOpacityExpression() as unknown[];
    expect(expr[0]).toBe('case');
    const flat = JSON.stringify(expr);
    // 'out' tier stays faintly visible (0.06), 'dim' 0.12 — never a whole 0 hide.
    expect(flat).toContain('0.06');
    expect(flat).toContain('0.12');
    // No branch value is a literal 0 (dim-not-hide).
    for (let i = 2; i < expr.length; i += 2) {
      expect(expr[i]).not.toBe(0);
    }
  });

  it('the selected (focus) tier gets the strongest fill', () => {
    const flat = JSON.stringify(historicalFillOpacityExpression());
    expect(flat).toContain('focus');
    expect(flat).toContain('interpolate');
    expect(flat).toContain('0.62'); // focus low-zoom classified opacity
  });
});

describe('historical selected-barangay outline', () => {
  it('sets and clears the selection feature-state', () => {
    const calls: Array<{ id: unknown; state: Record<string, unknown> }> = [];
    const map = {
      setFeatureState(t: { source: string; id: string | number }, s: Record<string, unknown>) {
        calls.push({ id: t.id, state: s });
      },
    };
    setSelectedHistoricalBarangay(map, 'PH1307404001', null);
    expect(calls[calls.length - 1]).toMatchObject({
      id: 'PH1307404001',
      state: { [HISTORICAL_SELECTED_STATE_KEY]: true },
    });
    setSelectedHistoricalBarangay(map, 'PH1307404002', 'PH1307404001');
    // Previous cleared, new set.
    expect(calls.some((c) => c.id === 'PH1307404001' && c.state[HISTORICAL_SELECTED_STATE_KEY] === false)).toBe(true);
    expect(calls[calls.length - 1]).toMatchObject({
      id: 'PH1307404002',
      state: { [HISTORICAL_SELECTED_STATE_KEY]: true },
    });
  });

  it('is a safe no-op without setFeatureState', () => {
    expect(() => setSelectedHistoricalBarangay(null, 'X', null)).not.toThrow();
  });
});

describe('historical camera bounds helpers', () => {
  it('barangayBounds returns a tight [[w,s],[e,n]] tuple for a real barangay', () => {
    const psgc = historicalRiskRecords[0].psgc;
    const b = barangayBounds(psgc);
    expect(b).not.toBeNull();
    const [[w, s], [e, n]] = b!;
    expect(w).toBeLessThanOrEqual(e);
    expect(s).toBeLessThanOrEqual(n);
    // Within the NCR bounding box.
    expect(w).toBeGreaterThan(120);
    expect(e).toBeLessThan(122);
  });

  it('barangayBounds returns null for an unknown PSGC', () => {
    expect(barangayBounds('DOES-NOT-EXIST')).toBeNull();
  });

  it('cityBounds covers a whole city (wider than any single barangay in it)', () => {
    const city = historicalCitySummaries.find((c) => c.barangayCount > 5)!;
    const cb = cityBounds(city.cityPsgc)!;
    expect(cb).not.toBeNull();
    const cityWidth = cb[1][0] - cb[0][0];
    // A member barangay's width must not exceed the city's width.
    const member = historicalRiskRecords.find((r) => r.cityPsgc === city.cityPsgc)!;
    const bb = barangayBounds(member.psgc)!;
    const bWidth = bb[1][0] - bb[0][0];
    expect(cityWidth).toBeGreaterThanOrEqual(bWidth);
  });
});

// --- Barangay NAME+CLASS label layers (zoom-aware, city-scoped, collision) ---

import {
  buildHistoricalBarangayLabelLayer,
  buildHistoricalSelectedLabelLayer,
  buildBarangayLabelSource,
  cityLabelFilter,
  selectedLabelFilter,
  HISTORICAL_LABEL_LAYER_ID,
  HISTORICAL_LABEL_SELECTED_LAYER_ID,
  HISTORICAL_LABEL_SOURCE_ID,
  HISTORICAL_LABEL_MIN_ZOOM,
} from './historicalFloodRisk';

/** The historical risk classes we expect to appear as label `cls` props. */
const VALID_CLASSES = new Set(['Low', 'Moderate', 'High', 'Unknown']);

describe('buildBarangayLabelSource (display projection, not a risk source)', () => {
  const source = buildBarangayLabelSource();

  it('is a point source keyed by official psgc with one feature per barangay', () => {
    expect(source.type).toBe('geojson');
    expect(source.promoteId).toBe('psgc');
    expect(source.data.features.length).toBe(historicalRiskRecords.length);
    expect(source.data.features.every((f) => f.geometry.type === 'Point')).toBe(true);
  });

  it('carries the OFFICIAL barangay name verbatim + the derived class (no invented data)', () => {
    const rec = historicalRiskByBarangay.get(historicalRiskRecords[0].psgc)!;
    const feat = source.data.features.find((f) => f.id === rec.psgc)!;
    expect(feat.properties?.brgy).toBe(rec.name); // exact official name
    expect(feat.properties?.cls).toBe(rec.historicalRiskClass); // derived class, unchanged
    expect(feat.properties?.cityPsgc).toBe(rec.cityPsgc);
  });

  it('only ever carries the four documented classes', () => {
    for (const f of source.data.features) {
      expect(VALID_CLASSES.has(f.properties?.cls as string)).toBe(true);
    }
  });
});

describe('buildHistoricalBarangayLabelLayer (zoom-aware city labels)', () => {
  const layer = buildHistoricalBarangayLabelLayer() as {
    id: string;
    type: string;
    source: string;
    minzoom: number;
    filter: unknown;
    layout: Record<string, unknown>;
    paint: Record<string, unknown>;
  };

  it('is a symbol layer on the dedicated label point source', () => {
    expect(layer.id).toBe(HISTORICAL_LABEL_LAYER_ID);
    expect(layer.type).toBe('symbol');
    expect(layer.source).toBe(HISTORICAL_LABEL_SOURCE_ID);
  });

  it('labels show official name + class and never appear at NCR/low zoom', () => {
    // text-field is a format expression that reads brgy + upcased cls.
    const tf = JSON.stringify(layer.layout['text-field']);
    expect(tf).toContain('format');
    expect(tf).toContain('brgy');
    expect(tf).toContain('cls');
    expect(tf).toContain('upcase');
    expect(layer.minzoom).toBe(HISTORICAL_LABEL_MIN_ZOOM);
    expect(HISTORICAL_LABEL_MIN_ZOOM).toBeGreaterThanOrEqual(12);
  });

  it('uses Mapbox collision handling so labels never overcrowd', () => {
    expect(layer.layout['text-allow-overlap']).toBe(false);
    expect(layer.layout['text-ignore-placement']).toBe(false);
    expect(layer.layout['text-optional']).toBe(true);
  });

  it('text-size grows with zoom (more labels fit as you zoom in)', () => {
    const size = layer.layout['text-size'] as unknown[];
    expect(size[0]).toBe('interpolate');
    const stops = size.slice(3) as number[];
    const sizes = stops.filter((_, i) => i % 2 === 1);
    for (let i = 1; i < sizes.length; i += 1) {
      expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
    }
  });

  it('starts scoped to NOTHING so NCR overview is label-free', () => {
    expect(layer.filter).toEqual(['==', ['get', 'cityPsgc'], '__none__']);
  });
});

describe('buildHistoricalSelectedLabelLayer (always-visible selected label)', () => {
  const layer = buildHistoricalSelectedLabelLayer() as {
    id: string;
    type: string;
    source: string;
    minzoom?: number;
    filter: unknown;
    layout: Record<string, unknown>;
  };

  it('is a symbol layer on the label source with NO minzoom (always visible)', () => {
    expect(layer.id).toBe(HISTORICAL_LABEL_SELECTED_LAYER_ID);
    expect(layer.source).toBe(HISTORICAL_LABEL_SOURCE_ID);
    expect(layer.minzoom).toBeUndefined();
  });

  it('overrides collision so the selected label is never dropped', () => {
    expect(layer.layout['text-allow-overlap']).toBe(true);
    expect(layer.layout['text-ignore-placement']).toBe(true);
  });

  it('starts scoped to NOTHING (no selection → no stray label)', () => {
    expect(layer.filter).toEqual(['==', ['get', 'psgc'], '__none__']);
  });
});

describe('label filters', () => {
  it('cityLabelFilter scopes to the selected city, or nothing (risk=all)', () => {
    const city = historicalCitySummaries[0].cityPsgc;
    expect(cityLabelFilter(city)).toEqual(['==', ['get', 'cityPsgc'], city]);
    expect(cityLabelFilter(null)).toEqual(['==', ['get', 'cityPsgc'], '__none__']);
  });

  it('cityLabelFilter ALSO applies the active risk filter so labels match the panel/emphasis', () => {
    const city = historicalCitySummaries[0].cityPsgc;
    expect(cityLabelFilter(city, 'High')).toEqual([
      'all',
      ['==', ['get', 'cityPsgc'], city],
      ['==', ['get', 'cls'], 'High'],
    ]);
    // Unknown is a real selectable class, not dropped.
    expect(cityLabelFilter(city, 'Unknown')).toEqual([
      'all',
      ['==', ['get', 'cityPsgc'], city],
      ['==', ['get', 'cls'], 'Unknown'],
    ]);
  });

  it('selectedLabelFilter scopes to one barangay psgc, or nothing', () => {
    const psgc = historicalRiskRecords[0].psgc;
    expect(selectedLabelFilter(psgc)).toEqual(['==', ['get', 'psgc'], psgc]);
    expect(selectedLabelFilter(null)).toEqual(['==', ['get', 'psgc'], '__none__']);
  });
});
