// src/data/fixtures/officialConfirmations.ts
//
// ⚠️ DEMO / MANUAL CONFIRMATION DATA — NOT A LIVE MMDA/LGU FEED ⚠️
//
// Official/admin confirmations are the ONLY thing that can set a barangay (or
// road segment) to CONFIRMED_NOT_PASSABLE. For the hackathon MVP there is no
// structured MMDA/LGU API, so this is fixture/demo data, clearly labeled as
// manual/demo confirmation. Rainfall and community reports can NEVER produce
// this state — see src/services/barangayRisk.ts.

import type { OfficialStatus } from '../../types/risk';

/** Source label making the demo/manual nature explicit. */
export const OFFICIAL_CONFIRMATION_DEMO_SOURCE =
  'DEMO — manual admin confirmation (not a live MMDA/LGU feed)';

/** Marks this module's contents as demo/fixture data. */
export const OFFICIAL_CONFIRMATIONS_IS_DEMO = true;

const CONFIRMED_AT = 1_700_000_000;

/**
 * Demo official confirmations. Keyed by barangay PSGC. In a real deployment an
 * admin flow (or an MMDA/LGU integration) would populate these; here one
 * barangay is confirmed not passable so the state is demonstrable end to end.
 *
 * NOTE: the PSGC below must exist in the NCR barangay dataset. It is a real
 * NCR barangay code used purely to demonstrate the admin-confirmed state.
 */
export const officialConfirmationFixtures: readonly OfficialStatus[] = [
  {
    // A Manila barangay (Barangay 1) — demo confirmed-not-passable.
    psgc: 'PH1303901001',
    notPassable: true,
    source: OFFICIAL_CONFIRMATION_DEMO_SOURCE,
    confirmedAt: CONFIRMED_AT,
    note: 'DEMO: road impassable due to flooding (manual admin confirmation).',
  },
];
