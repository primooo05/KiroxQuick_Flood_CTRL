// src/services/directions.ts
//
// A thin Mapbox Directions client used by the trip planner to obtain a REAL,
// road-following driving route (LineString geometry + turn-by-turn maneuvers)
// for an arbitrary NCR origin/destination pair.
//
// Why this exists: Driver Mode must simulate the vehicle along real road
// geometry. The flagship PITX → MOA demo ships a bundled offline route, but any
// other pair previously fell back to a straight line between the two points —
// which made the simulated marker cut across buildings. This client returns the
// same kind of geometry as the bundled fixtures (ordered [lng,lat] positions +
// RouteManeuver[] with cumulative `atM`), so the simulator, the drawn blue line,
// and the follow camera all share one road-following LineString.
//
// It performs ONE network request per plan (no polling) and fails safe: on any
// error the caller degrades gracefully. The Mapbox access token is injected
// (from AppConfig.tileKey) — never hardcoded.

import type { RouteManeuver } from '../data/fixtures/pitxToMoaRoute';
import { measureRoute, type LngLat } from '../simulation/routeGeometry';

/** Mapbox Directions driving endpoint (coordinates + query appended). */
const DIRECTIONS_BASE =
  'https://api.mapbox.com/directions/v5/mapbox/driving';

/** Injectable fetch (defaults to global fetch) for testability. */
export type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** A road-following route from the Directions API. */
export interface DirectionsRoute {
  /** Ordered [lng, lat] positions of the full route geometry. */
  readonly geometry: LngLat[];
  /** Turn-by-turn maneuvers with cumulative distance-along-route (`atM`). */
  readonly maneuvers: RouteManeuver[];
  /** Total route distance, meters. */
  readonly distanceM: number;
  /** Total route duration as returned by Mapbox, seconds. */
  readonly durationS: number;
}

/** Dev-only diagnostics: on in Vite dev, off in prod and under test. */
function devDiagnosticsEnabled(): boolean {
  try {
    const env = (import.meta as { env?: { DEV?: boolean; MODE?: string } }).env;
    return Boolean(env?.DEV) && env?.MODE !== 'test';
  } catch {
    return false;
  }
}

// ---- Mapbox response typing (only the fields we use) ----------------------

interface MapboxStepManeuver {
  type?: string;
  modifier?: string;
  instruction?: string;
}
interface MapboxStep {
  distance?: number;
  name?: string;
  maneuver?: MapboxStepManeuver;
}
interface MapboxLeg {
  steps?: MapboxStep[];
}
interface MapboxRoute {
  distance?: number;
  duration?: number;
  geometry?: { type?: string; coordinates?: [number, number][] };
  legs?: MapboxLeg[];
}
interface MapboxDirectionsResponse {
  code?: string;
  routes?: MapboxRoute[];
}

/**
 * Converts Mapbox legs/steps into our RouteManeuver[] with cumulative `atM`.
 * Mapbox reports each step's own length (`distance`); the maneuver happens at
 * the END of the accumulated distance, matching how the bundled fixtures encode
 * `atM` (distance from the route start to the maneuver point).
 */
function toManeuvers(route: MapboxRoute): RouteManeuver[] {
  const out: RouteManeuver[] = [];
  let cumulative = 0;
  const steps = (route.legs ?? []).flatMap((leg) => leg.steps ?? []);
  for (const step of steps) {
    const m = step.maneuver ?? {};
    out.push({
      atM: Math.round(cumulative),
      type: m.type ?? 'continue',
      modifier: m.modifier ?? null,
      street: step.name && step.name.length > 0 ? step.name : null,
      instruction: m.instruction ?? '',
    });
    cumulative += step.distance ?? 0;
  }
  return out;
}

/**
 * Requests a road-following driving route between two NCR points.
 *
 * Uses `geometries=geojson` + `overview=full` for the full-resolution line and
 * `steps=true` for maneuvers. Returns `null` on any failure (no token, network
 * error, non-OK status, empty/!=Ok body, degenerate geometry) so the caller can
 * fall back without throwing.
 *
 * @param origin - `[lng, lat]` start.
 * @param destination - `[lng, lat]` end.
 * @param token - Mapbox access token (from AppConfig.tileKey).
 * @param opts - Optional injected `fetch` + abort `signal` (tests).
 */
export async function fetchDrivingRoute(
  origin: LngLat,
  destination: LngLat,
  token: string,
  opts: { fetchImpl?: FetchLike; signal?: AbortSignal } = {},
): Promise<DirectionsRoute | null> {
  if (!token) return null;
  const fetchImpl =
    opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!fetchImpl) return null;

  const coords = `${origin[0]},${origin[1]};${destination[0]},${destination[1]}`;
  const query = new URLSearchParams({
    geometries: 'geojson',
    overview: 'full',
    steps: 'true',
    access_token: token,
  });
  const url = `${DIRECTIONS_BASE}/${coords}?${query.toString()}`;

  try {
    const res = await fetchImpl(url, { signal: opts.signal });
    if (!res.ok) {
      if (devDiagnosticsEnabled()) {
        // eslint-disable-next-line no-console
        console.warn('[directions] request failed', res.status);
      }
      return null;
    }
    const body = (await res.json()) as MapboxDirectionsResponse;
    if (body.code && body.code !== 'Ok') return null;
    const route = body.routes?.[0];
    const coordinates = route?.geometry?.coordinates;
    if (!route || !coordinates || coordinates.length < 2) return null;

    const geometry: LngLat[] = coordinates.map(([lng, lat]) => [lng, lat]);
    // Trust the measured geometry length for internal consistency with the
    // simulator (which measures the same points); fall back to Mapbox's value.
    const measuredLength = measureRoute(geometry).length;
    const distanceM = measuredLength > 0 ? measuredLength : (route.distance ?? 0);

    if (devDiagnosticsEnabled()) {
      // eslint-disable-next-line no-console
      console.info(
        `[directions] route: ${geometry.length} coords, ${Math.round(distanceM)} m`,
      );
    }

    return {
      geometry,
      maneuvers: toManeuvers(route),
      distanceM,
      durationS: route.duration ?? 0,
    };
  } catch {
    // Aborted or network error: degrade gracefully.
    return null;
  }
}
