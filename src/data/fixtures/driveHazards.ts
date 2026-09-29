// src/data/fixtures/driveHazards.ts
//
// DEMO / UNCONFIRMED flood reports placed along the PITX → MOA demo route so
// the driving HUD can show "what to avoid". These are NOT real reports and
// must always be labeled as demo + unconfirmed (docs/FLOOD_SEMANTICS.md).
// Positions are stored as distance along the route so they sit exactly on it.

import type { FloodState } from '../../types/flood';

export interface DriveHazard {
  id: string;
  /** Distance from the route start, meters. */
  atM: number;
  /** Reported current-condition state (never GREEN/"safe" here). */
  state: Extract<FloodState, 'RED' | 'ORANGE' | 'YELLOW'>;
  /** Where it is, for the HUD text. */
  street: string;
}

export const DRIVE_HAZARDS_SOURCE_LABEL = 'DEMO — unconfirmed';

export const PITX_TO_MOA_HAZARDS: ReadonlyArray<DriveHazard> = [
  { id: 'demo-roxas-baclaran', atM: 2850, state: 'RED', street: 'Roxas Boulevard' },
  { id: 'demo-edsa-extension', atM: 4050, state: 'YELLOW', street: 'EDSA' },
];
