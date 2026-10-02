// src/services/routePlanning.test.ts
//
// Flood-aware route planning + comparison. Verifies: the flagship PITX→MOA pair
// yields the bundled real route + its flood-avoiding alternative (offline); a
// generic NCR pair is routed via Mapbox Directions (road-following) and falls
// back to a straight line only when routing is unavailable; risk aggregation
// respects the flood semantics (UNKNOWN/STALE never treated as LOW; closures
// are the strongest signal; demo hazards contribute); the recommendation is
// balanced (not merely fastest); and "Why this route?" never uses banned
// safety language.

import { describe, it, expect } from 'vitest';
import {
  planRoutes,
  summarizeRouteRisk,
  compareRoutes,
  isRouteStartBlocked,
  type RouteCandidate,
} from './routePlanning';
import type { FetchLike } from './directions';
import type { DriveHazard } from '../data/fixtures/driveHazards';
import { PITX_TO_MOA_ROUTE } from '../data/fixtures/pitxToMoaRoute';
import type { CurrentRiskLevel } from '../types/risk';

const PITX = PITX_TO_MOA_ROUTE[0];
const MOA = PITX_TO_MOA_ROUTE[PITX_TO_MOA_ROUTE.length - 1];

/** A fake Directions response with a small multi-vertex (road-like) line. */
const ROADLIKE: [number, number][] = [
  [121.0, 14.6],
  [121.02, 14.605],
  [121.03, 14.612],
  [121.05, 14.62],
];
const okFetch: FetchLike = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    code: 'Ok',
    routes: [
      {
        distance: 3000,
        duration: 600,
        geometry: { type: 'LineString', coordinates: ROADLIKE },
        legs: [
          {
            steps: [
              { distance: 1500, name: 'A St', maneuver: { type: 'depart', instruction: 'Go' } },
              { distance: 1500, name: 'B St', maneuver: { type: 'turn', modifier: 'left', instruction: 'Turn left' } },
              { distance: 0, name: '', maneuver: { type: 'arrive', instruction: 'Arrive' } },
            ],
          },
        ],
      },
    ],
  }),
});
/** A fetch that always fails, forcing the straight-line fallback. */
const failFetch: FetchLike = async () => ({ ok: false, status: 500, json: async () => ({}) });

/** A generic road-following candidate (via the fake Directions fetch). */
async function genericCandidate(): Promise<RouteCandidate> {
  const routes = await planRoutes([121.0, 14.6], [121.05, 14.62], {
    mapboxToken: 't',
    fetchImpl: okFetch,
  });
  return routes[0];
}

describe('planRoutes', () => {
  it('returns the real route + flood-avoiding alternative for PITX→MOA', async () => {
    const routes = await planRoutes(PITX, MOA);
    expect(routes.length).toBe(2);
    expect(routes[0].id).toBe('pitx-moa-primary');
    expect(routes[1].id).toBe('pitx-moa-lowrisk');
    expect(routes[0].hazards.length).toBeGreaterThan(0);
    expect(routes[1].hazards.length).toBe(0);
  });

  it('is direction-agnostic for the demo pair', async () => {
    expect((await planRoutes(MOA, PITX)).length).toBe(2);
  });

  it('routes a generic NCR pair via Directions (real road geometry)', async () => {
    const routes = await planRoutes([121.0, 14.6], [121.05, 14.62], {
      mapboxToken: 't',
      fetchImpl: okFetch,
    });
    expect(routes.length).toBe(1);
    expect(routes[0].id).toBe('drive-route');
    // A road-following line has more than two vertices (not a straight line).
    expect(routes[0].route.length).toBeGreaterThan(2);
    expect(routes[0].maneuvers.length).toBeGreaterThan(0);
  });

  it('falls back to a straight line only when routing is unavailable', async () => {
    const routes = await planRoutes([121.0, 14.6], [121.05, 14.62], {
      mapboxToken: 't',
      fetchImpl: failFetch,
    });
    expect(routes.length).toBe(1);
    expect(routes[0].id).toBe('direct-line');
    expect(routes[0].route.length).toBe(2);
  });
});

describe('summarizeRouteRisk — flood semantics', () => {
  it('never reports LOW when data is unavailable and nothing classified', async () => {
    const summary = summarizeRouteRisk(await genericCandidate(), { dataUnavailable: true });
    expect(summary.dataUnavailable).toBe(true);
    expect(summary.level).toBe('UNKNOWN');
    expect(summary.level).not.toBe('LOW');
  });

  it('does not treat a STALE/UNKNOWN barangay level as LOW', async () => {
    const summary = summarizeRouteRisk(await genericCandidate(), {
      riskByBarangay: () => 'STALE' as CurrentRiskLevel,
      dataUnavailable: false,
    });
    expect(summary.higherRiskSegments).toBe(0);
  });

  it('counts a confirmed closure as the strongest signal', async () => {
    const candidate = await genericCandidate();
    const summary = summarizeRouteRisk(candidate, {
      riskByBarangay: () => 'LOW',
      closedBarangays: allResolvedBarangays(candidate),
      dataUnavailable: false,
    });
    expect(summary.closureCount).toBeGreaterThan(0);
    expect(summary.level).toBe('CONFIRMED_NOT_PASSABLE');
  });

  it('escalates for demo hazards on the route (PITX→MOA primary)', async () => {
    const [primary] = await planRoutes(PITX, MOA);
    const summary = summarizeRouteRisk(primary, { dataUnavailable: false });
    expect(summary.higherRiskSegments).toBeGreaterThan(0);
    expect(['HIGH', 'LIKELY_FLOODING', 'REPORTED_FLOODING', 'CONFIRMED_NOT_PASSABLE']).toContain(
      summary.level,
    );
  });
});

describe('compareRoutes — recommendation', () => {
  it('recommends the lower-exposure route over the faster-but-hazardous one', async () => {
    const routes = await planRoutes(PITX, MOA);
    const options = compareRoutes(routes, { dataUnavailable: false });
    const primary = options.find((o) => o.candidate.id === 'pitx-moa-primary')!;
    const alt = options.find((o) => o.candidate.id === 'pitx-moa-lowrisk')!;
    expect(alt.recommendation).toBe('recommended');
    expect(primary.recommendation).not.toBe('recommended');
  });

  it('labels a route as unavailable when its data is unavailable', async () => {
    const options = compareRoutes([await genericCandidate()], { dataUnavailable: true });
    expect(options[0].recommendation).toBe('unavailable');
  });

  it('never uses banned safety language in the reasons', async () => {
    const options = compareRoutes(await planRoutes(PITX, MOA), { dataUnavailable: false });
    const allText = options
      .flatMap((o) => o.reasons.map((r) => r.text.toLowerCase()))
      .join(' ');
    expect(allText).not.toMatch(/\bsafe\b/);
    expect(allText).not.toMatch(/no risk/);
  });
});

describe('travel-mode aware planning', () => {
  it('defaults to drive and returns the bundled PITX→MOA demo (2 routes)', async () => {
    const routes = await planRoutes(PITX, MOA);
    expect(routes.length).toBe(2);
    expect(routes[0].id).toBe('pitx-moa-primary');
  });

  it('does NOT reuse the driving demo geometry for walk/bike (fresh provider request)', async () => {
    const walk = await planRoutes(PITX, MOA, {
      mode: 'walk',
      mapboxToken: 't',
      fetchImpl: okFetch,
    });
    // Walk mode ignores the bundled driving demo and uses the provider route.
    expect(walk[0].id).toBe('walk-route');
    expect(walk[0].id).not.toBe('pitx-moa-primary');
  });

  it('requests the provider for a given mode and maps alternatives', async () => {
    const twoRouteFetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 'Ok',
        routes: [
          {
            distance: 3000,
            duration: 600,
            geometry: { type: 'LineString', coordinates: ROADLIKE },
            legs: [{ steps: [{ distance: 3000, name: 'A', maneuver: { type: 'depart' } }] }],
          },
          {
            distance: 3400,
            duration: 720,
            geometry: { type: 'LineString', coordinates: ROADLIKE },
            legs: [{ steps: [{ distance: 3400, name: 'B', maneuver: { type: 'depart' } }] }],
          },
        ],
      }),
    });
    const bike = await planRoutes([121, 14.6], [121.05, 14.62], {
      mode: 'bike',
      mapboxToken: 't',
      fetchImpl: twoRouteFetch,
    });
    expect(bike.length).toBe(2);
    expect(bike[0].id).toBe('bike-route');
    expect(bike[1].id).toBe('bike-route-alt1');
  });
});

describe('compareRoutes — preference ranking', () => {
  // Two synthetic candidates: A is faster but hazardous, B is slower but clean.
  const line: [number, number][] = [
    [121.0, 14.6],
    [121.05, 14.62],
  ];
  const fast: RouteCandidate = {
    id: 'fast',
    label: 'Fast',
    route: line,
    maneuvers: [],
    distanceM: 3000,
    durationS: 600, // 10 min
    hazards: [{ id: 'h', atM: 500, state: 'ORANGE', street: 'Test St' } satisfies DriveHazard],
  };
  const clean: RouteCandidate = {
    id: 'clean',
    label: 'Clean',
    route: line,
    maneuvers: [],
    distanceM: 5000,
    durationS: 1200, // 20 min, no hazards
    hazards: [],
  };

  it('lowerFloodExposure recommends the cleaner route even if slower', () => {
    const options = compareRoutes([fast, clean], { dataUnavailable: false }, 'lowerFloodExposure');
    const rec = options.find((o) => o.recommendation === 'recommended')!;
    expect(rec.candidate.id).toBe('clean');
  });

  it('faster recommends the quicker route when no closure blocks it', () => {
    const options = compareRoutes([fast, clean], { dataUnavailable: false }, 'faster');
    const rec = options.find((o) => o.recommendation === 'recommended')!;
    expect(rec.candidate.id).toBe('fast');
  });

  it('recommended reasons reflect the active preference (faster leads with time)', () => {
    const options = compareRoutes([fast, clean], { dataUnavailable: false }, 'faster');
    const rec = options.find((o) => o.recommendation === 'recommended')!;
    const text = rec.reasons.map((r) => r.text.toLowerCase()).join(' ');
    expect(text).toContain('travel time');
  });
});

describe('compareRoutes — confirmed closures are authoritative', () => {
  it('never recommends a route through a confirmed closure, even in faster mode', async () => {
    const candidate = await genericCandidate();
    const closed = allResolvedBarangays(candidate);
    // Only one candidate, and it is closed → it must NOT be recommended.
    const options = compareRoutes([candidate], { closedBarangays: closed }, 'faster');
    expect(options[0].risk.closureCount).toBeGreaterThan(0);
    expect(options[0].recommendation).not.toBe('recommended');
  });

  it('a closed route flags a closure and reasons mention it', async () => {
    const candidate = await genericCandidate();
    const closed = allResolvedBarangays(candidate);
    const options = compareRoutes([candidate], { closedBarangays: closed });
    const text = options[0].reasons.map((r) => r.text.toLowerCase()).join(' ');
    expect(text).toContain('confirmed closure');
  });

  it('isRouteStartBlocked is true only when a confirmed closure is on the route', async () => {
    const candidate = await genericCandidate();
    const openOptions = compareRoutes([candidate], { dataUnavailable: false });
    expect(isRouteStartBlocked(openOptions[0])).toBe(false);
    const closedOptions = compareRoutes([candidate], {
      closedBarangays: allResolvedBarangays(candidate),
    });
    expect(isRouteStartBlocked(closedOptions[0])).toBe(true);
  });
});

/** Helper: the set of barangays a candidate's samples resolve to. */
function allResolvedBarangays(candidate: RouteCandidate): Set<string> {
  const set = new Set<string>();
  summarizeRouteRisk(candidate, {
    riskByBarangay: (psgc) => {
      set.add(psgc);
      return 'LOW';
    },
  });
  return set;
}

import { routeSegmentExplanation } from './routePlanning';
import type { RouteRiskSummary } from './routePlanning';

describe('routeSegmentExplanation (reads back the existing summary)', () => {
  const base: RouteRiskSummary = {
    level: 'LOW',
    higherRiskSegments: 0,
    reportCount: 0,
    closureCount: 0,
    trend: 'unknown',
    dataUnavailable: false,
  };

  it('reports data unavailable without inventing risk', () => {
    const text = routeSegmentExplanation({ ...base, level: 'UNKNOWN', dataUnavailable: true });
    expect(text.toLowerCase()).toContain('unavailable');
  });

  it('gives a neutral (not "safe") line when nothing is notable', () => {
    const text = routeSegmentExplanation(base);
    expect(text.toLowerCase()).not.toContain('safe');
    expect(text.toLowerCase()).toContain('no higher-risk');
  });

  it('leads with confirmed closures and names higher-risk segments', () => {
    const text = routeSegmentExplanation({
      ...base,
      level: 'CONFIRMED_NOT_PASSABLE',
      closureCount: 1,
      higherRiskSegments: 2,
    });
    expect(text).toContain('1 confirmed closure');
    expect(text).toContain('2 higher-risk segments');
  });

  it('marks community reports as unconfirmed and never says "safe"', () => {
    const text = routeSegmentExplanation({ ...base, reportCount: 3 });
    expect(text).toContain('3 recent community reports');
    expect(text.toLowerCase()).toContain('unconfirmed');
    expect(text.toLowerCase()).not.toContain('safe');
  });
});

// --- Route alternatives share ONE environmental snapshot (no per-route fetch) -

describe('compareRoutes reuses a single shared risk snapshot', () => {
  function candidate(id: string, line: [number, number][]): RouteCandidate {
    return {
      id,
      label: id,
      route: line,
      maneuvers: [],
      distanceM: 3000,
      durationS: 600,
      hazards: [],
    };
  }

  it('analyzes 3 alternatives against the same injected snapshot, never fetching', () => {
    const lineA: [number, number][] = [
      [121.0, 14.6],
      [121.03, 14.62],
    ];
    const lineB: [number, number][] = [
      [121.01, 14.61],
      [121.04, 14.63],
    ];
    const lineC: [number, number][] = [
      [121.02, 14.6],
      [121.05, 14.64],
    ];

    // A fetch that MUST NOT be called by route comparison.
    const fetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    let riskCalls = 0;
    try {
      const options = compareRoutes(
        [candidate('A', lineA), candidate('B', lineB), candidate('C', lineC)],
        {
          riskByBarangay: () => {
            riskCalls += 1;
            return 'LOW';
          },
          reportCountByBarangay: () => 0,
          closedBarangays: new Set<string>(),
          trend: 'steady',
          dataUnavailable: false,
        },
      );
      expect(options).toHaveLength(3);
      // The shared snapshot was consulted (reused), and NO network fetch ran.
      expect(riskCalls).toBeGreaterThan(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
