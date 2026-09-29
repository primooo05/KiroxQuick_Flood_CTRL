// src/services/ncrPlaces.ts
//
// A LOCAL, NCR-only place index powering BahaRoute's route search. There is no
// external geocoding backend for the hackathon MVP; instead we search a curated
// set of Metro Manila places — the 17 LGUs (reusing their label points from the
// city-context data) plus well-known landmarks/terminals — so the Search step
// is fully offline and demo-reliable.
//
// Coverage is strictly NCR: `isWithinNCR` gates any coordinate (search results,
// "select on map" taps, current location) so out-of-scope origins/destinations
// are rejected with a clear message rather than routed.

import { ncrCityInfos } from '../data/geojson/ncrCityContext';
import { isWithinMetroManila } from '../map/metroManilaExtent';

/** A searchable Metro Manila place. */
export interface NcrPlace {
  /** Stable id. */
  readonly id: string;
  /** Display name, e.g. "SM Mall of Asia". */
  readonly name: string;
  /** Optional secondary line, e.g. the city/area. */
  readonly area?: string;
  /** `[lng, lat]`. */
  readonly coord: readonly [number, number];
  /** 'lgu' = a city/municipality centroid; 'landmark' = a specific place. */
  readonly kind: 'lgu' | 'landmark';
}

/**
 * Curated Metro Manila landmarks/terminals. PITX and SM Mall of Asia use the
 * exact endpoints of the bundled PITX→MOA demo route so a search for that pair
 * produces the real drivable route. Coordinates are approximate public
 * locations, all within NCR.
 */
const LANDMARKS: readonly NcrPlace[] = [
  {
    id: 'lm-pitx',
    name: 'PITX (Parañaque Integrated Terminal)',
    area: 'Parañaque',
    coord: [120.993589, 14.50956],
    kind: 'landmark',
  },
  {
    id: 'lm-moa',
    name: 'SM Mall of Asia',
    area: 'Pasay',
    coord: [120.983124, 14.535229],
    kind: 'landmark',
  },
  { id: 'lm-naia', name: 'NAIA Airport', area: 'Pasay / Parañaque', coord: [121.0198, 14.5086], kind: 'landmark' },
  { id: 'lm-cubao', name: 'Cubao (Araneta Center)', area: 'Quezon City', coord: [121.0537, 14.6197], kind: 'landmark' },
  { id: 'lm-ortigas', name: 'Ortigas Center', area: 'Pasig / Mandaluyong', coord: [121.0585, 14.5866], kind: 'landmark' },
  { id: 'lm-makati-cbd', name: 'Makati CBD (Ayala)', area: 'Makati', coord: [121.0244, 14.5547], kind: 'landmark' },
  { id: 'lm-bgc', name: 'Bonifacio Global City (BGC)', area: 'Taguig', coord: [121.0509, 14.5511], kind: 'landmark' },
  { id: 'lm-quiapo', name: 'Quiapo', area: 'Manila', coord: [120.9835, 14.5986], kind: 'landmark' },
  { id: 'lm-intramuros', name: 'Intramuros', area: 'Manila', coord: [120.9752, 14.5906], kind: 'landmark' },
  { id: 'lm-up-diliman', name: 'UP Diliman', area: 'Quezon City', coord: [121.0685, 14.6537], kind: 'landmark' },
  { id: 'lm-marikina-sports', name: 'Marikina Sports Center', area: 'Marikina', coord: [121.0966, 14.6349], kind: 'landmark' },
  { id: 'lm-alabang', name: 'Alabang Town Center', area: 'Muntinlupa', coord: [121.0175, 14.4231], kind: 'landmark' },
];

/** The 17 LGUs as searchable places (from their city-context label points). */
const LGU_PLACES: readonly NcrPlace[] = ncrCityInfos.map((c) => ({
  id: `lgu-${c.id}`,
  name: c.name,
  area: 'Metro Manila / NCR',
  coord: c.labelPoint,
  kind: 'lgu' as const,
}));

/** The full NCR place index (landmarks first, then LGUs). */
export const NCR_PLACES: readonly NcrPlace[] = [...LANDMARKS, ...LGU_PLACES];

/** Normalizes a string for case/diacritic-insensitive matching. */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Searches the NCR place index for a query. Matching is case/diacritic
 * insensitive and prefix-preferring (prefix matches rank above substring
 * matches; landmarks rank above LGUs on ties). Returns at most `limit` results.
 * An empty query returns a small default set (landmarks) so the picker is
 * useful before typing.
 */
export function searchPlaces(query: string, limit = 8): NcrPlace[] {
  const q = normalize(query);
  if (q === '') return NCR_PLACES.slice(0, limit);

  const scored: Array<{ place: NcrPlace; score: number }> = [];
  for (const place of NCR_PLACES) {
    const name = normalize(place.name);
    const area = place.area ? normalize(place.area) : '';
    let score = -1;
    if (name.startsWith(q)) score = 3;
    else if (name.includes(q)) score = 2;
    else if (area.includes(q)) score = 1;
    if (score < 0) continue;
    // Landmarks edge out LGUs on equal textual score.
    if (place.kind === 'landmark') score += 0.1;
    scored.push({ place, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.place);
}

/**
 * True when a coordinate is within BahaRoute's supported coverage (NCR). Used
 * to reject out-of-scope origins/destinations from "select on map", current
 * location, or search before attempting to route.
 */
export function isWithinNCR(lng: number, lat: number): boolean {
  return isWithinMetroManila(lng, lat);
}

/** The user-facing message shown when a chosen point is outside NCR coverage. */
export const UNSUPPORTED_AREA_MESSAGE =
  'BahaRoute covers Metro Manila / NCR only. Choose an origin and destination within the National Capital Region.';
