// src/services/routePlanning.ts
//
// Route planning + FLOOD-AWARE route comparison for the Search → Compare flow.
//
// There is no runtime Directions backend for the hackathon MVP. For the flagship
// demo pair (PITX → SM Mall of Asia) we return the bundled real Mapbox route as
// the primary candidate and its bundled flood-avoiding reroute as a lower-risk
// alternative — both drivable by the existing simulator. For any other NCR pair
// we return a single straight-line candidate so the flow still completes.
//
// Route risk is AGGREGATED from BahaRoute's existing signals, per docs/
// FLOOD_SEMANTICS.md:
//   - live per-barangay current risk (sampled along the route geometry),
//   - demo flood hazards that sit on the route,
//   - confirmed official closures the route passes through (strongest signal),
//   - recent community reports on the route (supporting evidence only).
// UNKNOWN / STALE are treated as data-quality states — never as LOW. Historical
// susceptibility is supporting context only and never classifies a route as
// currently flooded on its own.

import type { CurrentRiskLevel, RainfallTrend } from '../types/risk';
import { isDataQualityState, riskSeverity } from '../types/risk';
import type { RouteManeuver } from '../data/fixtures/pitxToMoaRoute';
import {
  PITX_TO_MOA_ROUTE,
  PITX_TO_MOA_MANEUVERS,
} from '../data/fixtures/pitxToMoaRoute';
import { PITX_TO_MOA_HAZARDS, type DriveHazard } from '../data/fixtures/driveHazards';
import { PITX_TO_MOA_REROUTES } from '../data/fixtures/floodReroutes';
import { measureRoute, type LngLat } from '../simulation/routeGeometry';
import { SIM_SPEED_MPS } from '../simulation/DriveSimulator';
import { resolveBarangayForPoint } from './reportResolution';
import { fetchDrivingRoute, type FetchLike } from './directions';

/** A concrete, drivable candidate route. */
export interface RouteCandidate {
  readonly id: string;
  readonly label: string;
  readonly route: ReadonlyArray<LngLat>;
  readonly maneuvers: ReadonlyArray<RouteManeuver>;
  readonly distanceM: number;
  /** Estimated real-world duration at the simulated average speed, seconds. */
  readonly durationS: number;
  /** Demo hazards that lie on THIS route (empty for a hazard-avoiding alt). */
  readonly hazards: ReadonlyArray<DriveHazard>;
}

/** A single "Why this route?" bullet. */
export interface RouteReason {
  readonly key: string;
  readonly text: string;
}

/** Aggregated flood-risk summary for a route (the Compare card model). */
export interface RouteRiskSummary {
  /** Overall route risk level (max severity across signals). */
  readonly level: CurrentRiskLevel;
  /** Number of higher-risk segments (HIGH or worse) sampled along the route. */
  readonly higherRiskSegments: number;
  /** Recent community reports resolving to barangays the route passes. */
  readonly reportCount: number;
  /** Confirmed official closures the route passes through. */
  readonly closureCount: number;
  /** Rainfall trend if available, else 'unknown'. */
  readonly trend: RainfallTrend;
  /** True when route risk could not be classified (no usable current data). */
  readonly dataUnavailable: boolean;
}

/** A comparison entry: a candidate + its risk summary + recommendation. */
export interface RouteOption {
  readonly candidate: RouteCandidate;
  readonly risk: RouteRiskSummary;
  /** Recommendation label. */
  readonly recommendation:
    | 'recommended'
    | 'lowerRiskAlternative'
    | 'higherFloodExposure'
    | 'alternative'
    | 'unavailable';
  /** Concise, decision-focused bullets. Never says "safe". */
  readonly reasons: readonly RouteReason[];
}

/**
 * The signals the caller injects so route risk reflects LIVE state. All are
 * optional; missing signals degrade to data-quality-safe defaults.
 */
export interface RoutePlanningContext {
  /** PSGC → live current-risk level (from the barangay risk controller). */
  readonly riskByBarangay?: (psgc: string) => CurrentRiskLevel | undefined;
  /** PSGC → recent community report count. */
  readonly reportCountByBarangay?: (psgc: string) => number;
  /** PSGC set of confirmed closures. */
  readonly closedBarangays?: ReadonlySet<string>;
  /** Current rainfall trend (from the rainfall snapshot). */
  readonly trend?: RainfallTrend;
  /** True when live rainfall/current-risk data is unavailable/stale. */
  readonly dataUnavailable?: boolean;
  /** Reference time (epoch seconds). */
  readonly now?: number;
}

/** Distance between route samples when aggregating risk (meters). */
const SAMPLE_INTERVAL_M = 250;

/** Distance under which two coordinates are considered the same place. */
const NEAR_M_DEG = 0.02; // ~2.2 km in degrees; generous for landmark matching

function near(a: readonly [number, number], b: readonly [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < NEAR_M_DEG && Math.abs(a[1] - b[1]) < NEAR_M_DEG;
}

const PITX: readonly [number, number] = PITX_TO_MOA_ROUTE[0];
const MOA: readonly [number, number] = PITX_TO_MOA_ROUTE[PITX_TO_MOA_ROUTE.length - 1];

/** The bundled flood-avoiding alternative for the PITX→MOA demo, from origin. */
function pitxToMoaAlternative(): RouteCandidate | null {
  // Use the earliest full reroute for the primary hazard (starts near the
  // origin), which already avoids EVERY demo hazard to MOA.
  const alt = PITX_TO_MOA_REROUTES.find((r) => r.hazardId === 'demo-roxas-baclaran');
  if (!alt) return null;
  const measured = measureRoute(alt.route);
  return {
    id: 'pitx-moa-lowrisk',
    label: 'Route B — flood-avoiding',
    route: alt.route,
    maneuvers: alt.maneuvers,
    distanceM: measured.length,
    durationS: SIM_SPEED_MPS > 0 ? measured.length / SIM_SPEED_MPS : 0,
    hazards: [], // avoids every demo hazard
  };
}

/** Options for {@link planRoutes} (Directions token + injectable fetch). */
export interface PlanRoutesOptions {
  /** Mapbox access token (from AppConfig.tileKey) for road-following routing. */
  readonly mapboxToken?: string;
  /** Injectable fetch for the Directions request (tests). */
  readonly fetchImpl?: FetchLike;
}

/** A last-resort straight-line candidate, used only when routing is impossible. */
function straightLineCandidate(
  origin: readonly [number, number],
  destination: readonly [number, number],
): RouteCandidate {
  const line: LngLat[] = [
    [origin[0], origin[1]],
    [destination[0], destination[1]],
  ];
  const measured = measureRoute(line);
  return {
    id: 'direct-line',
    label: 'Direct route',
    route: line,
    maneuvers: [
      { atM: 0, type: 'depart', modifier: null, street: null, instruction: 'Head toward destination.' },
      { atM: Math.round(measured.length), type: 'arrive', modifier: null, street: null, instruction: 'Arrive at destination.' },
    ],
    distanceM: measured.length,
    durationS: SIM_SPEED_MPS > 0 ? measured.length / SIM_SPEED_MPS : 0,
    hazards: [],
  };
}

/**
 * Returns drivable candidate routes for an origin/destination pair.
 *
 * The flagship PITX→MOA pair yields the bundled REAL route + its flood-avoiding
 * alternative (offline, demo-reliable). Any other NCR pair is routed via the
 * Mapbox Directions API so the candidate follows real road geometry — the same
 * LineString the simulator drives and the map draws, so the vehicle never cuts
 * across buildings. Only if routing is unavailable (no token / network error)
 * does it fall back to a single straight-line candidate; even then the drawn
 * line and the simulated path share that one geometry.
 */
export async function planRoutes(
  origin: readonly [number, number],
  destination: readonly [number, number],
  options: PlanRoutesOptions = {},
): Promise<RouteCandidate[]> {
  const isPitxMoa =
    (near(origin, PITX) && near(destination, MOA)) ||
    (near(origin, MOA) && near(destination, PITX));

  if (isPitxMoa) {
    const measured = measureRoute(PITX_TO_MOA_ROUTE);
    const primary: RouteCandidate = {
      id: 'pitx-moa-primary',
      label: 'Route A — direct',
      route: PITX_TO_MOA_ROUTE,
      maneuvers: PITX_TO_MOA_MANEUVERS,
      distanceM: measured.length,
      durationS: SIM_SPEED_MPS > 0 ? measured.length / SIM_SPEED_MPS : 0,
      hazards: PITX_TO_MOA_HAZARDS,
    };
    const alt = pitxToMoaAlternative();
    return alt ? [primary, alt] : [primary];
  }

  // Generic NCR pair: obtain a REAL road-following route from Mapbox Directions
  // so the simulated drive stays on roads. Straight line only as last resort.
  const routed = await fetchDrivingRoute(
    [origin[0], origin[1]],
    [destination[0], destination[1]],
    options.mapboxToken ?? '',
    { fetchImpl: options.fetchImpl },
  );
  if (routed && routed.geometry.length >= 2) {
    return [
      {
        id: 'direct-route',
        label: 'Driving route',
        route: routed.geometry,
        maneuvers: routed.maneuvers,
        distanceM: routed.distanceM,
        // Prefer Mapbox's duration when present; else derive from sim speed.
        durationS:
          routed.durationS > 0
            ? routed.durationS
            : SIM_SPEED_MPS > 0
              ? routed.distanceM / SIM_SPEED_MPS
              : 0,
        hazards: [],
      },
    ];
  }

  return [straightLineCandidate(origin, destination)];
}

/** Maps a demo hazard's reported state to a current-risk level. */
function hazardToRisk(state: DriveHazard['state']): CurrentRiskLevel {
  switch (state) {
    case 'RED':
      return 'REPORTED_FLOODING';
    case 'ORANGE':
      return 'HIGH';
    case 'YELLOW':
    default:
      return 'ELEVATED';
  }
}

/** Returns the more severe of two levels, ignoring data-quality states. */
function maxLevel(a: CurrentRiskLevel, b: CurrentRiskLevel): CurrentRiskLevel {
  if (isDataQualityState(a)) return b;
  if (isDataQualityState(b)) return a;
  return riskSeverity(a) >= riskSeverity(b) ? a : b;
}

/**
 * Aggregates a route's flood-risk summary from the injected live signals. The
 * route geometry is sampled every {@link SAMPLE_INTERVAL_M}; each sample resolves
 * to a barangay whose current risk, reports, and closure status contribute.
 * Demo hazards on the route contribute their mapped risk. UNKNOWN/STALE never
 * count as LOW: if NO sample produced a classified level, the summary is
 * data-unavailable.
 */
export function summarizeRouteRisk(
  candidate: RouteCandidate,
  ctx: RoutePlanningContext = {},
): RouteRiskSummary {
  const measured = measureRoute(candidate.route);
  const barangays = new Set<string>();
  for (let m = 0; m <= measured.length; m += SAMPLE_INTERVAL_M) {
    const pt = pointAlongSafe(measured.points, measured.cumulative, m);
    const psgc = resolveBarangayForPoint(pt[0], pt[1]);
    if (psgc) barangays.add(psgc);
  }

  let level: CurrentRiskLevel = 'LOW';
  let sawClassified = false;
  let higherRiskSegments = 0;
  let reportCount = 0;
  let closureCount = 0;

  for (const psgc of barangays) {
    if (ctx.closedBarangays?.has(psgc)) {
      closureCount += 1;
      level = maxLevel(level, 'CONFIRMED_NOT_PASSABLE');
      sawClassified = true;
    }
    const bRisk = ctx.riskByBarangay?.(psgc);
    if (bRisk && !isDataQualityState(bRisk)) {
      sawClassified = true;
      level = maxLevel(level, bRisk);
      if (riskSeverity(bRisk) >= riskSeverity('HIGH')) higherRiskSegments += 1;
    }
    reportCount += ctx.reportCountByBarangay?.(psgc) ?? 0;
  }

  // Demo hazards that sit on this route always contribute their mapped risk.
  for (const hz of candidate.hazards) {
    const hzRisk = hazardToRisk(hz.state);
    sawClassified = true;
    level = maxLevel(level, hzRisk);
    if (riskSeverity(hzRisk) >= riskSeverity('HIGH')) higherRiskSegments += 1;
  }

  // If live data is unavailable AND nothing classified the route, report it as
  // data-unavailable rather than pretending it is LOW.
  if (!sawClassified && ctx.dataUnavailable) {
    return {
      level: 'UNKNOWN',
      higherRiskSegments: 0,
      reportCount,
      closureCount,
      trend: ctx.trend ?? 'unknown',
      dataUnavailable: true,
    };
  }

  return {
    level,
    higherRiskSegments,
    reportCount,
    closureCount,
    trend: ctx.trend ?? 'unknown',
    dataUnavailable: false,
  };
}

/** Local pointAlong that avoids importing the throwing variant for empty guards. */
function pointAlongSafe(
  points: ReadonlyArray<LngLat>,
  cumulative: number[],
  meters: number,
): LngLat {
  if (points.length === 0) return [0, 0];
  if (meters <= 0) return points[0];
  const length = cumulative[cumulative.length - 1] ?? 0;
  if (meters >= length) return points[points.length - 1];
  let lo = 0;
  let hi = cumulative.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] <= meters) lo = mid;
    else hi = mid;
  }
  const segLen = cumulative[hi] - cumulative[lo] || 1;
  const t = (meters - cumulative[lo]) / segLen;
  const a = points[lo];
  const b = points[hi];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * A balanced comparison score (LOWER is better). Combines travel time with
 * flood exposure so the recommendation is NOT simply the fastest route. Data-
 * quality states get a mild penalty (uncertain, not safe).
 */
function balancedScore(option: { candidate: RouteCandidate; risk: RouteRiskSummary }): number {
  const timeMin = option.candidate.durationS / 60;
  const r = option.risk;
  // Weight closures the strongest, then classified severity, then reports.
  const severity = isDataQualityState(r.level) ? 2.5 : riskSeverity(r.level);
  const exposure =
    r.closureCount * 100 + severity * 6 + r.higherRiskSegments * 3 + r.reportCount * 1.5;
  return timeMin + exposure;
}

/**
 * Builds the compared, recommendation-labeled route options. The recommended
 * route is the best BALANCED option (time + flood exposure), not the fastest.
 * Labels: the winner is "Recommended"; a clearly lower-risk-but-present option
 * is "Lower-risk alternative"; a faster-but-riskier option is "Higher flood
 * exposure"; the rest are "Alternative". Routes with no usable current data are
 * labeled "unavailable".
 */
export function compareRoutes(
  candidates: readonly RouteCandidate[],
  ctx: RoutePlanningContext = {},
): RouteOption[] {
  const scored = candidates.map((candidate) => {
    const risk = summarizeRouteRisk(candidate, ctx);
    return { candidate, risk, score: balancedScore({ candidate, risk }) };
  });
  if (scored.length === 0) return [];

  // Best balanced score wins the recommendation.
  const sorted = [...scored].sort((a, b) => a.score - b.score);
  const best = sorted[0];

  return scored.map((s) => {
    const isBest = s.candidate.id === best.candidate.id;
    let recommendation: RouteOption['recommendation'];
    if (s.risk.dataUnavailable) {
      recommendation = 'unavailable';
    } else if (isBest) {
      recommendation = 'recommended';
    } else if (riskSeverity(s.risk.level) < riskSeverity(best.risk.level)) {
      recommendation = 'lowerRiskAlternative';
    } else if (
      s.candidate.durationS < best.candidate.durationS &&
      riskSeverity(s.risk.level) > riskSeverity(best.risk.level)
    ) {
      recommendation = 'higherFloodExposure';
    } else {
      recommendation = 'alternative';
    }
    return {
      candidate: s.candidate,
      risk: s.risk,
      recommendation,
      reasons: buildReasons(s.risk, recommendation),
    };
  });
}

/** Builds concise, decision-focused "Why this route?" bullets. Never "safe". */
function buildReasons(
  risk: RouteRiskSummary,
  recommendation: RouteOption['recommendation'],
): RouteReason[] {
  const out: RouteReason[] = [];
  if (recommendation === 'unavailable' || risk.dataUnavailable) {
    out.push({ key: 'noData', text: 'Current flood information unavailable' });
    return out;
  }
  if (risk.closureCount > 0) {
    out.push({
      key: 'closure',
      text: `${risk.closureCount} confirmed closure${risk.closureCount === 1 ? '' : 's'} on this route`,
    });
  }
  if (recommendation === 'recommended' || recommendation === 'lowerRiskAlternative') {
    out.push({ key: 'exposure', text: 'Lower predicted flood exposure' });
    if (risk.higherRiskSegments === 0) {
      out.push({ key: 'segments', text: 'Avoids higher-risk segments' });
    }
    if (risk.closureCount === 0) {
      out.push({ key: 'noClosure', text: 'No confirmed closures' });
    }
  } else {
    if (risk.higherRiskSegments > 0) {
      out.push({
        key: 'segments',
        text: `Crosses ${risk.higherRiskSegments} higher-risk segment${risk.higherRiskSegments === 1 ? '' : 's'}`,
      });
    }
    if (risk.reportCount > 0) {
      out.push({
        key: 'reports',
        text: `${risk.reportCount} recent community report${risk.reportCount === 1 ? '' : 's'} (unconfirmed)`,
      });
    }
  }
  return out;
}
