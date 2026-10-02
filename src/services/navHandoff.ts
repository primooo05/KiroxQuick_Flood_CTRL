// src/services/navHandoff.ts
//
// OPTIONAL external navigation handoff. BahaRoute's own Driver Mode remains the
// primary, flood-aware way to start a trip; this is a convenience escape hatch
// that opens the SAME origin/destination in a third-party maps app for users
// who prefer live traffic/turn-by-turn there.
//
// These are deep links only — BahaRoute sends no project data, no secrets, and
// no flood model to the third party; it just hands off two coordinates and the
// travel mode. The third-party app makes its OWN routing decisions and knows
// NOTHING about BahaRoute's flood risk, so the caller must keep the flood
// context on the BahaRoute side (see RouteComparePanel). We never imply the
// external route is "safe".

import type { TravelMode } from './directions';

/** A supported external navigation provider. */
export type NavProvider = 'google' | 'waze' | 'apple';

/** A ready-to-open handoff link for one provider. */
export interface NavHandoffLink {
  readonly provider: NavProvider;
  readonly label: string;
  readonly url: string;
}

/** A `[lng, lat]` coordinate (BahaRoute's internal order). */
export type LngLatTuple = readonly [number, number];

/** Google Maps `travelmode` values keyed by BahaRoute's TravelMode. */
const GOOGLE_MODE: Record<TravelMode, string> = {
  drive: 'driving',
  bike: 'bicycling',
  walk: 'walking',
};

/** Apple Maps `dirflg` values; Apple has no cycling flag, so bike omits it. */
const APPLE_FLAG: Partial<Record<TravelMode, string>> = {
  drive: 'd',
  walk: 'w',
};

function toLatLng([lng, lat]: LngLatTuple): string {
  return `${lat},${lng}`;
}

/**
 * Builds external navigation deep links for an origin/destination pair.
 *
 * Providers:
 *  - Google Maps: universal `/maps/dir/` URL with `travelmode`.
 *  - Waze: driving-oriented; always to the destination (Waze ignores custom
 *    origins and non-driving modes), so it is OMITTED for non-drive modes.
 *  - Apple Maps: `maps.apple.com` with a drive/walk flag (no cycling flag).
 *
 * Coordinates are converted from BahaRoute's `[lng, lat]` to each provider's
 * `lat,lng` convention. Returns only the providers that make sense for `mode`.
 */
export function buildNavHandoffLinks(
  origin: LngLatTuple,
  destination: LngLatTuple,
  mode: TravelMode = 'drive',
): readonly NavHandoffLink[] {
  const o = toLatLng(origin);
  const d = toLatLng(destination);
  const links: NavHandoffLink[] = [];

  links.push({
    provider: 'google',
    label: 'Google Maps',
    url:
      `https://www.google.com/maps/dir/?api=1` +
      `&origin=${o}&destination=${d}&travelmode=${GOOGLE_MODE[mode]}`,
  });

  // Waze is driving-first and routes from the user's live location to the
  // destination; only offer it for drive mode to avoid misrepresenting it.
  if (mode === 'drive') {
    links.push({
      provider: 'waze',
      label: 'Waze',
      url: `https://waze.com/ul?ll=${d}&navigate=yes`,
    });
  }

  const appleFlag = APPLE_FLAG[mode];
  if (appleFlag) {
    links.push({
      provider: 'apple',
      label: 'Apple Maps',
      url: `https://maps.apple.com/?saddr=${o}&daddr=${d}&dirflg=${appleFlag}`,
    });
  }

  return links;
}
