// src/map/metroManilaExtent.ts

/**
 * The predefined default geographic bounding box that frames the NCR
 * (Metro_Manila_Extent). The map initializes framed on this extent so the
 * initial center is inside the NCR and the default view is never framed on
 * areas outside Metro Manila (Req 1.2, 1.3).
 *
 * The box approximately covers the 17 NCR jurisdictions (Caloocan, Las Piñas,
 * Makati, Malabon, Mandaluyong, Manila, Marikina, Muntinlupa, Navotas,
 * Parañaque, Pasay, Pasig, Pateros, Quezon City, San Juan, Taguig, and
 * Valenzuela). Coordinates are `[longitude, latitude]` pairs in WGS84 degrees,
 * expressed as a Mapbox GL JS `LngLatBounds`-compatible `[[west, south], [east,
 * north]]` tuple.
 *
 * These are intentionally approximate framing bounds, not authoritative
 * administrative boundaries.
 */

/**
 * West/east longitudes and south/north latitudes of the NCR framing box. These
 * fully contain the real 17-LGU geometry (which spans ~lat 14.352–14.785, ~lng
 * 120.907–121.135) with a small margin, so framing on this box never clips the
 * northern (Valenzuela/Caloocan) or southern (Muntinlupa) edge of the NCR.
 */
export const METRO_MANILA_BOUNDS = {
  /** Western longitude edge (Manila Bay side). */
  west: 120.9,
  /** Southern latitude edge (Muntinlupa side; geometry reaches ~14.352). */
  south: 14.34,
  /** Eastern longitude edge (Marikina / Pasig side). */
  east: 121.15,
  /** Northern latitude edge (Valenzuela / Caloocan side; geometry ~14.785). */
  north: 14.80,
} as const;

/**
 * The NCR default extent as a Mapbox GL JS `LngLatBounds`-compatible tuple:
 * `[[west, south], [east, north]]` with each corner a `[lng, lat]` pair
 * (Req 1.2, 1.3). Pass directly to `map.fitBounds(...)` or the `bounds` map
 * option.
 */
export const METRO_MANILA_EXTENT: [[number, number], [number, number]] = [
  [METRO_MANILA_BOUNDS.west, METRO_MANILA_BOUNDS.south],
  [METRO_MANILA_BOUNDS.east, METRO_MANILA_BOUNDS.north],
];

/**
 * Camera `maxBounds` for the NCR-only presentation: the framing box PADDED so
 * users cannot pan far into the surrounding provinces, yet the edge LGUs
 * (Valenzuela/Navotas to the north, Muntinlupa to the south, Las Piñas to the
 * west, Marikina/Pasig to the east) stay comfortably inspectable — the padding
 * leaves breathing room beyond every NCR edge so those LGUs never get pinned to
 * the viewport border. `[[west, south], [east, north]]`, Mapbox-compatible.
 */
export const METRO_MANILA_MAX_BOUNDS: [[number, number], [number, number]] = [
  [METRO_MANILA_BOUNDS.west - 0.14, METRO_MANILA_BOUNDS.south - 0.16],
  [METRO_MANILA_BOUNDS.east + 0.14, METRO_MANILA_BOUNDS.north + 0.14],
];

/**
 * Wider camera `maxBounds` for the "Show nearby areas" presentation mode: NCR
 * plus a band of the surrounding provinces (parts of Bulacan to the north,
 * Rizal to the east, Cavite/Laguna to the south) for orientation only. Still
 * bounded so the user cannot roam across the whole country — nearby areas are
 * VISUAL CONTEXT and never imply operational coverage. `[[west, south], [east,
 * north]]`, Mapbox-compatible.
 */
export const METRO_MANILA_NEARBY_MAX_BOUNDS: [[number, number], [number, number]] = [
  [METRO_MANILA_BOUNDS.west - 0.55, METRO_MANILA_BOUNDS.south - 0.55],
  [METRO_MANILA_BOUNDS.east + 0.55, METRO_MANILA_BOUNDS.north + 0.5],
];

/**
 * The geographic center of {@link METRO_MANILA_EXTENT} as a `[lng, lat]` pair.
 * Guaranteed to lie inside the extent, so a map framed on the extent has its
 * center inside the NCR (Req 1.2).
 */
export const METRO_MANILA_CENTER: [number, number] = [
  (METRO_MANILA_BOUNDS.west + METRO_MANILA_BOUNDS.east) / 2,
  (METRO_MANILA_BOUNDS.south + METRO_MANILA_BOUNDS.north) / 2,
];

/**
 * Returns true iff the given `[lng, lat]` point lies within (inclusive of the
 * edges) the Metro_Manila_Extent. Used to check whether a detected location is
 * inside the NCR (Req 6.6) and to assert center-in-NCR framing (Req 1.2).
 *
 * @param lng - Longitude in WGS84 degrees.
 * @param lat - Latitude in WGS84 degrees.
 */
export function isWithinMetroManila(lng: number, lat: number): boolean {
  return (
    lng >= METRO_MANILA_BOUNDS.west &&
    lng <= METRO_MANILA_BOUNDS.east &&
    lat >= METRO_MANILA_BOUNDS.south &&
    lat <= METRO_MANILA_BOUNDS.north
  );
}
