// src/simulation/routeGeometry.ts
//
// Pure, engine-free geometry helpers for the drive simulation: distance along
// a route, position + heading at a distance, and the "outside the driver
// radius" clip mask. Unit-testable without a map.

/// <reference types="geojson" />

export type LngLat = [number, number];

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (d: number): number => (d * Math.PI) / 180;
const toDeg = (r: number): number => (r * 180) / Math.PI;

/** Great-circle distance between two points, in meters. */
export function distanceMeters(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial compass bearing from `a` to `b`, in degrees [0, 360). */
export function bearingDegrees(a: LngLat, b: LngLat): number {
  const φ1 = toRad(a[1]);
  const φ2 = toRad(b[1]);
  const Δλ = toRad(b[0] - a[0]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** A route with precomputed cumulative distances for fast lookups. */
export interface MeasuredRoute {
  points: ReadonlyArray<LngLat>;
  /** cumulative[i] = meters from the start to points[i]. */
  cumulative: number[];
  length: number;
}

export function measureRoute(points: ReadonlyArray<LngLat>): MeasuredRoute {
  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) {
    cumulative.push(cumulative[i - 1] + distanceMeters(points[i - 1], points[i]));
  }
  return { points, cumulative, length: cumulative[cumulative.length - 1] ?? 0 };
}

/** The point at `meters` along the route (clamped to the route ends). */
export function pointAlong(route: MeasuredRoute, meters: number): LngLat {
  const { points, cumulative, length } = route;
  if (points.length === 0) throw new Error('pointAlong: empty route');
  if (meters <= 0) return points[0];
  if (meters >= length) return points[points.length - 1];
  // Binary search for the segment containing `meters`.
  let lo = 0;
  let hi = cumulative.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] <= meters) lo = mid;
    else hi = mid;
  }
  const seg = cumulative[hi] - cumulative[lo];
  const t = seg > 0 ? (meters - cumulative[lo]) / seg : 0;
  const a = points[lo];
  const b = points[hi];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Heading at `meters`, measured toward a look-ahead point so small
 * polyline wiggles don't make the camera jitter.
 */
export function headingAlong(route: MeasuredRoute, meters: number, lookAheadM = 40): number {
  const from = pointAlong(route, Math.min(meters, route.length - lookAheadM));
  const to = pointAlong(route, Math.min(route.length, meters + lookAheadM));
  return bearingDegrees(from, to);
}

/** Circle ring of `radiusM` around `center`, closed, counter-clockwise. */
export function circleRing(center: LngLat, radiusM: number, steps = 48): LngLat[] {
  const ring: LngLat[] = [];
  const latScale = radiusM / EARTH_RADIUS_M;
  for (let i = 0; i <= steps; i += 1) {
    const θ = (i / steps) * 2 * Math.PI;
    const dLat = toDeg(latScale * Math.sin(θ));
    const dLng = toDeg((latScale * Math.cos(θ)) / Math.cos(toRad(center[1])));
    ring.push([center[0] + dLng, center[1] + dLat]);
  }
  return ring;
}

/**
 * World polygon with a hole of `radiusM` around `center`. Used by a `clip`
 * layer to remove 3D content everywhere outside the driver radius.
 */
export function outsideRadiusMask(
  center: LngLat,
  radiusM: number,
): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-180, -85],
          [180, -85],
          [180, 85],
          [-180, 85],
          [-180, -85],
        ],
        circleRing(center, radiusM),
      ],
    },
  };
}

/**
 * Nearest point on the route to `p`: its distance along the route and how far
 * `p` is from it (meters). Uses a local flat approximation per segment, which
 * is accurate at city scale.
 */
export function nearestAlong(route: MeasuredRoute, p: LngLat): { alongM: number; offM: number } {
  const { points, cumulative } = route;
  const kx = Math.cos(toRad(p[1])) * 111_320; // meters per degree lng
  const ky = 110_540; // meters per degree lat
  let best = { alongM: 0, offM: Infinity };
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const ax = (a[0] - p[0]) * kx;
    const ay = (a[1] - p[1]) * ky;
    const dx = (b[0] - a[0]) * kx;
    const dy = (b[1] - a[1]) * ky;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const off = Math.hypot(ax + dx * t, ay + dy * t);
    if (off < best.offM) {
      best = { alongM: cumulative[i - 1] + (cumulative[i] - cumulative[i - 1]) * t, offM: off };
    }
  }
  return best;
}
