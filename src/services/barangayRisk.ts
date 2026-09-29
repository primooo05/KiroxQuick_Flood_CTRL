// src/services/barangayRisk.ts
//
// The TRANSPARENT MVP current-flood-risk model. Pure functions, no I/O, so the
// whole thing is trivially unit-testable and auditable.
//
// DESIGN RULES (enforced here and by tests, see docs/FLOOD_SEMANTICS.md):
//   1. `currentRisk` is computed SEPARATELY from `baselineSusceptibility`.
//      Historical susceptibility is a MODIFIER, never a permanent floor: a
//      HIGH-susceptibility barangay with no current rain and no evidence is
//      Current Risk = LOW (baseline shown separately as High).
//   2. Rainfall alone can reach at most LIKELY_FLOODING — never
//      CONFIRMED_NOT_PASSABLE.
//   3. Community reports (RED/ORANGE) can escalate to REPORTED_FLOODING, but
//      never to CONFIRMED_NOT_PASSABLE.
//   4. CONFIRMED_NOT_PASSABLE is reachable ONLY via official confirmation.
//   5. Missing data degrades gracefully (LOW / "unknown"), never crashes.

import type { SusceptibilityLevel } from '../types/flood';
import type {
  BarangayRiskAssessment,
  CurrentRiskLevel,
  RainfallBand,
  RainfallSample,
  RainfallTrend,
  RiskConfidence,
  RiskInputs,
  RiskSignal,
} from '../types/risk';

// ---------------------------------------------------------------------------
// Rainfall bands (research reference). Used ONLY as one input into risk — a
// band is NEVER equated to a passability verdict.
// ---------------------------------------------------------------------------

/** Lower bounds (mm/hr) for the reference rainfall bands. */
export const RAINFALL_BAND_THRESHOLDS = {
  /** Below this → effectively no significant rain. */
  light: 2.5,
  /** 7.5–15 mm/hr reference lower bound. */
  moderate: 7.5,
  /** 15–30 mm/hr reference lower bound. */
  heavy: 15,
  /** 30+ mm/hr reference lower bound. */
  intense: 30,
} as const;

/**
 * Classifies a rainfall rate (mm/hr) into a coarse band. `null`/negative →
 * `none`. This is a display + scoring INPUT, not a verdict.
 */
export function rainfallBand(mmHr: number | null): RainfallBand {
  if (mmHr === null || !Number.isFinite(mmHr) || mmHr <= 0) return 'none';
  if (mmHr < RAINFALL_BAND_THRESHOLDS.moderate) return 'light';
  if (mmHr < RAINFALL_BAND_THRESHOLDS.heavy) return 'moderate';
  if (mmHr < RAINFALL_BAND_THRESHOLDS.intense) return 'heavy';
  return 'intense';
}

/** Numeric rank for a rainfall band (0 = none … 4 = intense). */
function bandRank(band: RainfallBand): number {
  return (['none', 'light', 'moderate', 'heavy', 'intense'] as const).indexOf(
    band,
  );
}

/**
 * Derives a rainfall trend by comparing now vs. the ~30-min forecast. A small
 * hysteresis avoids flapping on tiny deltas. `unknown` when either side is
 * missing.
 */
export function rainfallTrend(sample: RainfallSample | null): RainfallTrend {
  if (!sample) return 'unknown';
  const now = sample.nowMmHr;
  const next = sample.next30MmHr;
  if (now === null || next === null) return 'unknown';
  const delta = next - now;
  const hysteresis = 0.5; // mm/hr
  if (delta > hysteresis) return 'rising';
  if (delta < -hysteresis) return 'falling';
  return 'steady';
}

// ---------------------------------------------------------------------------
// Susceptibility modifier
// ---------------------------------------------------------------------------

/**
 * How many steps the historical baseline may nudge the rainfall-derived risk.
 * HIGH baseline can add one step; MODERATE none-to-negligible; LOW none. The
 * modifier is intentionally weak so baseline never dominates current signal.
 */
function susceptibilityModifier(level: SusceptibilityLevel | null): number {
  if (level === 'HIGH') return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Rainfall-only risk (the weather contribution, capped at LIKELY_FLOODING)
// ---------------------------------------------------------------------------

/** The ordered rainfall-driven levels (rainfall can never exceed the last). */
const RAINFALL_DRIVEN_LEVELS: readonly CurrentRiskLevel[] = [
  'LOW',
  'ELEVATED',
  'HIGH',
  'LIKELY_FLOODING',
];

/**
 * Computes the rainfall-driven risk step (index into RAINFALL_DRIVEN_LEVELS)
 * from the sample, before the susceptibility modifier. Considers current rate,
 * near-term forecast, and recent accumulation (persistence).
 */
function rainfallRiskStep(sample: RainfallSample | null): number {
  if (!sample) return 0; // no data → LOW contribution
  const nowBand = rainfallBand(sample.nowMmHr);
  const nextBand = rainfallBand(sample.next30MmHr);

  // Base step from the current band: none→0, light→1(ELEVATED),
  // moderate→2(HIGH), heavy→2(HIGH), intense→3(LIKELY_FLOODING).
  let step: number;
  switch (nowBand) {
    case 'none':
      step = 0;
      break;
    case 'light':
      step = 1;
      break;
    case 'moderate':
    case 'heavy':
      step = 2;
      break;
    case 'intense':
      step = 3;
      break;
  }

  // Persistence: substantial recent accumulation with ongoing rain pushes one
  // step (very heavy/persistent → LIKELY_FLOODING).
  const accum = sample.recentAccumMm;
  if (accum !== null && accum >= 30 && step >= 2) {
    step = Math.max(step, 3);
  }

  // Rising forecast into a heavier band nudges up one step (but not from dry).
  if (step >= 1 && bandRank(nextBand) > bandRank(nowBand)) {
    step += 1;
  }

  return Math.min(step, RAINFALL_DRIVEN_LEVELS.length - 1);
}

// ---------------------------------------------------------------------------
// The combined model
// ---------------------------------------------------------------------------

function reasonFor(
  level: CurrentRiskLevel,
  band: RainfallBand,
  trend: RainfallTrend,
  inputs: RiskInputs,
): string {
  switch (level) {
    case 'CONFIRMED_NOT_PASSABLE':
      return `Officially confirmed not passable${
        inputs.official?.source ? ` by ${inputs.official.source}` : ''
      }.`;
    case 'REPORTED_FLOODING':
      return `${inputs.recentReportCount} recent community report${
        inputs.recentReportCount === 1 ? '' : 's'
      } of active flooding.`;
    case 'LIKELY_FLOODING':
      return `Very heavy or persistent estimated rainfall (${band}${
        trend === 'rising' ? ', rising' : ''
      }).`;
    case 'HIGH':
      return `Heavy estimated rainfall (${band})${
        inputs.baselineSusceptibility === 'HIGH'
          ? ' in a historically flood-prone area'
          : ''
      }.`;
    case 'ELEVATED':
      return inputs.baselineSusceptibility === 'HIGH' && band === 'none'
        ? 'Historically flood-prone; rain increasing.'
        : `Rain increasing (${band}).`;
    case 'LOW':
    default:
      return 'Little or no significant current rain and no active flood evidence.';
  }
}

/**
 * Deterministic confidence from which signals were actually available:
 *   official confirmation            → verified
 *   weather + susceptibility + reports → high
 *   weather + susceptibility          → medium
 *   weather only                      → low
 *   no usable current data            → none
 */
export function confidenceFor(inputs: RiskInputs): RiskConfidence {
  if (inputs.official?.notPassable) return 'verified';
  const hasWeather = inputs.rainfall?.nowMmHr !== null && inputs.rainfall !== null;
  if (!hasWeather) return 'none';
  const hasSusceptibility = inputs.baselineSusceptibility !== null;
  const hasReports = inputs.recentReportCount > 0 && inputs.reportState !== null;
  if (hasSusceptibility && hasReports) return 'high';
  if (hasSusceptibility) return 'medium';
  return 'low';
}

/**
 * Builds the transparent "Why this risk?" bullets from the ACTUAL signals used.
 * Only includes bullets for signals that are actually present — never fabricates.
 */
export function signalsFor(
  band: RainfallBand,
  trend: RainfallTrend,
  inputs: RiskInputs,
): RiskSignal[] {
  const out: RiskSignal[] = [];

  if (inputs.official?.notPassable) {
    out.push({
      key: 'official',
      text: `Official closure confirmed${
        inputs.official.source ? ` by ${inputs.official.source}` : ''
      }`,
    });
  }

  if (inputs.recentReportCount > 0 && inputs.reportState) {
    out.push({
      key: 'reports',
      text: `${inputs.recentReportCount} recent community report${
        inputs.recentReportCount === 1 ? '' : 's'
      }`,
    });
  }

  if (inputs.rainfall && inputs.rainfall.nowMmHr !== null) {
    const rainText =
      band === 'none'
        ? 'Little or no current rain'
        : band === 'light'
          ? 'Light rainfall detected'
          : band === 'moderate'
            ? 'Moderate rainfall detected'
            : band === 'heavy'
              ? 'Heavy rainfall detected'
              : 'Intense rainfall detected';
    out.push({ key: 'rainfall', text: rainText });
    if (trend === 'rising') {
      out.push({ key: 'forecast', text: 'Rainfall expected to increase' });
    }
  }

  if (inputs.baselineSusceptibility === 'HIGH') {
    out.push({ key: 'susceptibility', text: 'High historical susceptibility' });
  } else if (inputs.baselineSusceptibility === 'MODERATE') {
    out.push({ key: 'susceptibility', text: 'Moderate historical susceptibility' });
  }

  if (!inputs.official?.notPassable && !(inputs.recentReportCount > 0)) {
    // Reassuring, factual absence bullets when nothing active is present.
    if (band === 'none' || band === 'light') {
      out.push({ key: 'reports', text: 'No recent flood reports' });
    }
  }

  return out;
}

/**
 * Computes a barangay's current-risk assessment from its inputs. The evaluation
 * order encodes the safety rules precisely:
 *
 *   official.notPassable          → CONFIRMED_NOT_PASSABLE  (only path)
 *   report RED/ORANGE (recent)    → at least REPORTED_FLOODING
 *   rainfall (+ susceptibility)   → LOW..LIKELY_FLOODING
 *
 * The final level is the MAX severity of the applicable branches, except that
 * CONFIRMED_NOT_PASSABLE is gated exclusively on official confirmation.
 */
export function assessBarangayRisk(
  psgc: string,
  inputs: RiskInputs,
  now: number = Math.floor(Date.now() / 1000),
): BarangayRiskAssessment {
  const band = rainfallBand(inputs.rainfall?.nowMmHr ?? null);
  const trend = rainfallTrend(inputs.rainfall);

  // 1) Official confirmation is the ONLY route to NOT PASSABLE.
  if (inputs.official?.notPassable) {
    return {
      psgc,
      currentRisk: 'CONFIRMED_NOT_PASSABLE',
      baselineSusceptibility: inputs.baselineSusceptibility,
      rainfallBand: band,
      trend,
      reason: reasonFor('CONFIRMED_NOT_PASSABLE', band, trend, inputs),
      confidence: confidenceFor(inputs),
      signals: signalsFor(band, trend, inputs),
      assessedAt: now,
    };
  }

  // 2) Rainfall-driven risk (+ weak susceptibility modifier), capped at
  //    LIKELY_FLOODING. Rainfall can NEVER reach NOT PASSABLE.
  const rainStep = rainfallRiskStep(inputs.rainfall);
  const modifier =
    rainStep > 0 ? susceptibilityModifier(inputs.baselineSusceptibility) : 0;
  // Special case: a HIGH-baseline barangay with genuinely no rain still reads
  // LOW current risk (baseline shown separately) — susceptibility is NOT a
  // current-risk floor. But if there is ANY rain, HIGH baseline can nudge it.
  const rainDrivenIndex = Math.min(
    rainStep + modifier,
    RAINFALL_DRIVEN_LEVELS.length - 1,
  );
  let level: CurrentRiskLevel = RAINFALL_DRIVEN_LEVELS[rainDrivenIndex];

  // 3) Recent community reports of active flooding escalate to
  //    REPORTED_FLOODING (but never NOT PASSABLE). YELLOW (caution) alone does
  //    not escalate to REPORTED_FLOODING.
  const hasActiveReport =
    inputs.recentReportCount > 0 &&
    (inputs.reportState === 'RED' || inputs.reportState === 'ORANGE');
  if (hasActiveReport) {
    level = 'REPORTED_FLOODING';
  }

  return {
    psgc,
    currentRisk: level,
    baselineSusceptibility: inputs.baselineSusceptibility,
    rainfallBand: band,
    trend,
    reason: reasonFor(level, band, trend, inputs),
    confidence: confidenceFor(inputs),
    signals: signalsFor(band, trend, inputs),
    assessedAt: now,
  };
}
