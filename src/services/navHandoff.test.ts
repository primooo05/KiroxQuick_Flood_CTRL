// src/services/navHandoff.test.ts
//
// Guards the OPTIONAL external navigation handoff deep links. These are a
// convenience escape hatch; Driver Mode stays primary. The links must use each
// provider's lat,lng convention and the correct per-mode behavior, and must
// never imply the external route is "safe".

import { describe, it, expect } from 'vitest';
import { buildNavHandoffLinks } from './navHandoff';

const ORIGIN = [120.9896, 14.5339] as const; // PITX-ish [lng, lat]
const DEST = [120.9822, 14.5355] as const; // MOA-ish [lng, lat]

describe('buildNavHandoffLinks', () => {
  it('builds Google / Waze / Apple links for drive mode', () => {
    const links = buildNavHandoffLinks(ORIGIN, DEST, 'drive');
    const providers = links.map((l) => l.provider);
    expect(providers).toEqual(['google', 'waze', 'apple']);
  });

  it('converts [lng, lat] to each provider lat,lng convention', () => {
    const [google] = buildNavHandoffLinks(ORIGIN, DEST, 'drive');
    // Google destination should be "lat,lng" (14.5355,120.9822), not lng,lat.
    expect(google.url).toContain('destination=14.5355,120.9822');
    expect(google.url).toContain('origin=14.5339,120.9896');
    expect(google.url).toContain('travelmode=driving');
  });

  it('omits Waze for non-drive modes (driving-first provider)', () => {
    const walk = buildNavHandoffLinks(ORIGIN, DEST, 'walk').map((l) => l.provider);
    expect(walk).not.toContain('waze');
    expect(walk).toContain('google');
    expect(walk).toContain('apple');
  });

  it('omits Apple for bike (no cycling flag) but keeps Google', () => {
    const bike = buildNavHandoffLinks(ORIGIN, DEST, 'bike').map((l) => l.provider);
    expect(bike).toContain('google');
    expect(bike).not.toContain('apple');
    expect(bike).not.toContain('waze');
  });

  it('uses the right Google travelmode per mode', () => {
    const g = (mode: 'drive' | 'bike' | 'walk') =>
      buildNavHandoffLinks(ORIGIN, DEST, mode).find((l) => l.provider === 'google')!.url;
    expect(g('drive')).toContain('travelmode=driving');
    expect(g('bike')).toContain('travelmode=bicycling');
    expect(g('walk')).toContain('travelmode=walking');
  });

  it('never labels any provider as "safe"', () => {
    const links = buildNavHandoffLinks(ORIGIN, DEST, 'drive');
    for (const l of links) {
      expect(l.label.toLowerCase()).not.toContain('safe');
    }
  });
});
