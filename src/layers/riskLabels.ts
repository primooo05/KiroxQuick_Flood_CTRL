// src/layers/riskLabels.ts
//
// Pure display-label helpers for the current-risk vocabulary and rainfall.
// Commuter-facing language (Req 13): plain words, no GIS jargon, no banned
// safety terms ("safe"/"clear"/"no risk").

import type {
  CurrentRiskLevel,
  DataFreshness,
  RainfallBand,
  RainfallTrend,
  RiskConfidence,
} from '../types/risk';

/** Approved commuter-facing label per current-risk level. */
const CURRENT_RISK_LABELS: Record<CurrentRiskLevel, string> = {
  UNKNOWN: 'Unavailable',
  STALE: 'Data stale',
  LOW: 'Low',
  ELEVATED: 'Elevated',
  HIGH: 'High',
  LIKELY_FLOODING: 'Likely Flooding',
  REPORTED_FLOODING: 'Reported Flooding',
  CONFIRMED_NOT_PASSABLE: 'Confirmed Closure',
} as const;

/** Human label for a current-risk level. */
export function currentRiskLabel(level: CurrentRiskLevel): string {
  return CURRENT_RISK_LABELS[level];
}

/** Age (seconds) beyond which live data is considered STALE (freshness window). */
export const FRESHNESS_STALE_SECONDS = 12 * 60; // 12 min
/** Age (seconds) within which data reads as "live" (vs merely "recent"). */
export const FRESHNESS_LIVE_SECONDS = 6 * 60; // 6 min

/**
 * Derives a freshness bucket from the last successful update time. `null`
 * lastUpdated → `unavailable` (never loaded).
 */
export function dataFreshnessFor(
  lastUpdated: number | null,
  now: number = Math.floor(Date.now() / 1000),
): DataFreshness {
  if (lastUpdated === null || !Number.isFinite(lastUpdated)) return 'unavailable';
  const age = Math.max(0, now - lastUpdated);
  if (age <= FRESHNESS_LIVE_SECONDS) return 'live';
  if (age <= FRESHNESS_STALE_SECONDS) return 'recent';
  return 'stale';
}

/** Human label for a confidence level. */
export function confidenceLabel(confidence: RiskConfidence): string {
  switch (confidence) {
    case 'verified':
      return 'Verified';
    case 'high':
      return 'High';
    case 'medium':
      return 'Medium';
    case 'low':
      return 'Low';
    case 'none':
    default:
      return 'Unavailable';
  }
}

/** Human label for a rainfall trend. */
export function rainfallTrendLabel(trend: RainfallTrend): string {
  switch (trend) {
    case 'rising':
      return 'Rising';
    case 'falling':
      return 'Easing';
    case 'steady':
      return 'Steady';
    case 'unknown':
    default:
      return 'Unknown';
  }
}

/** Human label for a rainfall band. */
export function rainfallBandLabel(band: RainfallBand): string {
  switch (band) {
    case 'none':
      return 'No significant rain';
    case 'light':
      return 'Light rain';
    case 'moderate':
      return 'Moderate rain';
    case 'heavy':
      return 'Heavy rain';
    case 'intense':
      return 'Intense rain';
  }
}

/**
 * Formats an estimated rainfall rate for display, clearly a rate. Returns
 * "Unavailable" when the value is missing so nothing is fabricated.
 */
export function formatRainfallRate(mmHr: number | null): string {
  if (mmHr === null || !Number.isFinite(mmHr)) return 'Unavailable';
  if (mmHr <= 0) return '0 mm/hr';
  return `${mmHr.toFixed(1)} mm/hr`;
}

/**
 * Formats an epoch-seconds timestamp as a relative "updated X ago" string. Used
 * for the last-updated line so staleness is obvious. Returns "Never" for null.
 */
export function formatRelativeTime(
  epochSeconds: number | null,
  now: number = Math.floor(Date.now() / 1000),
): string {
  if (epochSeconds === null || !Number.isFinite(epochSeconds)) return 'Never';
  const delta = Math.max(0, now - epochSeconds);
  if (delta < 60) return 'Just now';
  const minutes = Math.floor(delta / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
