// src/simulation/reroute.ts
//
// Pure reroute helpers for the driving demo, modeled on real navigation:
//
// - The vehicle never stops and is never moved. When the driver accepts a
//   reroute, the NEW route starts exactly where the vehicle is, follows the
//   current road up to the reroute's branch point (the turn-off), and then
//   continues on the flood-avoiding reroute to the destination.
// - A reroute stays available while its branch point is still ahead. Once the
//   driver passes it, that reroute is missed and the next reroute whose
//   branch point is still ahead is offered instead, until none remain.

import type { FloodReroute } from '../data/fixtures/floodReroutes';
import type { RouteManeuver } from '../data/fixtures/pitxToMoaRoute';
import {
  measureRoute,
  nearestAlong,
  pointAlong,
  type LngLat,
  type MeasuredRoute,
} from './routeGeometry';

/** A reroute point this close to the current road still counts as "on it". */
export const ON_ROUTE_TOLERANCE_M = 25;
/** Stop offering a reroute when its turn-off is closer than this. */
export const MIN_DECISION_M = 40;

/** Where a reroute leaves the base route. */
export interface BranchPoint {
  /** Distance along the BASE route, meters. */
  baseM: number;
  /** Distance along the REROUTE, meters. */
  rerouteM: number;
}

/** A complete route the vehicle can switch to without moving. */
export interface StitchedRoute {
  route: LngLat[];
  maneuvers: RouteManeuver[];
  lengthM: number;
}

export interface RerouteOffer {
  reroute: FloodReroute;
  /** Meters from the vehicle to the reroute's turn-off. */
  toBranchM: number;
  /** Extra distance vs. staying on the current route (can be negative). */
  extraM: number;
  /** Extra time at the simulated speed, seconds (can be negative). */
  extraS: number;
  /** True when an earlier reroute for this hazard was already missed. */
  isRetry: boolean;
}

const measuredCache = new WeakMap<object, MeasuredRoute>();
function measured(points: ReadonlyArray<LngLat>): MeasuredRoute {
  let m = measuredCache.get(points);
  if (!m) {
    m = measureRoute(points);
    measuredCache.set(points, m);
  }
  return m;
}

/**
 * Max gap (meters) allowed where the current road hands over to the reroute.
 * Both come from the same Mapbox road network, so a real shared intersection
 * vertex lines up within a meter or two. Anything bigger would draw a line
 * across non-road space, so such a reroute is rejected instead.
 */
export const MAX_JOIN_GAP_M = 3;

const branchCache = new WeakMap<FloodReroute, BranchPoint | null>();

/**
 * Finds where `reroute` leaves `base`: the last reroute VERTEX (a real road
 * node from Directions) that lies on the base road before the reroute
 * diverges. Returns null when there is no such shared vertex, i.e. joining
 * the two would require inventing a road segment.
 */
export function branchPoint(base: MeasuredRoute, reroute: FloodReroute): BranchPoint | null {
  if (branchCache.has(reroute)) return branchCache.get(reroute) ?? null;
  const alt = measured(reroute.route);
  let last: BranchPoint | null = null;
  for (let i = 0; i < alt.points.length; i += 1) {
    const near = nearestAlong(base, alt.points[i]);
    if (near.offM > ON_ROUTE_TOLERANCE_M) break; // diverged
    if (near.offM <= MAX_JOIN_GAP_M) last = { baseM: near.alongM, rerouteM: alt.cumulative[i] };
  }
  branchCache.set(reroute, last);
  return last;
}

/** Base-route positions strictly between two distances. */
function slice(route: MeasuredRoute, fromM: number, toM: number): LngLat[] {
  const out: LngLat[] = [pointAlong(route, fromM)];
  for (let i = 0; i < route.points.length; i += 1) {
    if (route.cumulative[i] > fromM && route.cumulative[i] < toM) out.push(route.points[i]);
  }
  out.push(pointAlong(route, toM));
  return out;
}

/**
 * The route the vehicle switches to when accepting `reroute` at `traveledM`:
 * current road → turn-off → reroute → destination. Starts exactly at the
 * vehicle, so accepting never moves it.
 */
export function stitchReroute(
  base: MeasuredRoute,
  baseManeuvers: ReadonlyArray<RouteManeuver>,
  reroute: FloodReroute,
  traveledM: number,
): StitchedRoute | null {
  const branch = branchPoint(base, reroute);
  if (!branch) return null; // would need an invented connecting segment
  const alt = measured(reroute.route);
  const connectorM = Math.max(0, branch.baseM - traveledM);

  const route = [
    ...slice(base, traveledM, branch.baseM),
    ...slice(alt, branch.rerouteM, alt.length).slice(1),
  ];

  // Turns still ahead on the current road, then the reroute's turns (the
  // first of which is the turn-off), re-based to the new route's start.
  const maneuvers: RouteManeuver[] = [
    ...baseManeuvers
      .filter((m) => m.type !== 'depart' && m.atM > traveledM && m.atM < branch.baseM)
      .map((m) => ({ ...m, atM: m.atM - traveledM })),
    ...reroute.maneuvers
      .filter((m) => m.type !== 'depart' && m.atM > branch.rerouteM)
      .map((m) => ({ ...m, atM: m.atM - branch.rerouteM + connectorM })),
  ];

  // Measured, so it includes the short hop from the current road onto the
  // reroute line at the turn-off.
  return { route, maneuvers, lengthM: measureRoute(route).length };
}

/**
 * The reroute to offer now, or null: the earliest reroute for the hazard in
 * the look-ahead whose turn-off is still at least {@link MIN_DECISION_M}
 * ahead of the vehicle.
 */
export function findRerouteOffer(
  base: MeasuredRoute,
  traveledM: number,
  hazardId: string | null,
  reroutes: ReadonlyArray<FloodReroute>,
  dismissed: ReadonlySet<string>,
  speedMps: number,
): RerouteOffer | null {
  if (!hazardId || dismissed.has(hazardId)) return null;
  const candidates = reroutes
    .filter((r) => r.hazardId === hazardId)
    .map((r) => ({ r, branch: branchPoint(base, r) }))
    // Only reroutes that join the current road at a real shared road node.
    .filter((c): c is { r: FloodReroute; branch: BranchPoint } => c.branch !== null)
    .sort((a, b) => a.branch.baseM - b.branch.baseM);

  for (let i = 0; i < candidates.length; i += 1) {
    const { r, branch } = candidates[i];
    const toBranchM = branch.baseM - traveledM;
    if (toBranchM < MIN_DECISION_M) continue; // missed / too late to turn
    const alt = measured(r.route);
    const newLengthM = toBranchM + (alt.length - branch.rerouteM);
    const extraM = newLengthM - (base.length - traveledM);
    return {
      reroute: r,
      toBranchM,
      extraM,
      extraS: speedMps > 0 ? extraM / speedMps : 0,
      // A retry only if an earlier turn-off was already passed.
      isRetry: candidates.slice(0, i).some((c) => c.branch.baseM < traveledM + MIN_DECISION_M),
    };
  }
  return null;
}

/** "+2 min · +0.4 km" style comparison text. */
export function formatRerouteDelta(offer: Pick<RerouteOffer, 'extraM' | 'extraS'>): string {
  const min = Math.round(offer.extraS / 60);
  const km = offer.extraM / 1000;
  const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '±');
  return `${sign(min)}${Math.abs(min)} min · ${sign(km)}${Math.abs(km).toFixed(1)} km`;
}
