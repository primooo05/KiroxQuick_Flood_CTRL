// src/camera/overviewFraming.ts
//
// Feature: baharoute-navigation-experience — Milestone A
//
// Pure framing constants + helpers for the OVERVIEW App_State (Req 1, 2, 10).
// This module is intentionally SIDE-EFFECT FREE: it does not import Mapbox GL JS and
// it never touches a camera. It only describes *what* to fit and *how much*
// padding/duration to use, so a future CameraController (Milestone D) can drive
// `fitBounds` predictably and this logic stays testable without WebGL.
//
// Design constraints honored here (Req 1):
//  - Metro Manila is centered and dominant; surrounding provinces (Bulacan,
//    Rizal, Cavite, Laguna) appear only at the viewport edges (Req 1.2–1.4).
//  - The framing is at NCR scale, NOT a nationwide/multi-region box (Req 1.5).
//  - This module provides ONLY fit bounds + padding. It does not add any
//    max-bounds/clipping, so the Basemap_Style keeps rendering beyond the box
//    (no hard clip at the NCR boundary, Req 1.6).

import { METRO_MANILA_BOUNDS } from '../map/metroManilaExtent';

/**
 * Pixels of padding passed to `fitBounds` for the overview framing.
 *
 * A small padding keeps the NCR filling the majority of the usable viewport
 * (Req 1.2) while leaving a thin band of natural edge context so the map does
 * not read as hard-clipped at the NCR boundary (Req 1.6). Kept modest (24px)
 * so Metro Manila stays dominant rather than shrinking into the middle.
 */
export const OVERVIEW_FIT_PADDING = 24;

/**
 * Default animation duration (ms) for the overview `fitBounds`.
 *
 * Kept small and well under the 1000ms App_State-transition budget (Req 10.4)
 * so entering OVERVIEW feels immediate without a jarring instant snap.
 */
export const OVERVIEW_FIT_DURATION_MS = 700;

/**
 * Symmetric inward margin (in degrees) applied to the NCR extent to derive the
 * overview box.
 *
 * Kept at 0 so {@link OVERVIEW_BOUNDS} equals {@link METRO_MANILA_BOUNDS}. The
 * NCR cities reach right up to the extent edges (e.g. Muntinlupa's center sits
 * just inside the southern edge), so any inward tightening would risk pushing a
 * real NCR city out of the box and breaking the "keep the 17 NCR cities within
 * the viewport" guarantee (Req 1.3). Metro Manila is instead made dominant via
 * modest fit padding (see {@link OVERVIEW_FIT_PADDING}), which frames the NCR
 * without clipping any of its cities. The `overviewBoundsFromNCR` helper still
 * accepts a positive margin for callers that want a tighter box, but the
 * exported default stays equal to the NCR extent.
 */
const OVERVIEW_INWARD_MARGIN_DEG = 0;

/**
 * Builds the overview bounding box from the NCR bounds, tightened symmetrically
 * inward by `marginDeg` degrees on every edge. The result is always inside (or
 * equal to, when `marginDeg` is 0) {@link METRO_MANILA_EXTENT}, keeping it
 * derived from the NCR bounds rather than widened into a regional box.
 *
 * @param marginDeg - Inward margin in degrees applied to each edge. Defaults to
 *   {@link OVERVIEW_INWARD_MARGIN_DEG}. Values are clamped so the box can never
 *   invert (west stays < east, south stays < north).
 * @returns `[[west, south], [east, north]]` with each corner a `[lng, lat]`
 *   pair, Mapbox GL JS `LngLatBounds`-compatible.
 */
export function overviewBoundsFromNCR(
  marginDeg: number = OVERVIEW_INWARD_MARGIN_DEG,
): [[number, number], [number, number]] {
  const { west, south, east, north } = METRO_MANILA_BOUNDS;

  // Clamp the margin so tightening never crosses the midpoint of either span
  // (which would invert the box). Just under half of each half-span keeps a
  // strictly positive interior.
  const maxLngMargin = (east - west) / 2 - 1e-6;
  const maxLatMargin = (north - south) / 2 - 1e-6;
  const safeMargin = Math.max(
    0,
    Math.min(marginDeg, maxLngMargin, maxLatMargin),
  );

  return [
    [west + safeMargin, south + safeMargin],
    [east - safeMargin, north - safeMargin],
  ];
}

/**
 * The tuned NCR overview bounding box used to frame the Overview_State
 * (Req 1.2, 1.3). Single source of truth for OVERVIEW framing.
 *
 * Derived from the NCR bounds via {@link overviewBoundsFromNCR}. With the
 * default margin of 0 it equals {@link METRO_MANILA_BOUNDS}, so every one of
 * the 17 NCR cities stays framed (Req 1.3) and the box is never widened into a
 * nationwide/regional box (Req 1.5). Metro Manila dominance (Req 1.2, 1.4) is
 * achieved by the modest {@link OVERVIEW_FIT_PADDING}, not by clipping the
 * extent.
 *
 * Format: `[[west, south], [east, north]]`, Mapbox GL JS `LngLatBounds`-compatible;
 * pass directly to `map.fitBounds(...)`.
 */
export const OVERVIEW_BOUNDS: [[number, number], [number, number]] =
  overviewBoundsFromNCR();

/**
 * Options for the overview `fitBounds` call: the padding (px) and animation
 * duration (ms) the CameraController applies when entering OVERVIEW.
 *
 * @returns `{ padding: OVERVIEW_FIT_PADDING, duration: OVERVIEW_FIT_DURATION_MS }`.
 */
export function overviewFitOptions(): { padding: number; duration: number } {
  return {
    padding: OVERVIEW_FIT_PADDING,
    duration: OVERVIEW_FIT_DURATION_MS,
  };
}

// ---------------------------------------------------------------------------
// Responsive, aspect-ratio-aware overview framing (Milestone A — product framing)
// ---------------------------------------------------------------------------
//
// FINAL DIRECTION (explicitly supersedes the earlier "keep the entire NCR
// visible in both dimensions" invariant): the desktop overview PRIORITIZES
// PRODUCT FRAMING. Metro Manila / NCR must look LARGE, CLOSE, and VISUALLY
// DOMINANT — matching the reference framing of a TUNED CENTER
// ({@link OVERVIEW_DESKTOP_CENTER}) at a PRODUCT ZOOM
// ({@link OVERVIEW_DESKTOP_ZOOM}) — NOT a strict full-extent `fitBounds`.
//
// Framing decision by viewport:
//   - NARROW / portrait-ish / mobile → `fitBounds(OVERVIEW_BOUNDS)`, which
//     already frames the NCR well on a tall viewport (Metro Manila dominant).
//   - WIDE DESKTOP → a fixed `centerZoom` framing on {@link OVERVIEW_DESKTOP_CENTER}
//     (the reference Metro-Manila center, inside the NCR) at
//     {@link OVERVIEW_DESKTOP_ZOOM} (the reference product zoom, ~11). This is
//     a TUNED center+zoom, not the min-of-both-fits full-bounds computation the
//     old desktop rule used (that kept 100% of the NCR bounds visible but made
//     the NCR read as small). The zoom is clamped defensively into the style
//     bounds `[STYLE_MIN_ZOOM, STYLE_MAX_ZOOM]`; it already sits inside the
//     intended product band {@link OVERVIEW_DESKTOP_ZOOM_RANGE}.
//
// CONSEQUENCE (intentional): full-extent desktop visibility is NOT guaranteed.
// Outer NCR edges (far-north Caloocan / Valenzuela, far-south Muntinlupa /
// Las Piñas) may sit near or slightly OUTSIDE the initial desktop viewport.
// That is an accepted product tradeoff: the central NCR is large and dominant;
// surrounding Cavite / Rizal / Bulacan appear only as peripheral context and
// must not visually compete with the NCR (Req 1.2, 1.4 read as product framing;
// strict full-extent Req 1.3 visibility is intentionally RELAXED for desktop).
// No maxBounds/clip is emitted, so the basemap keeps rendering beyond the NCR
// and users can still pan freely — no hard clip (Req 1.6).
//
// The width→zoom helpers below ({@link zoomForSpan}, {@link visibleSpanDeg},
// {@link mercatorY}, {@link projectedLatSpanDeg}, {@link overviewDesktopZoom}
// and the span constants) are RETAINED so tests can reason about the visible
// span at a given zoom (to confirm the NCR stays dominant) and for possible
// future tuning. They no longer DRIVE the desktop framing decision — the tuned
// center+zoom constants do.

/**
 * The tuned reference Metro Manila center used for the desktop product framing
 * (`[lng, lat]`, WGS84). This is the reference center around which the NCR
 * reads as large and dominant at {@link OVERVIEW_DESKTOP_ZOOM}. It lies INSIDE
 * the NCR extent (verified with `isWithinMetroManila` in the tests), so the
 * desktop overview center is always within Metro Manila (Req 1.2).
 */
export const OVERVIEW_DESKTOP_CENTER: [number, number] = [120.9842, 14.5995];

/**
 * The tuned reference product ZOOM for the desktop overview framing. At ~11 the
 * NCR fills most of a typical desktop viewport width and is immediately
 * recognizable, with surrounding provinces reduced to peripheral context. Sits
 * inside {@link OVERVIEW_DESKTOP_ZOOM_RANGE} and the style bounds `[9, 18]`.
 */
export const OVERVIEW_DESKTOP_ZOOM = 11;

/**
 * Style zoom bounds mirrored from the basemap style (`STYLE_MIN_ZOOM` /
 * `STYLE_MAX_ZOOM` in `BahaRouteStyle`). Re-declared here as local constants so
 * this module stays pure and engine-free (no import cycle through the style),
 * and so the responsive zoom can be clamped to the SAME bounds the map enforces.
 */
export const STYLE_MIN_ZOOM = 9;
export const STYLE_MAX_ZOOM = 20;

/**
 * Aspect-ratio threshold (viewport width / height) at or below which the
 * fitBounds framing is used. Above it the viewport is "wide desktop" and the
 * centerZoom framing takes over so the NCR fills the width instead of shrinking.
 *
 * ~1.3 sits comfortably above square-ish/portrait phones and typical tablet
 * portrait, and below common desktop/laptop landscape ratios (16:10 = 1.6,
 * 16:9 ≈ 1.78), so mobile/portrait keeps the proven fitBounds path while wide
 * landscape screens get the NCR-width framing.
 */
export const OVERVIEW_ASPECT_THRESHOLD = 1.3;

/**
 * Minimum viewport width (px) required to consider the centerZoom framing.
 * Below this the device is treated as mobile and always uses fitBounds, even if
 * a short landscape phone briefly reports a wide aspect ratio. Matches the
 * app's 768px responsive breakpoint (`layout.css`).
 */
export const OVERVIEW_DESKTOP_MIN_WIDTH = 768;

/**
 * Generic fill fraction retained for {@link zoomForSpan}'s default and for the
 * helper's round-trip tests. The desktop product framing uses the dedicated
 * {@link OVERVIEW_DESKTOP_TARGET_FILL} instead of this value.
 */
export const OVERVIEW_TARGET_FILL = 0.92;

/**
 * Fraction of the viewport WIDTH the NCR longitude span fills under the desktop
 * product framing. Kept HIGH (≈0.98) so the (narrower) NCR width dominates the
 * screen and Metro Manila reads as large and recognizable, leaving only a thin
 * sliver of province context at the left/right edges (no hard clip, Req 1.6).
 * Deliberately more aggressive than {@link OVERVIEW_TARGET_FILL} because the
 * product intent is NCR-dominant framing, not full-extent containment.
 */
export const OVERVIEW_DESKTOP_TARGET_FILL = 0.98;

/**
 * The intended PRODUCT ZOOM RANGE for the desktop overview framing. The tuned
 * {@link OVERVIEW_DESKTOP_ZOOM} (~11) sits inside this band; the range documents
 * the acceptable product zoom envelope and is used to clamp/validate in tests so
 * the NCR stays large and dominant across desktops. Nested inside the style
 * bounds `[9, 18]`.
 */
export const OVERVIEW_DESKTOP_ZOOM_RANGE = { min: 10.5, max: 12 } as const;

/** Web Mercator tile size (px) used for the zoom↔span relationship. */
const MERCATOR_TILE_SIZE = 512;

/**
 * The NCR longitude span (east − west) in degrees (~0.25°). The centerZoom
 * framing fits THIS span to the viewport WIDTH (one of the two constraints).
 */
export const NCR_LON_SPAN_DEG =
  METRO_MANILA_BOUNDS.east - METRO_MANILA_BOUNDS.west;

/**
 * The NCR latitude span (north − south) in degrees (~0.38°). Because the NCR is
 * TALLER than it is wide, this span — projected to Web-Mercator
 * degrees-equivalent (see {@link projectedLatSpanDeg}) — is the binding
 * constraint on typical wide screens, keeping northern Caloocan/Valenzuela and
 * southern Muntinlupa within the viewport (no clip, Req 1.3).
 */
export const NCR_LAT_SPAN_DEG =
  METRO_MANILA_BOUNDS.north - METRO_MANILA_BOUNDS.south;

/**
 * Web Mercator northing (in radians form) for a latitude in degrees:
 *
 *   mercatorY(latDeg) = ln( tan( π/4 + latDeg·π/360 ) )
 *
 * This is the standard Web Mercator y-projection. It is monotonic in latitude,
 * so the projected span between two latitudes is `|mercatorY(a) − mercatorY(b)|`.
 * Used to compare the NCR's latitude span against its longitude span on a common
 * (projected) footing, since near 14.6°N a degree of latitude spans more
 * world-pixels than a degree of longitude.
 *
 * @param latDeg - Latitude in WGS84 degrees.
 * @returns The unitless Mercator northing (radians form).
 */
export function mercatorY(latDeg: number): number {
  return Math.log(Math.tan(Math.PI / 4 + (latDeg * Math.PI) / 360));
}

/**
 * Converts a latitude span (south→north, degrees) into "degrees-equivalent" of
 * the Web-Mercator-projected world, so it can reuse the SAME 360°-world zoom
 * formula that {@link zoomForSpan} uses for longitude.
 *
 *   projLatSpan = |mercatorY(north) − mercatorY(south)| / (π/180)
 *
 * Dividing the (radians-form) projected span by `π/180` re-expresses it in the
 * same "degrees of the projected world" units that a longitude span already
 * occupies, so `zoomForSpan(projectedLatSpanDeg(...), height)` fits the NCR
 * HEIGHT consistently with the WIDTH fit. Near 14.6°N this is slightly LARGER
 * than the raw latitude span, so it is (correctly) the more demanding fit.
 *
 * @param southDeg - Southern latitude edge in WGS84 degrees.
 * @param northDeg - Northern latitude edge in WGS84 degrees.
 * @returns The latitude span expressed in projected degrees-equivalent.
 */
export function projectedLatSpanDeg(
  southDeg: number,
  northDeg: number,
): number {
  const projSpanRad = Math.abs(mercatorY(northDeg) - mercatorY(southDeg));
  return projSpanRad / (Math.PI / 180);
}

/**
 * The NCR latitude span expressed in Web-Mercator projected degrees-equivalent
 * (~0.39°, marginally larger than the raw 0.38° due to Mercator stretch near
 * 14.6°N). This is the value fed to the HEIGHT fit so the NCR's full north↕south
 * extent is contained by the viewport height.
 */
export const NCR_PROJECTED_LAT_SPAN_DEG = projectedLatSpanDeg(
  METRO_MANILA_BOUNDS.south,
  METRO_MANILA_BOUNDS.north,
);

/**
 * Derives a Web Mercator zoom that makes `spanDeg` degrees of longitude occupy
 * `fill` of `viewportPx` pixels, near the equator (Metro Manila is ~14.6°N, so
 * the small `cos(lat)` correction is folded into the tuned constants rather
 * than modeled precisely — this keeps the module pure and the NCR framing is
 * validated against the real browser).
 *
 * Relationship: the whole world (360°) spans `MERCATOR_TILE_SIZE * 2^zoom`
 * pixels, so degrees-per-pixel = 360 / (tile * 2^zoom). Solving for the zoom
 * where `spanDeg` fills `fill * viewportPx` pixels:
 *
 *   2^zoom = (fill * viewportPx * 360) / (spanDeg * tile)
 *   zoom   = log2( (fill * viewportPx * 360) / (spanDeg * tile) )
 *
 * A WIDER `viewportPx` (for the same span) yields a HIGHER zoom — i.e. a larger
 * NCR — which is exactly the wide-desktop correction. The result is clamped to
 * `[STYLE_MIN_ZOOM, STYLE_MAX_ZOOM]`.
 *
 * @param spanDeg - Geographic span (degrees of longitude) to frame. Must be > 0.
 * @param viewportPx - Viewport dimension (px) to fill. Must be > 0.
 * @param fill - Fraction of `viewportPx` the span should occupy (default
 *   {@link OVERVIEW_TARGET_FILL}).
 * @returns A zoom in `[STYLE_MIN_ZOOM, STYLE_MAX_ZOOM]`.
 */
export function zoomForSpan(
  spanDeg: number,
  viewportPx: number,
  fill: number = OVERVIEW_TARGET_FILL,
): number {
  if (spanDeg <= 0 || viewportPx <= 0) return STYLE_MIN_ZOOM;
  const rawZoom = Math.log2(
    (fill * viewportPx * 360) / (spanDeg * MERCATOR_TILE_SIZE),
  );
  return Math.min(STYLE_MAX_ZOOM, Math.max(STYLE_MIN_ZOOM, rawZoom));
}

/**
 * Inverse of {@link zoomForSpan}: the geographic span (in the same 360°-world
 * "degrees-equivalent" units) that occupies the FULL `viewportPx` pixels at a
 * given `zoom`. Single source of truth for "what does the viewport actually
 * show at this zoom", used by both the framing invariant and the tests so they
 * agree by construction.
 *
 * Relationship (from `2^zoom = viewportPx·360 / (spanDeg·tile)` with fill = 1):
 *
 *   spanDeg = viewportPx · 360 / (tile · 2^zoom)
 *
 * @param zoom - Web Mercator zoom level.
 * @param viewportPx - Viewport dimension (px) whose visible span is wanted.
 * @returns The visible span in projected degrees-equivalent (≥ 0).
 */
export function visibleSpanDeg(zoom: number, viewportPx: number): number {
  if (viewportPx <= 0) return 0;
  return (viewportPx * 360) / (MERCATOR_TILE_SIZE * Math.pow(2, zoom));
}

/**
 * RETAINED width→zoom helper. It computes a width-fill "product" zoom for a
 * viewport, but it NO LONGER drives {@link computeOverviewFraming}: the desktop
 * framing decision now uses the tuned {@link OVERVIEW_DESKTOP_ZOOM} constant.
 * This helper is kept so tests (and any future tuning) can reason about how a
 * width-fill zoom relates to the NCR span; removing it would leave dead test
 * references.
 *
 * Fits the NCR LONGITUDE span (~0.25°, the SHORTER NCR dimension) to the
 * viewport WIDTH at a HIGH fill ({@link OVERVIEW_DESKTOP_TARGET_FILL} ≈ 0.98),
 * i.e. the MORE zoomed-IN choice, so the NCR width dominates the screen:
 *
 *   raw = zoomForSpan(NCR_LON_SPAN_DEG, width, OVERVIEW_DESKTOP_TARGET_FILL)
 *
 * The raw value is then clamped into the intended product range
 * ({@link OVERVIEW_DESKTOP_ZOOM_RANGE}) so ultrawide / unusually narrow desktops
 * stay visually consistent (the NCR is always large and dominant), and finally
 * into the style bounds `[STYLE_MIN_ZOOM, STYLE_MAX_ZOOM]`.
 *
 * NOTE: the viewport HEIGHT does not participate — full-extent (both-
 * dimensions) containment is intentionally NOT guaranteed on desktop (see the
 * module header). The `height` field is accepted for API compatibility but
 * unused.
 *
 * @param viewport - `{ width, height }` of the map container in CSS pixels.
 * @returns The desktop overview zoom in `[STYLE_MIN_ZOOM, STYLE_MAX_ZOOM]`,
 *   clamped into {@link OVERVIEW_DESKTOP_ZOOM_RANGE}.
 */
export function overviewDesktopZoom(viewport: {
  width: number;
  height: number;
}): number {
  const raw = zoomForSpan(
    NCR_LON_SPAN_DEG,
    viewport.width,
    OVERVIEW_DESKTOP_TARGET_FILL,
  );
  // Clamp into the product zoom range first (keeps ultrawide/narrow desktops
  // consistent), then into the style bounds. The product range is nested inside
  // the style bounds, so the style clamp is a belt-and-suspenders guard.
  const productClamped = Math.min(
    OVERVIEW_DESKTOP_ZOOM_RANGE.max,
    Math.max(OVERVIEW_DESKTOP_ZOOM_RANGE.min, raw),
  );
  return Math.min(STYLE_MAX_ZOOM, Math.max(STYLE_MIN_ZOOM, productClamped));
}

/** The fitBounds branch of the responsive framing decision. */
export interface OverviewFramingFitBounds {
  mode: 'fitBounds';
  bounds: [[number, number], [number, number]];
  padding: number;
  duration: number;
}

/** The centerZoom branch of the responsive framing decision. */
export interface OverviewFramingCenterZoom {
  mode: 'centerZoom';
  center: [number, number];
  zoom: number;
  duration: number;
}

/**
 * The responsive framing decision: either a `fitBounds` (narrow/mobile) or a
 * `centerZoom` (wide desktop) instruction. Discriminated on `mode`.
 */
export type OverviewFraming =
  | OverviewFramingFitBounds
  | OverviewFramingCenterZoom;

/**
 * Decides how to frame the OVERVIEW state for a given viewport, PURELY (no
 * Mapbox GL JS import, no camera side effects) so it stays unit-testable without
 * WebGL.
 *
 * - NARROW / portrait-ish / mobile (aspect ≤ {@link OVERVIEW_ASPECT_THRESHOLD}
 *   OR width < {@link OVERVIEW_DESKTOP_MIN_WIDTH}) → `fitBounds` on
 *   {@link OVERVIEW_BOUNDS} with {@link overviewFitOptions}. On a tall viewport
 *   this already frames the NCR well, so the proven Milestone 1 behavior is
 *   preserved.
 * - WIDE DESKTOP (aspect > threshold AND width ≥ desktop min) → a fixed
 *   `centerZoom` on {@link OVERVIEW_DESKTOP_CENTER} (the reference Metro Manila
 *   center, inside the NCR) at {@link OVERVIEW_DESKTOP_ZOOM} (~11), clamped
 *   defensively into the style bounds `[STYLE_MIN_ZOOM, STYLE_MAX_ZOOM]`. This
 *   is a TUNED product framing: the NCR fills MOST of the screen and is
 *   dominant; surrounding provinces appear only as peripheral context.
 *   Full-extent visibility is intentionally NOT guaranteed — outer NCR edges may
 *   sit near or slightly outside the viewport (see module header). No maxBounds
 *   is emitted so the basemap is never hard-clipped (Req 1.6).
 *
 * A degenerate viewport (zero/negative width or height) falls back to the
 * fitBounds branch so callers measuring an unlaid-out container behave safely.
 *
 * @param viewport - `{ width, height }` of the map container in CSS pixels.
 * @returns An {@link OverviewFraming} decision; `duration` is always within the
 *   1000ms App_State-transition budget (Req 10.4).
 */
export function computeOverviewFraming(viewport: {
  width: number;
  height: number;
}): OverviewFraming {
  const { width, height } = viewport;
  const fitBoundsFraming: OverviewFramingFitBounds = {
    mode: 'fitBounds',
    bounds: OVERVIEW_BOUNDS,
    padding: OVERVIEW_FIT_PADDING,
    duration: OVERVIEW_FIT_DURATION_MS,
  };

  // Degenerate/unlaid-out container: keep the safe fitBounds path.
  if (width <= 0 || height <= 0) return fitBoundsFraming;

  const aspect = width / height;
  const isWideDesktop =
    aspect > OVERVIEW_ASPECT_THRESHOLD && width >= OVERVIEW_DESKTOP_MIN_WIDTH;

  if (!isWideDesktop) return fitBoundsFraming;

  // Wide desktop (product framing): a TUNED center+zoom so the NCR reads large,
  // close, and dominant — matching the reference framing — rather than the old
  // min-of-both-fits full-bounds computation (which made the NCR too small).
  // The zoom is clamped defensively into the style bounds; it is already 11,
  // inside both the product range and [STYLE_MIN_ZOOM, STYLE_MAX_ZOOM].
  // Full-extent containment is intentionally NOT guaranteed (outer NCR edges may
  // fall near or just outside the viewport). See module header.
  const desktopZoom = Math.min(
    STYLE_MAX_ZOOM,
    Math.max(STYLE_MIN_ZOOM, OVERVIEW_DESKTOP_ZOOM),
  );
  return {
    mode: 'centerZoom',
    center: OVERVIEW_DESKTOP_CENTER,
    zoom: desktopZoom,
    duration: OVERVIEW_FIT_DURATION_MS,
  };
}
