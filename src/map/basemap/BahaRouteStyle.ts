// src/map/basemap/BahaRouteStyle.ts

/**
 * The BahaRoute basemap style provider (Group 2: Mapbox GL JS engine swap).
 *
 * Following the approved architecture change, the BahaRoute basemap is no longer
 * a hand-authored MapTiler/OpenMapTiles vector style. Instead it points the
 * mapbox-gl `Map` at a STOCK MAPBOX STYLE URL, and the Mapbox access token is
 * applied to the map at construction time (see MapManager.defaultMapFactory) —
 * NEVER hardcoded here (Req 17.1, 17.2). This module therefore carries no token
 * and no provider secrets; it only names the stock style to load.
 *
 * CHOSEN STYLE — `mapbox://styles/mapbox/standard` (3D view):
 *   Mapbox Standard ships 3D buildings and landmarks, which the flat
 *   `light-v11` style could not provide. It is configured with the `faded`
 *   theme so the basemap stays muted and the reserved saturated flood overlays
 *   (red/orange/yellow susceptibility + flood-state colors from
 *   {@link ./colorTokens}) remain the dominant visual concern (design → quiet
 *   basemap intent). 3D objects start HIDDEN so the default view is the same
 *   flat 2D overview as before; the 2D/3D toggle turns them on.
 *
 * The base/flood color-token discipline (base features ≤ 30% saturation,
 * reserved flood tokens > 30%) now lives entirely in {@link ./colorTokens} and
 * is asserted in `colorTokens.test.ts`; the flood layers apply the reserved
 * tokens over this stock basemap.
 */

/** Style-level zoom bounds for the BahaRoute basemap. */
export const STYLE_MIN_ZOOM = 9;
export const STYLE_MAX_ZOOM = 20;

/**
 * The stock Mapbox style URL used for the BahaRoute basemap. A `mapbox://`
 * style reference resolved by mapbox-gl using the access token supplied at map
 * construction. See the module doc comment for why Standard was chosen.
 */
export const BAHAROUTE_MAPBOX_STYLE_URL = 'mapbox://styles/mapbox/standard';

/**
 * The import id Mapbox assigns to the Standard basemap when the map is loaded
 * from its style URL. Used as the target of `setConfigProperty`.
 */
export const STANDARD_BASEMAP_IMPORT_ID = 'basemap';

/**
 * Mapbox Standard configuration applied at construction: muted `faded` theme,
 * `day` lighting, and 3D objects hidden until the user switches to 3D.
 *
 * NCR-ONLY PRESENTATION: BahaRoute is scoped strictly to Metro Manila, and the
 * Standard basemap's place labels render in a top slot ABOVE our opaque
 * outside-NCR mask — so surrounding settlements (Antipolo City, Bacoor, Imus,
 * San Pedro, Marilao, Bulakan, Tanay, Binangonan, …) would otherwise still
 * float over the masked area. We therefore turn OFF the basemap's
 * settlement/POI/transit labels via the Standard style config. BahaRoute's own
 * dedicated 17-LGU label layer provides all Metro Manila orientation instead.
 *
 * We deliberately KEEP `showRoadLabels: true` so roads, road numbers, and local
 * streets stay legible, and we do NOT touch water/coastline (those are not
 * label categories and remain visible for orientation).
 */
export const BAHAROUTE_STANDARD_CONFIG = {
  theme: 'faded',
  lightPreset: 'day',
  show3dObjects: false,
  // Hide basemap settlement/POI/transit labels (they introduce non-NCR places
  // over the mask). Keep road labels so navigation context stays.
  showPlaceLabels: false,
  showPointOfInterestLabels: false,
  showTransitLabels: false,
  showRoadLabels: true,
} as const;

/**
 * Returns the stock Mapbox style URL for the BahaRoute basemap. Exposed as a
 * function so callers (MapManager) depend on a stable accessor rather than the
 * bare constant, keeping room to vary the style later without touching call
 * sites. The token is applied separately at map construction (Req 17.1, 17.2).
 *
 * @returns The `mapbox://styles/...` style URL.
 */
export function bahaRouteStyleUrl(): string {
  return BAHAROUTE_MAPBOX_STYLE_URL;
}
