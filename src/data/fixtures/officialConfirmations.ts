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

/**
 * Data-driven provider for official confirmations. Confirmed closures must come
 * from an official/authorized source only — rainfall and community reports can
 * NEVER produce CONFIRMED_NOT_PASSABLE (see src/types/risk.ts and
 * docs/FLOOD_SEMANTICS.md). This indirection replaces the previously hardcoded
 * fixture reference so a real MMDA/LGU feed can be swapped in later WITHOUT
 * touching call sites, while keeping the demo data as the default.
 *
 * The provider validates every record so a malformed or non-authoritative entry
 * can never silently become a confirmed closure:
 *   - `notPassable` must be an explicit boolean,
 *   - `source` must be a non-empty authority label,
 *   - `psgc` must be a non-empty barangay code,
 *   - `confirmedAt` must be a finite timestamp.
 * Invalid records are dropped (not coerced). Order is preserved.
 */
export function loadOfficialConfirmations(
  records: readonly OfficialStatus[] = officialConfirmationFixtures,
): readonly OfficialStatus[] {
  return records.filter(
    (o) =>
      typeof o.notPassable === 'boolean' &&
      typeof o.source === 'string' &&
      o.source.trim().length > 0 &&
      typeof o.psgc === 'string' &&
      o.psgc.trim().length > 0 &&
      typeof o.confirmedAt === 'number' &&
      Number.isFinite(o.confirmedAt),
  );
}
