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

/** Mapbox Directions API base (profile + coordinates + query appended). */
const DIRECTIONS_API = 'https://api.mapbox.com/directions/v5/mapbox';

/**
 * A BahaRoute travel mode. Each maps to a genuine Mapbox Directions profile:
 *   drive → mapbox/driving, bike → mapbox/cycling, walk → mapbox/walking.
 * All three are real, supported profiles — no faked modes.
 */
export type TravelMode = 'drive' | 'bike' | 'walk';

/** Maps a travel mode to its Mapbox Directions profile segment. */
export const TRAVEL_MODE_PROFILE: Record<TravelMode, string> = {
  drive: 'driving',
  bike: 'cycling',
  walk: 'walking',
};

/**
 * The travel modes genuinely supported by the current routing provider (Mapbox
 * Directions). All three profiles exist in the Directions API, so all three are
 * enabled. If the provider were swapped for one without a profile, remove it
 * here and the UI disables it automatically — nothing is ever faked.
 */
export const SUPPORTED_TRAVEL_MODES: readonly TravelMode[] = ['drive', 'bike', 'walk'];

/** True when the routing provider genuinely supports a travel mode. */
export function isTravelModeSupported(mode: TravelMode): boolean {
  return SUPPORTED_TRAVEL_MODES.includes(mode);
}

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

/** Parses a single Mapbox route object into a {@link DirectionsRoute}, or null. */
function parseRoute(route: MapboxRoute | undefined): DirectionsRoute | null {
  const coordinates = route?.geometry?.coordinates;
  if (!route || !coordinates || coordinates.length < 2) return null;
  const geometry: LngLat[] = coordinates.map(([lng, lat]) => [lng, lat]);
  // Trust the measured geometry length for internal consistency with the
  // simulator (which measures the same points); fall back to Mapbox's value.
  const measuredLength = measureRoute(geometry).length;
  const distanceM = measuredLength > 0 ? measuredLength : (route.distance ?? 0);
  return {
    geometry,
    maneuvers: toManeuvers(route),
    distanceM,
    durationS: route.duration ?? 0,
  };
}

/**
 * Requests road/path-following routes between two NCR points for a given travel
 * MODE, optionally asking the provider for ALTERNATIVES. Returns the routes the
 * provider actually returned (up to ~3), in provider order (best first). Returns
 * an EMPTY array on any failure (no token, network error, non-OK status,
 * empty/!=Ok body, degenerate geometry) so the caller can fall back without
 * throwing. Never invents routes.
 *
 * Profiles are genuine Mapbox profiles: driving / cycling / walking. Geometry
 * for one mode is never reused for another — each mode is a separate request.
 */
export async function fetchDirectionsRoutes(
  origin: LngLat,
  destination: LngLat,
  token: string,
  opts: {
    mode?: TravelMode;
    alternatives?: boolean;
    fetchImpl?: FetchLike;
    signal?: AbortSignal;
  } = {},
): Promise<DirectionsRoute[]> {
  if (!token) return [];
  const fetchImpl =
    opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!fetchImpl) return [];

  const mode = opts.mode ?? 'drive';
  const profile = TRAVEL_MODE_PROFILE[mode] ?? 'driving';
  const coords = `${origin[0]},${origin[1]};${destination[0]},${destination[1]}`;
  const query = new URLSearchParams({
    geometries: 'geojson',
    overview: 'full',
    steps: 'true',
    access_token: token,
  });
  if (opts.alternatives) query.set('alternatives', 'true');
  const url = `${DIRECTIONS_API}/${profile}/${coords}?${query.toString()}`;

  try {
    const res = await fetchImpl(url, { signal: opts.signal });
    if (!res.ok) {
      if (devDiagnosticsEnabled()) {
        // eslint-disable-next-line no-console
        console.warn('[directions] request failed', res.status);
      }
      return [];
    }
    const body = (await res.json()) as MapboxDirectionsResponse;
    if (body.code && body.code !== 'Ok') return [];
    const parsed = (body.routes ?? [])
      .map((r) => parseRoute(r))
      .filter((r): r is DirectionsRoute => r !== null);

    if (devDiagnosticsEnabled()) {
      // eslint-disable-next-line no-console
      console.info(
        `[directions] mode=${mode} routes=${parsed.length}` +
          (parsed[0] ? ` first=${Math.round(parsed[0].distanceM)}m` : ''),
      );
    }
    return parsed;
  } catch {
    // Aborted or network error: degrade gracefully.
    return [];
  }
}

/**
 * Requests a single road-following DRIVING route. Backward-compatible wrapper
 * over {@link fetchDirectionsRoutes} (mode=drive, no alternatives) returning the
 * first route or `null`. Kept so existing callers/tests are unchanged.
 */
export async function fetchDrivingRoute(
  origin: LngLat,
  destination: LngLat,
  token: string,
  opts: { fetchImpl?: FetchLike; signal?: AbortSignal } = {},
): Promise<DirectionsRoute | null> {
  const routes = await fetchDirectionsRoutes(origin, destination, token, {
    mode: 'drive',
    alternatives: false,
    fetchImpl: opts.fetchImpl,
    signal: opts.signal,
  });
  return routes[0] ?? null;
}
