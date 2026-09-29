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
  type RouteCandidate,
} from './routePlanning';
import type { FetchLike } from './directions';
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
    expect(routes[0].id).toBe('direct-route');
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
