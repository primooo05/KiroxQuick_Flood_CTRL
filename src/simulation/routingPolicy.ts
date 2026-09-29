// src/simulation/routingPolicy.ts
//
// Risk-aware routing policy (Phase 2, Req 11). Maps a hazard/risk severity to a
// routing recommendation. This does NOT change how routes are computed (the
// existing drive simulation + reroute stitching are preserved); it only decides
// how strongly to recommend avoiding a segment and what wording to show.
//
// SAFETY (docs/FLOOD_SEMANTICS.md): a route is NEVER called "safe". We use
// "Recommended route" / "Lower-risk alternative" / "Flood-risk warning". A
// CONFIRMED CLOSURE is never routed through.

import type { FloodState } from '../types/flood';
import type { CurrentRiskLevel } from '../types/risk';

/** How strongly routing should react to a segment's risk. */
export type RoutingStance =
  | 'normal' // LOW — route normally
  | 'caution' // ELEVATED — allowed, show caution
  | 'avoid' // HIGH — avoid if a reasonable alternative exists
  | 'stronglyAvoid' // LIKELY / REPORTED FLOODING — strongly avoid
  | 'block'; // CONFIRMED CLOSURE — never route through

/** Maps a current-risk level to the routing stance. */
export function routingStanceForRisk(level: CurrentRiskLevel): RoutingStance {
  switch (level) {
    case 'CONFIRMED_NOT_PASSABLE':
      return 'block';
    case 'REPORTED_FLOODING':
    case 'LIKELY_FLOODING':
      return 'stronglyAvoid';
    case 'HIGH':
      return 'avoid';
    case 'ELEVATED':
      return 'caution';
    case 'LOW':
    case 'STALE':
    case 'UNKNOWN':
    default:
      return 'normal';
  }
}

/**
 * Maps a demo hazard's reported flood state to a routing stance. RED reported
 * flooding is strongly avoided; ORANGE is avoided; YELLOW is caution. (Hazards
 * are community/demo reports, so they never reach `block` — only an official
 * closure does.)
 */
export function routingStanceForHazard(
  state: Extract<FloodState, 'RED' | 'ORANGE' | 'YELLOW'>,
): RoutingStance {
  switch (state) {
    case 'RED':
      return 'stronglyAvoid';
    case 'ORANGE':
      return 'avoid';
    case 'YELLOW':
    default:
      return 'caution';
  }
}

/** True when routing must never pass through this stance. */
export function isBlocking(stance: RoutingStance): boolean {
  return stance === 'block';
}

/** True when an alternative should be actively recommended for this stance. */
export function shouldRecommendAlternative(stance: RoutingStance): boolean {
  return stance === 'avoid' || stance === 'stronglyAvoid' || stance === 'block';
}

/** Short commuter-facing reason for why a route change is recommended. */
export function rerouteReason(
  stance: RoutingStance,
  place: string,
): string {
  switch (stance) {
    case 'block':
      return `Original route crosses a confirmed closure at ${place}.`;
    case 'stronglyAvoid':
      return `Original route crosses reported flooding at ${place}.`;
    case 'avoid':
      return `Original route crosses a high flood-risk area at ${place}.`;
    case 'caution':
      return `Flood-risk warning near ${place}.`;
    case 'normal':
    default:
      return '';
  }
}
