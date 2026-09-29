// src/camera/overviewFraming.test.ts
//
// Feature: baharoute-navigation-experience — Milestone A
// Unit tests for the pure overview framing constants/helpers (Req 1.2–1.6).
// jsdom-safe: no Mapbox GL JS, no WebGL, no camera side effects.

import { describe, expect, it } from 'vitest';
import {
  OVERVIEW_BOUNDS,
  OVERVIEW_FIT_DURATION_MS,
  OVERVIEW_FIT_PADDING,
  OVERVIEW_ASPECT_THRESHOLD,
  OVERVIEW_DESKTOP_MIN_WIDTH,
  OVERVIEW_TARGET_FILL,
  OVERVIEW_DESKTOP_TARGET_FILL,
  OVERVIEW_DESKTOP_ZOOM_RANGE,
  OVERVIEW_DESKTOP_CENTER,
  OVERVIEW_DESKTOP_ZOOM,
  NCR_LON_SPAN_DEG,
  NCR_LAT_SPAN_DEG,
  NCR_PROJECTED_LAT_SPAN_DEG,
  STYLE_MAX_ZOOM,
  STYLE_MIN_ZOOM,
  computeOverviewFraming,
  mercatorY,
  overviewBoundsFromNCR,
  overviewDesktopZoom,
  overviewFitOptions,
  projectedLatSpanDeg,
  visibleSpanDeg,
  zoomForSpan,
} from './overviewFraming';
import {
  METRO_MANILA_BOUNDS,
  isWithinMetroManila,
} from '../map/metroManilaExtent';

/** Inclusive point-in-bounds check against a [[west, south], [east, north]] box. */
function withinBounds(
  bounds: [[number, number], [number, number]],
  lng: number,
  lat: number,
): boolean {
  const [[west, south], [east, north]] = bounds;
  return lng >= west && lng <= east && lat >= south && lat <= north;
}

// Representative center coordinates for NCR cities (approximate, WGS84). These
// sit in the core of Metro Manila and must remain framed by OVERVIEW_BOUNDS.
const NCR_CITY_CENTERS: ReadonlyArray<readonly [string, number, number]> = [
  ['Manila', 120.9822, 14.5995],
  ['Quezon City', 121.0437, 14.676],
  ['Makati', 121.0244, 14.5547],
  ['Pasig', 121.0851, 14.5764],
  ['Taguig', 121.0509, 14.5176],
  ['Caloocan', 120.9836, 14.6519],
  ['Marikina', 121.1029, 14.6507],
  ['Muntinlupa', 121.0498, 14.4081],
  ['Parañaque', 121.0198, 14.4793],
  ['Valenzuela', 120.9822, 14.696],
];

describe('OVERVIEW_BOUNDS (Req 1.2, 1.3, 1.4, 1.5)', () => {
  it('is a well-formed [[west, south], [east, north]] box with west<east and south<north', () => {
    const [[west, south], [east, north]] = OVERVIEW_BOUNDS;
    expect(west).toBeLessThan(east);
    expect(south).toBeLessThan(north);
  });

  it('is derived from — and no wider than — the NCR extent (inside or equal)', () => {
    const [[west, south], [east, north]] = OVERVIEW_BOUNDS;
    // Never widened past the NCR bounds (Req 1.5): each edge sits within.
    expect(west).toBeGreaterThanOrEqual(METRO_MANILA_BOUNDS.west);
    expect(south).toBeGreaterThanOrEqual(METRO_MANILA_BOUNDS.south);
    expect(east).toBeLessThanOrEqual(METRO_MANILA_BOUNDS.east);
    expect(north).toBeLessThanOrEqual(METRO_MANILA_BOUNDS.north);
  });

  it('equals the NCR extent by default so all 17 NCR cities stay framed (Req 1.3)', () => {
    expect(OVERVIEW_BOUNDS).toEqual([
      [METRO_MANILA_BOUNDS.west, METRO_MANILA_BOUNDS.south],
      [METRO_MANILA_BOUNDS.east, METRO_MANILA_BOUNDS.north],
    ]);
  });

  it('still spans the core NCR (each edge is within its half-span of the NCR bounds)', () => {
    // Guard against over-tightening: the box must remain an NCR-scale frame,
    // not collapse toward the center.
    const [[west, south], [east, north]] = OVERVIEW_BOUNDS;
    const lngHalfSpan = (METRO_MANILA_BOUNDS.east - METRO_MANILA_BOUNDS.west) / 2;
    const latHalfSpan =
      (METRO_MANILA_BOUNDS.north - METRO_MANILA_BOUNDS.south) / 2;
    expect(west - METRO_MANILA_BOUNDS.west).toBeLessThan(lngHalfSpan);
    expect(METRO_MANILA_BOUNDS.east - east).toBeLessThan(lngHalfSpan);
    expect(south - METRO_MANILA_BOUNDS.south).toBeLessThan(latHalfSpan);
    expect(METRO_MANILA_BOUNDS.north - north).toBeLessThan(latHalfSpan);
  });

  it('frames the representative NCR city centers', () => {
    for (const [name, lng, lat] of NCR_CITY_CENTERS) {
      expect(
        withinBounds(OVERVIEW_BOUNDS, lng, lat),
        `${name} (${lng}, ${lat}) should be within OVERVIEW_BOUNDS`,
      ).toBe(true);
    }
  });
});

describe('overviewBoundsFromNCR', () => {
  it('returns exactly the NCR extent when margin is 0', () => {
    const bounds = overviewBoundsFromNCR(0);
    expect(bounds).toEqual([
      [METRO_MANILA_BOUNDS.west, METRO_MANILA_BOUNDS.south],
      [METRO_MANILA_BOUNDS.east, METRO_MANILA_BOUNDS.north],
    ]);
  });

  it('tightens symmetrically inward for a positive margin, staying inside the NCR', () => {
    const margin = 0.02;
    const [[west, south], [east, north]] = overviewBoundsFromNCR(margin);
    expect(west).toBeCloseTo(METRO_MANILA_BOUNDS.west + margin, 10);
    expect(south).toBeCloseTo(METRO_MANILA_BOUNDS.south + margin, 10);
    expect(east).toBeCloseTo(METRO_MANILA_BOUNDS.east - margin, 10);
    expect(north).toBeCloseTo(METRO_MANILA_BOUNDS.north - margin, 10);
  });

  it('never inverts the box even for an absurdly large margin', () => {
    const [[west, south], [east, north]] = overviewBoundsFromNCR(999);
    expect(west).toBeLessThan(east);
    expect(south).toBeLessThan(north);
  });
});

describe('overview fit options (Req 1.2, 10.4)', () => {
  it('exposes a positive padding', () => {
    expect(OVERVIEW_FIT_PADDING).toBeGreaterThan(0);
  });

  it('uses a duration within the 1000ms state-transition budget', () => {
    expect(OVERVIEW_FIT_DURATION_MS).toBeGreaterThan(0);
    expect(OVERVIEW_FIT_DURATION_MS).toBeLessThanOrEqual(1000);
  });

  it('overviewFitOptions() returns { padding, duration } matching the constants', () => {
    const opts = overviewFitOptions();
    expect(opts).toEqual({
      padding: OVERVIEW_FIT_PADDING,
      duration: OVERVIEW_FIT_DURATION_MS,
    });
    expect(opts.duration).toBeLessThanOrEqual(1000);
  });
});

describe('responsive framing constants (Req 1.2–1.6)', () => {
  it('exposes the aspect threshold, desktop min width, and fill fraction', () => {
    // Threshold sits above square/portrait and below common landscape ratios.
    expect(OVERVIEW_ASPECT_THRESHOLD).toBeGreaterThan(1);
    expect(OVERVIEW_ASPECT_THRESHOLD).toBeLessThan(16 / 9);
    // Desktop min width matches the app's responsive breakpoint.
    expect(OVERVIEW_DESKTOP_MIN_WIDTH).toBe(768);
    // Fill leaves a thin band of edge context (no hard clip, Req 1.6).
    expect(OVERVIEW_TARGET_FILL).toBeGreaterThan(0);
    expect(OVERVIEW_TARGET_FILL).toBeLessThanOrEqual(1);
  });

  it('exposes the desktop product-framing fill and zoom range (nested in style bounds)', () => {
    // High fill so the NCR width dominates the desktop viewport (Req 1.2, 1.4).
    expect(OVERVIEW_DESKTOP_TARGET_FILL).toBeGreaterThan(OVERVIEW_TARGET_FILL);
    expect(OVERVIEW_DESKTOP_TARGET_FILL).toBeLessThanOrEqual(1);
    // Product zoom range is a well-formed [min, max] nested inside [9, 20].
    expect(OVERVIEW_DESKTOP_ZOOM_RANGE.min).toBeLessThan(
      OVERVIEW_DESKTOP_ZOOM_RANGE.max,
    );
    expect(OVERVIEW_DESKTOP_ZOOM_RANGE.min).toBeGreaterThanOrEqual(
      STYLE_MIN_ZOOM,
    );
    expect(OVERVIEW_DESKTOP_ZOOM_RANGE.max).toBeLessThanOrEqual(STYLE_MAX_ZOOM);
    // The intended product band ≈ 10.5–12.
    expect(OVERVIEW_DESKTOP_ZOOM_RANGE.min).toBe(10.5);
    expect(OVERVIEW_DESKTOP_ZOOM_RANGE.max).toBe(12);
  });

  it('exposes the tuned desktop product center + zoom (reference framing)', () => {
    // The reference Metro Manila center used by the desktop product framing.
    expect(OVERVIEW_DESKTOP_CENTER).toEqual([120.9842, 14.5995]);
    // The reference center must sit INSIDE the NCR (Req 1.2).
    expect(
      isWithinMetroManila(OVERVIEW_DESKTOP_CENTER[0], OVERVIEW_DESKTOP_CENTER[1]),
    ).toBe(true);
    // The reference product zoom (~11) is inside the product band and the
    // style bounds.
    expect(OVERVIEW_DESKTOP_ZOOM).toBe(11);
    expect(OVERVIEW_DESKTOP_ZOOM).toBeGreaterThanOrEqual(
      OVERVIEW_DESKTOP_ZOOM_RANGE.min,
    );
    expect(OVERVIEW_DESKTOP_ZOOM).toBeLessThanOrEqual(
      OVERVIEW_DESKTOP_ZOOM_RANGE.max,
    );
    expect(OVERVIEW_DESKTOP_ZOOM).toBeGreaterThanOrEqual(STYLE_MIN_ZOOM);
    expect(OVERVIEW_DESKTOP_ZOOM).toBeLessThanOrEqual(STYLE_MAX_ZOOM);
  });

  it('exposes the NCR longitude span used for the width fit', () => {
    expect(NCR_LON_SPAN_DEG).toBeCloseTo(
      METRO_MANILA_BOUNDS.east - METRO_MANILA_BOUNDS.west,
      10,
    );
    // Longitude span (~0.25°) is narrower than the latitude span (~0.38°),
    // which is exactly why the taller latitude span is the binding constraint
    // on wide screens and BOTH spans must fit (not just longitude).
    expect(NCR_LON_SPAN_DEG).toBeLessThan(NCR_LAT_SPAN_DEG);
  });

  it('exposes the NCR latitude span used for the height fit', () => {
    expect(NCR_LAT_SPAN_DEG).toBeCloseTo(
      METRO_MANILA_BOUNDS.north - METRO_MANILA_BOUNDS.south,
      10,
    );
    // Sanity: ~0.38° between Muntinlupa (south) and Valenzuela/Caloocan (north).
    expect(NCR_LAT_SPAN_DEG).toBeCloseTo(0.38, 10);
  });

  it('projects the latitude span to a slightly LARGER Mercator degrees-equivalent', () => {
    expect(NCR_PROJECTED_LAT_SPAN_DEG).toBeCloseTo(
      projectedLatSpanDeg(
        METRO_MANILA_BOUNDS.south,
        METRO_MANILA_BOUNDS.north,
      ),
      10,
    );
    // Web Mercator stretches latitude away from the equator, so near 14.6°N the
    // projected span is marginally larger than the raw span — making the height
    // fit the (correctly) more demanding constraint.
    expect(NCR_PROJECTED_LAT_SPAN_DEG).toBeGreaterThan(NCR_LAT_SPAN_DEG);
    expect(NCR_PROJECTED_LAT_SPAN_DEG).toBeLessThan(NCR_LAT_SPAN_DEG * 1.05);
  });
});

describe('Web Mercator latitude projection helpers', () => {
  it('mercatorY is monotonically increasing in latitude', () => {
    expect(mercatorY(14.78)).toBeGreaterThan(mercatorY(14.4));
    expect(mercatorY(0)).toBeCloseTo(0, 10);
  });

  it('projectedLatSpanDeg matches the closed-form Mercator span', () => {
    const expected =
      Math.abs(mercatorY(14.78) - mercatorY(14.4)) / (Math.PI / 180);
    expect(projectedLatSpanDeg(14.4, 14.78)).toBeCloseTo(expected, 12);
  });

  it('projectedLatSpanDeg is symmetric in its argument order', () => {
    expect(projectedLatSpanDeg(14.78, 14.4)).toBeCloseTo(
      projectedLatSpanDeg(14.4, 14.78),
      12,
    );
  });
});

describe('zoomForSpan (Web Mercator span→zoom helper)', () => {
  it('stays within the style zoom bounds', () => {
    expect(zoomForSpan(NCR_LON_SPAN_DEG, 1440)).toBeGreaterThanOrEqual(
      STYLE_MIN_ZOOM,
    );
    expect(zoomForSpan(NCR_LON_SPAN_DEG, 1440)).toBeLessThanOrEqual(
      STYLE_MAX_ZOOM,
    );
  });

  it('yields a HIGHER zoom (larger NCR) for a WIDER viewport at the same span', () => {
    const narrow = zoomForSpan(NCR_LON_SPAN_DEG, 900);
    const wide = zoomForSpan(NCR_LON_SPAN_DEG, 1920);
    expect(wide).toBeGreaterThan(narrow);
  });

  it('matches the closed-form Web Mercator value for a known input', () => {
    // 2^zoom = fill * viewportPx * 360 / (spanDeg * 512)
    const viewportPx = 1440;
    const expected = Math.log2(
      (OVERVIEW_TARGET_FILL * viewportPx * 360) / (NCR_LON_SPAN_DEG * 512),
    );
    expect(zoomForSpan(NCR_LON_SPAN_DEG, viewportPx)).toBeCloseTo(expected, 10);
  });

  it('clamps degenerate inputs to the style min zoom', () => {
    expect(zoomForSpan(0, 1440)).toBe(STYLE_MIN_ZOOM);
    expect(zoomForSpan(NCR_LON_SPAN_DEG, 0)).toBe(STYLE_MIN_ZOOM);
  });
});

describe('visibleSpanDeg (inverse of the span→zoom relationship)', () => {
  it('round-trips with zoomForSpan at fill = 1 for a span/viewport pair', () => {
    // At fill = 1, zoomForSpan makes `span` fill the whole viewport, so the
    // visible span at that zoom must equal `span` again.
    const span = 0.3;
    const px = 1440;
    const zoom = zoomForSpan(span, px, 1);
    expect(visibleSpanDeg(zoom, px)).toBeCloseTo(span, 10);
  });

  it('shows a WIDER span at a lower zoom for the same viewport', () => {
    expect(visibleSpanDeg(10, 1440)).toBeGreaterThan(visibleSpanDeg(12, 1440));
  });

  it('returns 0 for a non-positive viewport', () => {
    expect(visibleSpanDeg(12, 0)).toBe(0);
  });
});

describe('overviewDesktopZoom (product framing: NCR fills the width, Req 1.2, 1.4)', () => {
  // Representative wide-desktop viewports (incl. ultrawide + a small landscape).
  const VIEWPORTS: ReadonlyArray<readonly [number, number]> = [
    [1440, 800],
    [1920, 1080],
    [2560, 1080],
    [1024, 768],
  ];

  it('fills the viewport WIDTH with the NCR longitude span (clamped into the product range)', () => {
    for (const [width, height] of VIEWPORTS) {
      const raw = zoomForSpan(
        NCR_LON_SPAN_DEG,
        width,
        OVERVIEW_DESKTOP_TARGET_FILL,
      );
      const expected = Math.min(
        STYLE_MAX_ZOOM,
        Math.max(
          STYLE_MIN_ZOOM,
          Math.min(
            OVERVIEW_DESKTOP_ZOOM_RANGE.max,
            Math.max(OVERVIEW_DESKTOP_ZOOM_RANGE.min, raw),
          ),
        ),
      );
      expect(overviewDesktopZoom({ width, height })).toBeCloseTo(expected, 12);
    }
  });

  it('lands in the intended product zoom range (~10.5–12) for typical desktops', () => {
    for (const [width, height] of [
      [1440, 800],
      [1920, 1080],
    ] as const) {
      const zoom = overviewDesktopZoom({ width, height });
      expect(zoom).toBeGreaterThanOrEqual(OVERVIEW_DESKTOP_ZOOM_RANGE.min);
      expect(zoom).toBeLessThanOrEqual(OVERVIEW_DESKTOP_ZOOM_RANGE.max);
    }
  });

  it('keeps the NCR DOMINANT: visible longitude span is within a modest factor of the NCR lon span', () => {
    for (const [width, height] of VIEWPORTS) {
      const zoom = overviewDesktopZoom({ width, height });
      const visibleLonSpan = visibleSpanDeg(zoom, width);
      // NCR fills most of the width; provinces are only peripheral. We do NOT
      // require full lat containment (outer NCR edges may fall just outside).
      expect(
        visibleLonSpan,
        `visible lon span at ${width}x${height}`,
      ).toBeLessThanOrEqual(NCR_LON_SPAN_DEG * 2);
    }
  });

  it('is independent of viewport HEIGHT (height no longer participates)', () => {
    // Two viewports with the same width but very different heights yield the
    // same product zoom — full-extent (both-dimensions) fitting was removed.
    expect(overviewDesktopZoom({ width: 1920, height: 800 })).toBeCloseTo(
      overviewDesktopZoom({ width: 1920, height: 1200 }),
      12,
    );
  });

  it('stays within the style zoom bounds', () => {
    for (const [width, height] of VIEWPORTS) {
      const zoom = overviewDesktopZoom({ width, height });
      expect(zoom).toBeGreaterThanOrEqual(STYLE_MIN_ZOOM);
      expect(zoom).toBeLessThanOrEqual(STYLE_MAX_ZOOM);
    }
  });
});

describe('computeOverviewFraming (Req 1.2–1.6)', () => {
  it('wide desktop → centerZoom on the tuned product center at the product zoom', () => {
    const framing = computeOverviewFraming({ width: 1440, height: 800 });
    expect(framing.mode).toBe('centerZoom');
    if (framing.mode !== 'centerZoom') throw new Error('expected centerZoom');
    // Product framing: the tuned reference center (inside the NCR), not the
    // geometric extent center.
    expect(framing.center).toEqual(OVERVIEW_DESKTOP_CENTER);
    expect(isWithinMetroManila(framing.center[0], framing.center[1])).toBe(
      true,
    );
    // The tuned product zoom (~11): NCR large, close, and dominant.
    expect(framing.zoom).toBe(OVERVIEW_DESKTOP_ZOOM);
    expect(framing.zoom).toBeGreaterThanOrEqual(STYLE_MIN_ZOOM);
    expect(framing.zoom).toBeLessThanOrEqual(STYLE_MAX_ZOOM);
    expect(framing.zoom).toBeGreaterThanOrEqual(OVERVIEW_DESKTOP_ZOOM_RANGE.min);
    expect(framing.zoom).toBeLessThanOrEqual(OVERVIEW_DESKTOP_ZOOM_RANGE.max);
    expect(framing.duration).toBeLessThanOrEqual(1000);
  });

  it('uses the tuned product center + zoom for representative desktop viewports', () => {
    const viewports: ReadonlyArray<readonly [number, number]> = [
      [1440, 800],
      [1920, 1080],
      [2560, 1080],
    ];
    for (const [width, height] of viewports) {
      const framing = computeOverviewFraming({ width, height });
      if (framing.mode !== 'centerZoom') {
        throw new Error(`expected centerZoom at ${width}x${height}`);
      }
      // The framing is a fixed tuned center+zoom, independent of exact width.
      expect(framing.center).toEqual(OVERVIEW_DESKTOP_CENTER);
      expect(framing.zoom).toBe(OVERVIEW_DESKTOP_ZOOM);
      expect(framing.zoom).toBeGreaterThanOrEqual(STYLE_MIN_ZOOM);
      expect(framing.zoom).toBeLessThanOrEqual(STYLE_MAX_ZOOM);
    }
  });

  it('keeps the NCR DOMINANT: provinces stay peripheral at typical desktops', () => {
    // At the product zoom, the visible longitude span on a typical desktop is a
    // small multiple of the NCR lon span, so the NCR fills a large, dominant
    // fraction of the width and provinces are only peripheral. We do NOT assert
    // full NCR lat containment (outer edges may fall just outside).
    for (const width of [1440, 1920] as const) {
      const framing = computeOverviewFraming({ width, height: 800 });
      if (framing.mode !== 'centerZoom') throw new Error('expected centerZoom');
      const visibleLonSpan = visibleSpanDeg(framing.zoom, width);
      expect(
        visibleLonSpan,
        `visible lon span at ${width}px`,
      ).toBeLessThan(NCR_LON_SPAN_DEG * 3);
    }
  });

  it('desktop framing is independent of viewport HEIGHT (full-extent fitting removed)', () => {
    const shorter = computeOverviewFraming({ width: 1920, height: 800 });
    const taller = computeOverviewFraming({ width: 1920, height: 1200 });
    if (shorter.mode !== 'centerZoom' || taller.mode !== 'centerZoom') {
      throw new Error('expected centerZoom for both viewports');
    }
    expect(taller.zoom).toBe(shorter.zoom);
    expect(taller.center).toEqual(shorter.center);
  });

  it('narrow/portrait mobile → fitBounds with OVERVIEW_BOUNDS + overviewFitOptions', () => {
    const framing = computeOverviewFraming({ width: 390, height: 844 });
    expect(framing.mode).toBe('fitBounds');
    if (framing.mode !== 'fitBounds') throw new Error('expected fitBounds');
    expect(framing.bounds).toEqual(OVERVIEW_BOUNDS);
    expect(framing.padding).toBe(overviewFitOptions().padding);
    expect(framing.duration).toBe(overviewFitOptions().duration);
  });

  it('uses the aspect threshold: at/below → fitBounds, just above → centerZoom', () => {
    const height = 800;
    // Just at the threshold aspect → fitBounds.
    const atThreshold = computeOverviewFraming({
      width: OVERVIEW_ASPECT_THRESHOLD * height,
      height,
    });
    expect(atThreshold.mode).toBe('fitBounds');
    // Just above the threshold aspect → centerZoom.
    const aboveThreshold = computeOverviewFraming({
      width: (OVERVIEW_ASPECT_THRESHOLD + 0.05) * height,
      height,
    });
    expect(aboveThreshold.mode).toBe('centerZoom');
  });

  it('a wide but narrow-width device (below desktop min) stays fitBounds', () => {
    // Aspect is wide (1.5) but width < 768 → treated as mobile, keeps fitBounds.
    const framing = computeOverviewFraming({ width: 600, height: 400 });
    expect(framing.mode).toBe('fitBounds');
  });

  it('a degenerate (zero-size) viewport falls back to fitBounds', () => {
    expect(computeOverviewFraming({ width: 0, height: 0 }).mode).toBe(
      'fitBounds',
    );
  });
});
