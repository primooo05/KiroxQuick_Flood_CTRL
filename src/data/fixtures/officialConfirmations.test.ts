// src/data/fixtures/officialConfirmations.test.ts
//
// Guards the data-driven official-confirmation provider. Confirmed closures are
// the ONLY path to CONFIRMED_NOT_PASSABLE, so the provider must only surface
// well-formed, authoritative records (see docs/FLOOD_SEMANTICS.md).

import { describe, it, expect } from 'vitest';
import type { OfficialStatus } from '../../types/risk';
import {
  loadOfficialConfirmations,
  officialConfirmationFixtures,
} from './officialConfirmations';

describe('loadOfficialConfirmations', () => {
  it('defaults to the demo fixtures and keeps them (they are well-formed)', () => {
    const out = loadOfficialConfirmations();
    expect(out).toEqual(officialConfirmationFixtures);
  });

  it('preserves valid records and their order', () => {
    const records: OfficialStatus[] = [
      {
        psgc: 'PH1303901001',
        notPassable: true,
        source: 'MMDA',
        confirmedAt: 1_700_000_000,
      },
      {
        psgc: 'PH1303901002',
        notPassable: false,
        source: 'LGU',
        confirmedAt: 1_700_000_100,
      },
    ];
    expect(loadOfficialConfirmations(records)).toEqual(records);
  });

  it('drops records with a missing/blank authority source', () => {
    const records = [
      { psgc: 'PH1', notPassable: true, source: '', confirmedAt: 1 },
      { psgc: 'PH2', notPassable: true, source: '   ', confirmedAt: 1 },
    ] as unknown as OfficialStatus[];
    expect(loadOfficialConfirmations(records)).toHaveLength(0);
  });

  it('drops records missing a barangay code or a finite timestamp', () => {
    const records = [
      { psgc: '', notPassable: true, source: 'MMDA', confirmedAt: 1 },
      { psgc: 'PH1', notPassable: true, source: 'MMDA', confirmedAt: Number.NaN },
    ] as unknown as OfficialStatus[];
    expect(loadOfficialConfirmations(records)).toHaveLength(0);
  });

  it('drops records where notPassable is not an explicit boolean', () => {
    const records = [
      { psgc: 'PH1', notPassable: 'yes', source: 'MMDA', confirmedAt: 1 },
      { psgc: 'PH2', source: 'MMDA', confirmedAt: 1 },
    ] as unknown as OfficialStatus[];
    expect(loadOfficialConfirmations(records)).toHaveLength(0);
  });
});
