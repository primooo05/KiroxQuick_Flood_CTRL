// src/map/basemap/colorTokens.ts

/**
 * Color tokens for the quiet BahaRoute basemap and the reserved flood palette.
 *
 * This module is the **canonical owner** of BahaRoute's color tokens. It is an
 * editable data asset — rendering logic lives elsewhere ({@link
 * ../BahaRouteStyle}, layer definitions) so appearance can change without
 * touching rendering code (Req 2.3).
 *
 * Two disjoint palettes are defined:
 *
 * - **Base feature tokens** ({@link BASE_COLOR_TOKENS}) — every base map feature
 *   (land/background, water, parks, buildings, roads, boundaries, labels) uses a
 *   muted, near-neutral color whose HSL **saturation is ≤ 30%** (Req 2.1).
 * - **Reserved tokens** ({@link RESERVED_COLOR_TOKENS}) — saturated colors
 *   (saturation **> 30%**) reserved exclusively for flood information layers
 *   (susceptibility fills, flood-state colors) and **never** applied to base map
 *   features (Req 2.2).
 *
 * Each token stores its color as hex and carries its HSL components so the
 * saturation invariant can be asserted directly (see `basemapStyle.test.ts`) and
 * so consumers can reason about the palette without re-parsing hex strings.
 *
 * Consumers:
 * - {@link ../BahaRouteStyle} uses ONLY base tokens for base features.
 * - `src/layers/visualMapping.ts` (Task 4.6) imports the reserved
 *   susceptibility color mapping ({@link SUSCEPTIBILITY_COLORS}).
 */

import type { FloodState, SusceptibilityLevel } from '../../types/flood';
import type { CurrentRiskLevel } from '../../types/risk';

/** HSL components for a color. Hue in degrees [0,360), saturation/lightness in %. */
export interface Hsl {
  /** Hue in degrees, `[0, 360)`. */
  readonly h: number;
  /** Saturation as a percentage, `[0, 100]`. */
  readonly s: number;
  /** Lightness as a percentage, `[0, 100]`. */
  readonly l: number;
}

/** A named color token: a hex value plus its HSL decomposition. */
export interface ColorToken {
  /** Stable machine name, used for iteration/debugging. */
  readonly name: string;
  /** `#rrggbb` hex color. */
  readonly hex: string;
  /** HSL decomposition of {@link hex}. */
  readonly hsl: Hsl;
}

/** The maximum HSL saturation (percent) permitted for a base map feature (Req 2.1). */
export const MAX_BASE_SATURATION = 30;

/**
 * Computes the HSL saturation (as a percentage `[0, 100]`) of a `#rrggbb` hex
 * color. Used by the unit check to assert base tokens are ≤ 30% and reserved
 * tokens are > 30%.
 *
 * @param hex - A 3- or 6-digit hex color, with or without a leading `#`.
 * @returns The saturation percentage. Throws on a malformed hex string.
 */
export function saturationOf(hex: string): number {
  return hexToHsl(hex).s;
}

/**
 * Converts a `#rrggbb` (or `#rgb`) hex color to its HSL components.
 *
 * @param hex - A 3- or 6-digit hex color, with or without a leading `#`.
 * @returns The HSL decomposition with `h` in degrees and `s`/`l` in percent.
 */
export function hexToHsl(hex: string): Hsl {
  const normalized = hex.replace(/^#/, '').trim();

  let r: number;
  let g: number;
  let b: number;
  if (normalized.length === 3) {
    r = parseInt(normalized[0] + normalized[0], 16);
    g = parseInt(normalized[1] + normalized[1], 16);
    b = parseInt(normalized[2] + normalized[2], 16);
  } else if (normalized.length === 6) {
    r = parseInt(normalized.slice(0, 2), 16);
    g = parseInt(normalized.slice(2, 4), 16);
    b = parseInt(normalized.slice(4, 6), 16);
  } else {
    throw new Error(`Invalid hex color: "${hex}"`);
  }

  if ([r, g, b].some((c) => Number.isNaN(c))) {
    throw new Error(`Invalid hex color: "${hex}"`);
  }

  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const delta = max - min;
  const l = (max + min) / 2;

  let s = 0;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
  }

  let h = 0;
  if (delta !== 0) {
    if (max === rf) {
      h = ((gf - bf) / delta) % 6;
    } else if (max === gf) {
      h = (bf - rf) / delta + 2;
    } else {
      h = (rf - gf) / delta + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s: s * 100, l: l * 100 };
}

/** Builds a {@link ColorToken} from a name and hex, decomposing HSL once. */
function token(name: string, hex: string): ColorToken {
  return { name, hex, hsl: hexToHsl(hex) };
}

// ---------------------------------------------------------------------------
// Base feature palette — muted, saturation ≤ 30% (Req 2.1).
// Near-neutral greys/beiges/desaturated blues. NEVER use a reserved color here.
// ---------------------------------------------------------------------------

/**
 * The muted base map palette. Every color here has HSL saturation ≤ 30%
 * ({@link MAX_BASE_SATURATION}) so the basemap reads as visually quiet and
 * flood layers stand out as the foreground concern (Req 2.1).
 */
export const BASE_COLORS = {
  /** Page/land background — warm near-neutral off-white. */
  background: token('background', '#f2f1ee'),
  /** Landmass fill, slightly distinct from the background. */
  land: token('land', '#eae8e3'),
  /** Water bodies — heavily desaturated blue-grey. */
  water: token('water', '#c3ccd2'),
  /** Parks / green space — muted, low-saturation sage. */
  park: token('park', '#d6dcd2'),
  /** Building footprints — light warm grey. */
  building: token('building', '#e2ded7'),
  /** Administrative / city boundary lines — mid neutral grey. */
  boundary: token('boundary', '#a7a29a'),

  /** Minor road casing/fill — light grey. */
  roadMinor: token('roadMinor', '#e7e4de'),
  /** Major road fill — slightly warmer/darker than minor. */
  roadMajor: token('roadMajor', '#ded9d0'),
  /** Expressway fill — muted desaturated tan, the most prominent road tier. */
  roadExpressway: token('roadExpressway', '#d8cdbb'),

  /** Primary place/city label text — low-contrast neutral grey (Req 3.4). */
  label: token('label', '#6f6a62'),
  /** Label halo/outline for legibility against the quiet basemap. */
  labelHalo: token('labelHalo', '#f5f4f1'),
} as const;

/**
 * A single flat list of every base feature token, so the saturation check can
 * iterate them (see `basemapStyle.test.ts`). Every entry MUST have
 * `hsl.s <= MAX_BASE_SATURATION`.
 */
export const BASE_COLOR_TOKENS: readonly ColorToken[] = Object.values(BASE_COLORS);

// ---------------------------------------------------------------------------
// Reserved flood palette — saturated, saturation > 30% (Req 2.2).
// Used ONLY by flood layers. NEVER applied to base map features.
// ---------------------------------------------------------------------------

/**
 * Susceptibility level → reserved translucent-friendly color (Req 2.2, 13.1;
 * design → Susceptibility classification → visual mapping). Imported by
 * `visualMapping.ts` (Task 4.6). Every color has saturation > 30%.
 */
export const SUSCEPTIBILITY_COLORS: Record<SusceptibilityLevel, ColorToken> = {
  /** High susceptibility → saturated red. */
  HIGH: token('susceptibilityHigh', '#d32f2f'),
  /** Moderate susceptibility → saturated orange. */
  MODERATE: token('susceptibilityModerate', '#f57c00'),
  /** Low susceptibility → saturated amber/yellow. */
  LOW: token('susceptibilityLow', '#fbc02d'),
} as const;

/**
 * Flood_State → reserved display color (Req 2.2, 13.4). GRAY intentionally sits
 * near-neutral but is grouped with the reserved palette because it is a flood
 * concern, not a base feature; it is never used to style base map features.
 * The colored states are all saturated (> 30%).
 */
export const FLOOD_STATE_COLORS: Record<FloodState, ColorToken> = {
  /** RED — Reported Flooding. */
  RED: token('floodStateRed', '#c62828'),
  /** ORANGE — Elevated Flood Exposure. */
  ORANGE: token('floodStateOrange', '#ef6c00'),
  /** YELLOW — Caution. */
  YELLOW: token('floodStateYellow', '#f9a825'),
  /** GREEN — Recently Reported Passable. */
  GREEN: token('floodStateGreen', '#2e7d32'),
  /** GRAY — Unknown (never "no risk"). Near-neutral; excluded from the >30% list. */
  GRAY: token('floodStateGray', '#9e9e9e'),
} as const;

/**
 * CurrentRiskLevel → reserved display color (Req 6, current barangay flood
 * risk). These are the CURRENT-CONDITION risk colors, distinct from the
 * historical SUSCEPTIBILITY_COLORS. They form an escalating ramp:
 *
 *   LOW               → near-neutral green-grey (current, low concern; NOT a
 *                       "safe" claim — GRAY/LOW absence of fill never means safe)
 *   ELEVATED          → amber/yellow
 *   HIGH              → orange
 *   LIKELY_FLOODING   → red
 *   REPORTED_FLOODING → deep red (community-reported active flooding)
 *   CONFIRMED_NOT_PASSABLE → dark maroon (official confirmation only)
 *
 * The colored levels are all saturated (> 30%); LOW is intentionally
 * near-neutral (a calm base state) and excluded from the >30% reserved list.
 */
export const CURRENT_RISK_COLORS: Record<CurrentRiskLevel, ColorToken> = {
  // Data-quality states: neutral greys, low saturation (excluded from the
  // reserved >30% list). These must never read as a severity level.
  UNKNOWN: token('currentRiskUnknown', '#b5b8bd'),
  STALE: token('currentRiskStale', '#9aa0a6'),
  // Classified severity ramp: muted green → yellow → orange → reds.
  LOW: token('currentRiskLow', '#4c9a6b'),
  ELEVATED: token('currentRiskElevated', '#f6c445'),
  HIGH: token('currentRiskHigh', '#ef8a3c'),
  LIKELY_FLOODING: token('currentRiskLikely', '#e0443e'),
  REPORTED_FLOODING: token('currentRiskReported', '#b71c1c'),
  CONFIRMED_NOT_PASSABLE: token('currentRiskNotPassable', '#7a0016'),
} as const;

/** The derived HISTORICAL flood-risk classes (distinct from CurrentRiskLevel). */
export type HistoricalRiskClassKey = 'Low' | 'Moderate' | 'High' | 'Unknown';

/**
 * HistoricalRiskClass → reserved display color. Intentionally a DIFFERENT hue
 * family from {@link CURRENT_RISK_COLORS} (which is a green→red current-severity
 * ramp) so the two layers never read as the same thing when both are enabled:
 * historical uses a cool INDIGO/VIOLET susceptibility ramp (a common convention
 * for modeled flood-hazard depth), with Unknown a neutral grey.
 *
 *   Low       → light indigo
 *   Moderate  → mid indigo
 *   High      → deep violet
 *   Unknown   → neutral grey (no coverage; never "safe")
 *
 * The colored classes are saturated (> 30%); Unknown is neutral and excluded
 * from the reserved >30% list.
 */
export const HISTORICAL_RISK_COLORS: Record<HistoricalRiskClassKey, ColorToken> = {
  Low: token('historicalLow', '#9fa8da'),
  Moderate: token('historicalModerate', '#5c6bc0'),
  High: token('historicalHigh', '#3f2b96'),
  Unknown: token('historicalUnknown', '#b5b8bd'),
} as const;

/**
 * A single flat list of the reserved (saturated) flood tokens, so the
 * disjointness / saturation check can iterate them. Every entry here MUST have
 * `hsl.s > MAX_BASE_SATURATION`.
 *
 * Note: the near-neutral GRAY flood-state color and the near-neutral current-
 * risk LOW color are intentionally excluded from this list because they are not
 * saturated; they are still reserved for flood use and never applied to base
 * features.
 */
export const RESERVED_COLOR_TOKENS: readonly ColorToken[] = [
  ...Object.values(SUSCEPTIBILITY_COLORS),
  FLOOD_STATE_COLORS.RED,
  FLOOD_STATE_COLORS.ORANGE,
  FLOOD_STATE_COLORS.YELLOW,
  FLOOD_STATE_COLORS.GREEN,
  CURRENT_RISK_COLORS.ELEVATED,
  CURRENT_RISK_COLORS.HIGH,
  CURRENT_RISK_COLORS.LIKELY_FLOODING,
  CURRENT_RISK_COLORS.REPORTED_FLOODING,
  CURRENT_RISK_COLORS.CONFIRMED_NOT_PASSABLE,
  HISTORICAL_RISK_COLORS.Low,
  HISTORICAL_RISK_COLORS.Moderate,
  HISTORICAL_RISK_COLORS.High,
];
