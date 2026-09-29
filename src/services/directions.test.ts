// src/services/directions.test.ts
//
// The Mapbox Directions client: parses geometry + maneuvers, computes
// cumulative `atM`, and fails safe (null) on missing token, non-OK status,
// non-Ok body, or degenerate geometry.

import { describe, it, expect, vi } from 'vitest';
import { fetchDrivingRoute, type FetchLike } from './directions';

const ORIGIN: [number, number] = [121.0, 14.6];
const DEST: [number, number] = [121.05, 14.62];

function jsonFetch(body: unknown, ok = true, status = 200): FetchLike {
  return vi.fn(async () => ({ ok, status, json: async () => body }));
}

const GOOD_BODY = {
  code: 'Ok',
  routes: [
    {
      distance: 3210,
      duration: 640,
      geometry: {
        type: 'LineString',
        coordinates: [
          [121.0, 14.6],
          [121.02, 14.606],
          [121.05, 14.62],
        ],
      },
      legs: [
        {
          steps: [
            { distance: 1200, name: 'First Ave', maneuver: { type: 'depart', instruction: 'Head out' } },
            { distance: 1500, name: 'Second St', maneuver: { type: 'turn', modifier: 'right', instruction: 'Turn right' } },
            { distance: 0, name: '', maneuver: { type: 'arrive', instruction: 'Arrive' } },
          ],
        },
      ],
    },
  ],
};

describe('fetchDrivingRoute', () => {
  it('returns geometry, maneuvers, and cumulative atM on success', async () => {
    const route = await fetchDrivingRoute(ORIGIN, DEST, 'token', {
      fetchImpl: jsonFetch(GOOD_BODY),
    });
    expect(route).not.toBeNull();
    expect(route!.geometry.length).toBe(3);
    // Cumulative atM: 0, then 1200, then 2700.
    expect(route!.maneuvers.map((m) => m.atM)).toEqual([0, 1200, 2700]);
    expect(route!.maneuvers[1].modifier).toBe('right');
    expect(route!.durationS).toBe(640);
    // Distance is measured from the geometry (positive, road-scale).
    expect(route!.distanceM).toBeGreaterThan(0);
  });

  it('includes the driving profile and geojson query in the request URL', async () => {
    const fetchImpl = jsonFetch(GOOD_BODY);
    await fetchDrivingRoute(ORIGIN, DEST, 'token', { fetchImpl });
    const url = (fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
    expect(url).toContain('/directions/v5/mapbox/driving/');
    expect(url).toContain('geometries=geojson');
    expect(url).toContain('overview=full');
    expect(url).toContain('steps=true');
    expect(url).toContain('access_token=token');
  });

  it('returns null when no token is provided', async () => {
    const fetchImpl = jsonFetch(GOOD_BODY);
    expect(await fetchDrivingRoute(ORIGIN, DEST, '', { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns null on a non-OK HTTP status', async () => {
    expect(
      await fetchDrivingRoute(ORIGIN, DEST, 'token', { fetchImpl: jsonFetch({}, false, 429) }),
    ).toBeNull();
  });

  it('returns null when the body code is not Ok', async () => {
    const body = { code: 'NoRoute', routes: [] };
    expect(await fetchDrivingRoute(ORIGIN, DEST, 'token', { fetchImpl: jsonFetch(body) })).toBeNull();
  });

  it('returns null for degenerate (single-point) geometry', async () => {
    const body = {
      code: 'Ok',
      routes: [{ geometry: { type: 'LineString', coordinates: [[121.0, 14.6]] }, legs: [] }],
    };
    expect(await fetchDrivingRoute(ORIGIN, DEST, 'token', { fetchImpl: jsonFetch(body) })).toBeNull();
  });

  it('returns null when fetch throws (network error / abort)', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => {
      throw new Error('network down');
    });
    expect(await fetchDrivingRoute(ORIGIN, DEST, 'token', { fetchImpl })).toBeNull();
  });
});
