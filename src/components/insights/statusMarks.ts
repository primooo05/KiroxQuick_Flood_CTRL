// src/components/insights/statusMarks.ts
//
// Pure, non-color status markers (glyphs) for current-risk levels and
// historical classes, so risk is NEVER conveyed by color alone (accessibility).
// Text labels come from riskLabels.ts; these add a shape/icon cue.

import type { CurrentRiskLevel } from '../../types/risk';
import type { HistoricalRiskClass } from '../../data/historical/ncrHistoricalFloodRisk';

/** A short glyph marker per current-risk level (shape cue, not color). */
export function currentRiskMark(level: CurrentRiskLevel): string {
  switch (level) {
    case 'CONFIRMED_NOT_PASSABLE':
      return '⛔'; // closure — distinct from reported flooding
    case 'REPORTED_FLOODING':
      return '◆'; // community-reported active flooding
    case 'LIKELY_FLOODING':
      return '▲';
    case 'HIGH':
      return '▲';
    case 'ELEVATED':
      return '△';
    case 'LOW':
      return '●';
    case 'STALE':
      return '⚠';
    case 'UNKNOWN':
    default:
      return '—';
  }
}

/** A short glyph marker per historical susceptibility class. */
export function historicalMark(cls: HistoricalRiskClass): string {
  switch (cls) {
    case 'High':
      return '▲';
    case 'Moderate':
      return '△';
    case 'Low':
      return '●';
    case 'Unknown':
    default:
      return '—';
  }
}

/** Plain-language one-liners for the info tooltips (no jargon). */
export const TOOLTIP_TEXT = {
  currentRisk:
    'Current flood risk is a near-real-time estimate from model-based rainfall and any recent reports or confirmed closures. It is not an official warning.',
  historical:
    'Historical flood susceptibility shows modeled flood exposure from Project NOAH / Phil-LiDAR data. It does not mean this area is flooding right now.',
  returnPeriod:
    'A return period is a modeled flood scenario, not a prediction that flooding will occur exactly once within that period.',
  communityReport:
    'Community reports are unverified reports from people in the area. They are not official confirmations.',
  confirmedClosure:
    'A confirmed closure is set only from an official or authorized source. It is treated as authoritative.',
} as const;
