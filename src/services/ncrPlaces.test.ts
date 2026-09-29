// src/services/ncrPlaces.test.ts
//
// The local NCR place index: search is case/diacritic-insensitive and
// prefix-preferring, coverage gating is strictly NCR, and the flagship demo
// endpoints (PITX / MOA) resolve to the exact route endpoints.

import { describe, it, expect } from 'vitest';
import {
  NCR_PLACES,
  searchPlaces,
  isWithinNCR,
  UNSUPPORTED_AREA_MESSAGE,
} from './ncrPlaces';
import { PITX_TO_MOA_ROUTE } from '../data/fixtures/pitxToMoaRoute';

describe('searchPlaces', () => {
  it('returns a default set (landmarks) for an empty query', () => {
    const results = searchPlaces('');
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(8);
    expect(results[0].kind).toBe('landmark');
  });

  it('matches case- and diacritic-insensitively', () => {
    const withDiacritic = searchPlaces('parañaque');
    const plain = searchPlaces('paranaque');
    const upper = searchPlaces('PARANAQUE');
    // All three forms find PITX (in Parañaque) or the LGU.
    expect(plain.length).toBeGreaterThan(0);
    expect(withDiacritic.length).toBeGreaterThan(0);
    expect(upper.map((p) => p.id)).toEqual(plain.map((p) => p.id));
  });

  it('prefers prefix matches over substring matches', () => {
    const results = searchPlaces('mak');
    // "Makati CBD" (name prefix) should outrank an area-only match.
    expect(results[0].name.toLowerCase().startsWith('mak')).toBe(true);
  });

  it('finds the PITX and MOA landmarks by name', () => {
    expect(searchPlaces('PITX').some((p) => p.id === 'lm-pitx')).toBe(true);
    expect(searchPlaces('Mall of Asia').some((p) => p.id === 'lm-moa')).toBe(true);
  });

  it('caps results at the requested limit', () => {
    expect(searchPlaces('a', 3).length).toBeLessThanOrEqual(3);
  });

  it('returns nothing for a query with no NCR match', () => {
    expect(searchPlaces('zzzznowhere')).toEqual([]);
  });
});

describe('NCR place index integrity', () => {
  it('places PITX and MOA at the exact demo-route endpoints', () => {
    const pitx = NCR_PLACES.find((p) => p.id === 'lm-pitx');
    const moa = NCR_PLACES.find((p) => p.id === 'lm-moa');
    expect(pitx?.coord).toEqual(PITX_TO_MOA_ROUTE[0]);
    expect(moa?.coord).toEqual(PITX_TO_MOA_ROUTE[PITX_TO_MOA_ROUTE.length - 1]);
  });

  it('includes the 17 NCR LGUs plus curated landmarks', () => {
    const lgus = NCR_PLACES.filter((p) => p.kind === 'lgu');
    const landmarks = NCR_PLACES.filter((p) => p.kind === 'landmark');
    expect(lgus.length).toBe(17);
    expect(landmarks.length).toBeGreaterThan(0);
  });

  it('has every place coordinate within NCR', () => {
    for (const place of NCR_PLACES) {
      expect(isWithinNCR(place.coord[0], place.coord[1])).toBe(true);
    }
  });
});

describe('isWithinNCR', () => {
  it('accepts a Metro Manila coordinate', () => {
    expect(isWithinNCR(120.9842, 14.5995)).toBe(true); // Manila
  });

  it('rejects a coordinate far outside NCR', () => {
    expect(isWithinNCR(123.8854, 10.3157)).toBe(false); // Cebu
  });

  it('exposes a coverage message', () => {
    expect(UNSUPPORTED_AREA_MESSAGE).toMatch(/NCR/);
  });
});
