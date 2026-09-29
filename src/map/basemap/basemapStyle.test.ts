// src/map/basemap/basemapStyle.test.ts
//
// Group 2 (Mapbox engine swap): the BahaRoute basemap is now a STOCK MAPBOX
// STYLE URL rather than a hand-authored MapTiler/OpenMapTiles vector style. The
// old assertions about the openmaptiles source URL, per-layer base-color
// saturation, and hand-authored road-tier widths/minzoom no longer apply and
// have been removed. The base/flood color-token discipline they used to guard
// now lives in colorTokens.test.ts.
//
// What remains to assert here is the style provider contract that MapManager
// depends on: a mapbox:// style URL and the preserved style-level zoom bounds.
import { describe, expect, it } from 'vitest';
import {
  BAHAROUTE_MAPBOX_STYLE_URL,
  STYLE_MAX_ZOOM,
  STYLE_MIN_ZOOM,
  bahaRouteStyleUrl,
} from './BahaRouteStyle';

describe('BahaRoute basemap style provider (Mapbox stock style)', () => {
  it('bahaRouteStyleUrl() returns a mapbox:// style URL', () => {
    const url = bahaRouteStyleUrl();
    expect(url).toBe(BAHAROUTE_MAPBOX_STYLE_URL);
    expect(url.startsWith('mapbox://styles/mapbox/')).toBe(true);
  });

  it('carries no embedded access token (token is applied at map construction)', () => {
    // The token flows from env → AppConfig → mapbox-gl accessToken, never the
    // style URL (Req 17.1, 17.2). A `mapbox://` style reference has no query key.
    expect(bahaRouteStyleUrl()).not.toContain('key=');
    expect(bahaRouteStyleUrl()).not.toContain('access_token');
    expect(bahaRouteStyleUrl()).not.toContain('?');
  });

  it('preserves the style-level zoom bounds (9..20)', () => {
    expect(STYLE_MIN_ZOOM).toBe(9);
    expect(STYLE_MAX_ZOOM).toBe(20);
    expect(STYLE_MIN_ZOOM).toBeLessThan(STYLE_MAX_ZOOM);
  });
});
