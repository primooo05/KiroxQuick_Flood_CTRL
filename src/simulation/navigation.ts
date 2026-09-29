// src/simulation/navigation.ts
//
// Pure navigation state for the driving HUD: next maneuver + distance to it,
// the nearest hazard ahead, and remaining distance/time. Engine- and
// React-free so it is unit-testable.

import type { RouteManeuver } from '../data/fixtures/pitxToMoaRoute';
import type { DriveHazard } from '../data/fixtures/driveHazards';

/** Only warn about hazards within this distance ahead. */
export const HAZARD_LOOKAHEAD_M = 1000;

export interface NavState {
  /** Next maneuver ahead (the arrival maneuver near the end). */
  next: RouteManeuver | null;
  /** Meters until the next maneuver. */
  toNextM: number;
  /** Nearest hazard ahead within {@link HAZARD_LOOKAHEAD_M}, if any. */
  hazard: DriveHazard | null;
  toHazardM: number;
  remainingM: number;
  /** Estimated real-world driving time left, seconds. */
  remainingS: number;
}

export function computeNavState(
  traveledM: number,
  lengthM: number,
  maneuvers: ReadonlyArray<RouteManeuver>,
  hazards: ReadonlyArray<DriveHazard>,
  speedMps: number,
): NavState {
  // Skip the "depart" step; the next maneuver is the first one still ahead.
  const next = maneuvers.find((m) => m.type !== 'depart' && m.atM > traveledM) ?? null;
  const hazard =
    hazards.find((h) => h.atM >= traveledM && h.atM - traveledM <= HAZARD_LOOKAHEAD_M) ?? null;
  const remainingM = Math.max(0, lengthM - traveledM);
  return {
    next,
    toNextM: next ? Math.max(0, next.atM - traveledM) : 0,
    hazard,
    toHazardM: hazard ? hazard.atM - traveledM : 0,
    remainingM,
    remainingS: speedMps > 0 ? remainingM / speedMps : 0,
  };
}

/** Driver-friendly distance: "Now", "40 m", "250 m", "1.2 km". */
export function formatDistance(m: number): string {
  if (m < 15) return 'Now';
  if (m < 100) return `${Math.round(m / 10) * 10} m`;
  if (m < 1000) return `${Math.round(m / 50) * 50} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

/** "3 min", "<1 min". */
export function formatDuration(s: number): string {
  const min = Math.round(s / 60);
  return min < 1 ? '<1 min' : `${min} min`;
}

/**
 * Arrow rotation (degrees, 0 = straight up) for a maneuver modifier, or null
 * for arrival (rendered as a destination glyph instead).
 */
export function maneuverRotation(m: RouteManeuver | null): number | null {
  if (!m || m.type === 'arrive') return null;
  switch (m.modifier) {
    case 'slight right':
      return 45;
    case 'right':
      return 90;
    case 'sharp right':
      return 135;
    case 'uturn':
      return 180;
    case 'sharp left':
      return -135;
    case 'left':
      return -90;
    case 'slight left':
      return -45;
    default:
      return 0;
  }
}

/** Short banner text, e.g. "Turn left onto Quirino Avenue". */
export function maneuverText(m: RouteManeuver | null): string {
  if (!m) return 'Continue on route';
  if (m.type === 'arrive') return 'Arrive at SM Mall of Asia';
  // Directions instructions include route refs ("Quirino Avenue/62"); keep the
  // street name only when we have one.
  if (m.street && m.type === 'turn' && m.modifier) {
    return `Turn ${m.modifier} onto ${m.street}`;
  }
  return m.instruction.replace(/\.$/, '');
}
