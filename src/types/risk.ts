// src/types/risk.ts
//
// Types for the barangay-level CURRENT flood-risk model. These are kept
// deliberately SEPARATE from `src/types/flood.ts` susceptibility types:
// `baselineSusceptibility` (historical/modeled exposure) and `currentRisk`
// (near-real-time estimate) are distinct concepts and must never be conflated
// (see docs/FLOOD_SEMANTICS.md).

import type { SusceptibilityLevel } from './flood';

/**
 * The current estimated flood-risk state for a barangay, in increasing order of
 * concern. This is a CURRENT-CONDITION estimate, NOT historical susceptibility.
 *
 * - `UNKNOWN` — current weather/risk data has NEVER loaded successfully. Neutral
 *   styling; shown as "Current flood-risk data unavailable". NEVER shown as LOW.
 * - `STALE` — previously successful data exists but is older than the accepted
 *   freshness window. Muted styling; the last successful update time is shown.
 * - `LOW` — little/no significant current rain, no active flood evidence.
 * - `ELEVATED` — rain increasing and/or the barangay is historically flood-prone.
 * - `HIGH` — heavy rainfall combined with susceptibility/other indicators.
 * - `LIKELY_FLOODING` — very heavy/persistent rainfall with strong indicators.
 * - `REPORTED_FLOODING` — one or more recent valid community reports of active
 *   flooding. Escalated by reports, NOT by rainfall alone.
 * - `CONFIRMED_NOT_PASSABLE` — set ONLY through official/admin confirmation.
 *   Rainfall and community reports must NEVER produce this state automatically.
 *
 * `UNKNOWN`/`STALE` are DATA-QUALITY states, not severity levels: the classified
 * levels (LOW…CONFIRMED_NOT_PASSABLE) are only used when current data is valid
 * enough to support them.
 */
export type CurrentRiskLevel =
  | 'UNKNOWN'
  | 'STALE'
  | 'LOW'
  | 'ELEVATED'
  | 'HIGH'
  | 'LIKELY_FLOODING'
  | 'REPORTED_FLOODING'
  | 'CONFIRMED_NOT_PASSABLE';

/**
 * The classified (severity-bearing) risk levels only, lowest → highest. Excludes
 * the data-quality states UNKNOWN/STALE.
 */
export const RISK_LEVELS_ASCENDING: readonly CurrentRiskLevel[] = [
  'LOW',
  'ELEVATED',
  'HIGH',
  'LIKELY_FLOODING',
  'REPORTED_FLOODING',
  'CONFIRMED_NOT_PASSABLE',
];

/** True when a level is a data-quality state rather than a classified severity. */
export function isDataQualityState(level: CurrentRiskLevel): boolean {
  return level === 'UNKNOWN' || level === 'STALE';
}

/**
 * Numeric severity rank (higher = more severe) for a risk level. Data-quality
 * states (UNKNOWN/STALE) rank -1 — they are not part of the severity ladder and
 * must never be treated as LOW or above.
 */
export function riskSeverity(level: CurrentRiskLevel): number {
  return RISK_LEVELS_ASCENDING.indexOf(level);
}

/**
 * Risk confidence, deterministic from which signals were available:
 * - `low` — weather/model data only.
 * - `medium` — weather + historical susceptibility.
 * - `high` — weather + susceptibility + recent community reports.
 * - `verified` — official/admin confirmation exists.
 * - `none` — no usable current data (UNKNOWN/STALE).
 */
export type RiskConfidence = 'none' | 'low' | 'medium' | 'high' | 'verified';

/** Data freshness bucket derived from the age of the last successful update. */
export type DataFreshness = 'live' | 'recent' | 'stale' | 'unavailable';

/**
 * Short-term timeline step for the NOW / +30 MIN / +1 HR control. Only steps the
 * data source can reasonably support are offered; +30 MIN uses interpolated
 * 15-min data and is labeled estimated.
 */
export type TimelineStep = 'now' | 'plus30' | 'plus60';

/**
 * A rainfall sample for a single coordinate, as returned (and normalized) from
 * the weather service. All values are ESTIMATED / model-based (Open-Meteo),
 * never labeled as official PAGASA observations. Millimetres per hour.
 */
export interface RainfallSample {
  /** Current precipitation rate, mm/hr. `null` when unavailable. */
  readonly nowMmHr: number | null;
  /**
   * Short-term forecast precipitation rate ~30 min ahead, mm/hr. `null` when
   * the source does not provide a usable near-term value.
   */
  readonly next30MmHr: number | null;
  /**
   * Forecast precipitation rate ~1 hour ahead, mm/hr. `null` when unavailable.
   */
  readonly next60MmHr: number | null;
  /**
   * Recent accumulated rainfall over the trailing window (e.g. last 3h), mm.
   * `null` when unavailable. Used as a persistence/saturation indicator.
   */
  readonly recentAccumMm: number | null;
  /** Epoch seconds when this sample was fetched. */
  readonly sampledAt: number;
}

/** Rainfall trend derived from now vs. the near-term forecast. */
export type RainfallTrend = 'rising' | 'steady' | 'falling' | 'unknown';

/** Coarse rainfall severity band (research reference), one INPUT to risk. */
export type RainfallBand = 'none' | 'light' | 'moderate' | 'heavy' | 'intense';

/**
 * The official/admin confirmation for a barangay. This is the ONLY thing that
 * can set `CONFIRMED_NOT_PASSABLE`. For the MVP it is fixture/demo-backed and
 * clearly labeled as manual/demo confirmation.
 */
export interface OfficialStatus {
  /** Barangay PSGC this confirmation applies to. */
  readonly psgc: string;
  /** `true` when officially confirmed not passable. */
  readonly notPassable: boolean;
  /** The confirming authority / source label. */
  readonly source: string;
  /** Epoch seconds of the confirmation. */
  readonly confirmedAt: number;
  /** Optional free-text note. */
  readonly note?: string;
}

/**
 * The evidence used to compute a barangay's current risk. Every input is
 * optional/nullable so the model degrades gracefully when data is missing.
 */
export interface RiskInputs {
  /** Estimated rainfall for the barangay centroid (or null when unavailable). */
  readonly rainfall: RainfallSample | null;
  /**
   * Historical/modeled susceptibility for the barangay. A MODIFIER only — it
   * can nudge risk up a step but NEVER, on its own, produces HIGH or above.
   */
  readonly baselineSusceptibility: SusceptibilityLevel | null;
  /** Count of recent, non-expired community reports indicating flooding. */
  readonly recentReportCount: number;
  /**
   * The most severe recent community-report state for the barangay, if any.
   * Only RED/ORANGE (active flooding) escalate to REPORTED_FLOODING.
   */
  readonly reportState: 'RED' | 'ORANGE' | 'YELLOW' | null;
  /** Official confirmation, if present. The only path to NOT PASSABLE. */
  readonly official: OfficialStatus | null;
}

/**
 * The transparent per-signal explanation of an assessment ("Why this risk?").
 * Each entry is a short, factual bullet generated from the actual inputs the
 * engine used — never fabricated.
 */
export interface RiskSignal {
  /** Machine key, for testing/keys. */
  readonly key:
    | 'rainfall'
    | 'forecast'
    | 'susceptibility'
    | 'reports'
    | 'official'
    | 'noData';
  /** Commuter-facing bullet text. */
  readonly text: string;
}

/**
 * The computed current-risk assessment for a barangay. `currentRisk` and
 * `baselineSusceptibility` are surfaced side by side and never merged.
 */
export interface BarangayRiskAssessment {
  readonly psgc: string;
  /** The computed CURRENT risk level. */
  readonly currentRisk: CurrentRiskLevel;
  /** The historical baseline susceptibility (unchanged, for reference). */
  readonly baselineSusceptibility: SusceptibilityLevel | null;
  /** Rainfall band used as an input, for display/explanation. */
  readonly rainfallBand: RainfallBand;
  /** Rainfall trend for display. */
  readonly trend: RainfallTrend;
  /** Short human-readable reason (transparent model explanation). */
  readonly reason: string;
  /** Deterministic confidence from the signals used. */
  readonly confidence: RiskConfidence;
  /** Per-signal bullets explaining the level ("Why this risk?"). */
  readonly signals: readonly RiskSignal[];
  /** Epoch seconds this assessment was computed. */
  readonly assessedAt: number;
}
