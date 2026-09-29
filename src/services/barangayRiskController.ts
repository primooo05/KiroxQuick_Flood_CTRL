// src/services/barangayRiskController.ts
//
// Orchestrates the live barangay current-risk pipeline for MapView:
//   rainfall poll → recompute assessments → paint via feature-state.
//
// It owns no React and no rendering; MapView constructs one on map-ready,
// subscribes for status changes (to drive the fallback banner + panel), and
// tears it down on unmount. Kept map-adapter-structural so tests can drive it
// with a fake map + fake fetch.

import type {
  BarangayRiskAssessment,
  CurrentRiskLevel,
  DataFreshness,
  OfficialStatus,
  RainfallSample,
  RainfallTrend,
  TimelineStep,
} from '../types/risk';
import type { CommunityReport } from '../types/report';
import {
  RainfallService,
  type FetchLike,
  type RainfallSnapshot,
  type SampleCoord,
  RAINFALL_SOURCE_LABEL,
} from './rainfallService';
import { assessAllBarangays } from './barangayRiskModel';
import { ncrBarangayInfos, barangayInfoByPsgc } from '../data/geojson/ncrBarangays';
import {
  applyBarangayRiskStates,
  type FeatureStateMap,
} from '../layers/barangayFloodRiskLayer';
import type { BarangayInfoPanelProps } from '../components/overlays/BarangayInfoPanel';
import { baselineSusceptibilityByBarangay } from './baselineSusceptibility';
import { aggregateReportsByBarangay } from './reportResolution';
import { dataFreshnessFor } from '../layers/riskLabels';
import { barangayToGridCell, rainfallGridSamples } from './rainfallGrid';

/** The public status the UI renders (compact status pill + freshness). */
export interface RiskControllerStatus {
  readonly rainfall: RainfallSnapshot['status'];
  readonly lastUpdated: number | null;
  /** Derived freshness bucket (age-based), the source of truth for the UI. */
  readonly freshness: DataFreshness;
  /** True when there is NO usable current data at all (never loaded). */
  readonly dataUnavailable: boolean;
  /** True when data exists but is older than the freshness window. */
  readonly dataStale: boolean;
}

/** Options for the controller (all injectable for tests). */
export interface RiskControllerOptions {
  readonly reports?: readonly CommunityReport[];
  readonly officials?: readonly OfficialStatus[];
  readonly fetchImpl?: FetchLike;
  readonly intervalMs?: number;
}

/**
 * Rainfall sample coordinates. Uses the COARSE GRID (a few dozen cells) rather
 * than all 1,710 barangay centroids so a full refresh is 1–2 Open-Meteo
 * requests instead of ~9 — this is the fix for the hourly rate-limit (429) that
 * caused persistent "Live rainfall unavailable". Each barangay inherits its
 * grid cell's sample via {@link expandGridToBarangays}.
 */
function buildSampleCoords(): SampleCoord[] {
  return [...rainfallGridSamples];
}

/**
 * Expands a grid-keyed rainfall map (cell id → sample) into a barangay-keyed
 * map (PSGC → sample) so all downstream code keeps working unchanged. A
 * barangay whose cell has no sample this round is simply absent (reads UNKNOWN).
 */
function expandGridToBarangays(
  byCell: ReadonlyMap<string, RainfallSample>,
): Map<string, RainfallSample> {
  const byBarangay = new Map<string, RainfallSample>();
  for (const b of ncrBarangayInfos) {
    const cellId = barangayToGridCell.get(b.psgc);
    if (!cellId) continue;
    const sample = byCell.get(cellId);
    if (sample) byBarangay.set(b.psgc, sample);
  }
  return byBarangay;
}

export class BarangayRiskController {
  private readonly rainfall: RainfallService;
  private assessments: Map<string, BarangayRiskAssessment> = new Map();
  private reports: readonly CommunityReport[];
  private officials: readonly OfficialStatus[];
  private map: FeatureStateMap | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly listeners = new Set<(s: RiskControllerStatus) => void>();
  private lastSnapshot: RainfallSnapshot | null = null;
  /**
   * Rainfall expanded from grid cells to barangays (PSGC → sample). The rainfall
   * service samples a coarse grid; this is that snapshot mapped onto barangays,
   * which everything downstream (assessments, paint, panel) consumes.
   */
  private rainfallByBarangay: ReadonlyMap<string, RainfallSample> = new Map();
  /** Selected timeline step; the map paints the risk projected for this step. */
  private timelineStep: TimelineStep = 'now';

  constructor(options: RiskControllerOptions = {}) {
    this.reports = options.reports ?? [];
    this.officials = options.officials ?? [];
    this.rainfall = new RainfallService(
      buildSampleCoords(),
      options.fetchImpl,
      options.intervalMs,
    );
    // Seed an initial assessment so the panel and map have data even before the
    // first rainfall response (all barangays start with no sample → UNKNOWN via
    // the data-quality gating).
    this.recompute();
  }

  /** Attaches the map used for feature-state paints and applies current state. */
  attachMap(map: FeatureStateMap | null): void {
    this.map = map;
    this.paint();
  }

  /** Sets the timeline step and repaints the map for that step. */
  setTimelineStep(step: TimelineStep): void {
    if (this.timelineStep === step) return;
    this.timelineStep = step;
    this.paint();
  }

  /** Starts polling; recomputes + repaints on every rainfall snapshot. */
  start(): void {
    this.unsubscribe = this.rainfall.subscribe((snapshot) => {
      this.lastSnapshot = snapshot;
      // Expand the grid-keyed snapshot onto barangays once per update.
      this.rainfallByBarangay = expandGridToBarangays(snapshot.byBarangay);
      this.recompute();
      this.paint();
      this.emitStatus();
    });
    this.rainfall.start();
  }

  /** Stops polling and releases the subscription. */
  stop(): void {
    this.rainfall.stop();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Subscribes to status changes; returns an unsubscribe fn. */
  onStatus(listener: (status: RiskControllerStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status());
    return () => this.listeners.delete(listener);
  }

  /** Current status snapshot for the UI. */
  status(now: number = Math.floor(Date.now() / 1000)): RiskControllerStatus {
    const snap = this.lastSnapshot ?? this.rainfall.snapshot();
    // Freshness is age-based when we have a timestamp; if the last fetch failed
    // but the cached data is still within the window it reads `recent`, and
    // only crosses to `stale` once genuinely old. With no data ever, it is
    // `unavailable`.
    const freshness =
      snap.lastUpdated === null
        ? 'unavailable'
        : dataFreshnessFor(snap.lastUpdated, now);
    return {
      rainfall: snap.status,
      lastUpdated: snap.lastUpdated,
      freshness,
      dataUnavailable: freshness === 'unavailable',
      dataStale: freshness === 'stale',
    };
  }

  /**
   * The DISPLAY (data-quality-aware) risk level for a barangay. This is what the
   * map paints and the panel shows, so unavailable/stale data never appears as a
   * classified severity (e.g. never "Low" when data is unavailable):
   *   no data ever          → UNKNOWN
   *   data older than window → STALE
   *   barangay has no sample → UNKNOWN
   *   otherwise             → the classified assessment level
   *
   * Official confirmations are authoritative regardless of weather freshness, so
   * a CONFIRMED_NOT_PASSABLE barangay always shows its closure.
   */
  private displayRiskFor(
    psgc: string,
    now: number = Math.floor(Date.now() / 1000),
  ): CurrentRiskLevel {
    const assessment = this.assessments.get(psgc);
    if (assessment?.currentRisk === 'CONFIRMED_NOT_PASSABLE') {
      return 'CONFIRMED_NOT_PASSABLE';
    }
    const status = this.status(now);
    if (status.freshness === 'unavailable') return 'UNKNOWN';
    if (status.freshness === 'stale') return 'STALE';
    // Data is fresh enough; but this specific barangay may lack a sample.
    if (!this.rainfallByBarangay.has(psgc)) return 'UNKNOWN';
    return assessment?.currentRisk ?? 'UNKNOWN';
  }

  private emitStatus(): void {
    const s = this.status();
    for (const l of this.listeners) l(s);
  }

  /** Recomputes all barangay assessments from the latest (expanded) inputs. */
  private recompute(): void {
    this.assessments = assessAllBarangays({
      rainfallByBarangay: this.rainfallByBarangay,
      reports: this.reports,
      officials: this.officials,
    });
  }

  /**
   * Paints the DISPLAY (data-quality-aware) risk levels onto the map via
   * feature-state. Unavailable/stale data paints UNKNOWN/STALE (faint neutral),
   * never a classified severity — this is what fixes the grey-sheet artifact.
   */
  private paint(): void {
    if (!this.map) return;
    const now = Math.floor(Date.now() / 1000);
    const step = this.timelineStep;
    const riskByBarangay = new Map<string, CurrentRiskLevel>();
    for (const psgc of this.assessments.keys()) {
      const displayNow = this.displayRiskFor(psgc, now);
      if (step === 'now') {
        riskByBarangay.set(psgc, displayNow);
      } else {
        const sample = this.rainfallByBarangay.get(psgc);
        const forecast =
          step === 'plus30' ? (sample?.next30MmHr ?? null) : (sample?.next60MmHr ?? null);
        const official = this.officials.find((o) => o.psgc === psgc);
        riskByBarangay.set(
          psgc,
          this.projectedRiskFor(psgc, forecast, displayNow, official?.notPassable),
        );
      }
    }
    applyBarangayRiskStates(this.map, riskByBarangay);
  }

  /** The current assessment for a barangay (or undefined). */
  assessmentFor(psgc: string): BarangayRiskAssessment | undefined {
    return this.assessments.get(psgc);
  }

  /**
   * The DISPLAY (data-quality-aware) current-risk level for a barangay — the
   * same gating the map/panel use, so callers (e.g. route-risk aggregation)
   * never see a classified severity when data is unavailable/stale. Returns
   * UNKNOWN for an unknown PSGC. Public wrapper over {@link displayRiskFor}.
   */
  riskFor(psgc: string, now: number = Math.floor(Date.now() / 1000)): CurrentRiskLevel {
    return this.displayRiskFor(psgc, now);
  }

  /** Recent (non-expired) community report count resolving to a barangay. */
  reportCountFor(psgc: string, now: number = Math.floor(Date.now() / 1000)): number {
    return aggregateReportsByBarangay(this.reports, now).get(psgc)?.count ?? 0;
  }

  /** The PSGC set of officially confirmed (not-passable) closures. */
  closedBarangays(): ReadonlySet<string> {
    const set = new Set<string>();
    for (const o of this.officials) if (o.notPassable) set.add(o.psgc);
    return set;
  }

  /**
   * A single overall rainfall trend for the region, for route-comparison
   * display. It is the most common non-'unknown' assessment trend across
   * barangays that currently have a sample. When live data is unavailable/stale
   * it is 'unknown' (never fabricated).
   */
  overallTrend(now: number = Math.floor(Date.now() / 1000)): RainfallTrend {
    const status = this.status(now);
    if (status.freshness === 'unavailable' || status.freshness === 'stale') return 'unknown';
    const counts = new Map<RainfallTrend, number>();
    for (const [psgc, a] of this.assessments) {
      if (!this.rainfallByBarangay.has(psgc)) continue;
      if (a.trend === 'unknown') continue;
      counts.set(a.trend, (counts.get(a.trend) ?? 0) + 1);
    }
    let best: RainfallTrend = 'unknown';
    let bestN = 0;
    for (const [t, n] of counts) {
      if (n > bestN) {
        best = t;
        bestN = n;
      }
    }
    return best;
  }

  /**
   * Adds a community report at runtime (the demo "report flooding" flow),
   * re-resolving it to a barangay, then recomputes + repaints so the barangay
   * can escalate to REPORTED_FLOODING. Returns the resolved barangay PSGC.
   */
  addReport(report: CommunityReport): void {
    this.reports = [...this.reports, report];
    this.recompute();
    this.paint();
    this.emitStatus();
  }

  /**
   * Builds the info-panel props for a clicked barangay from live state, for the
   * chosen timeline step. Returns null when the PSGC is unknown. The displayed
   * risk is data-quality-aware, so it NEVER contradicts the freshness state
   * (no "Low" while "unavailable"). Estimated/model values are clearly labeled.
   *
   * @param psgc - The clicked barangay.
   * @param step - Timeline step: 'now' | 'plus30' | 'plus60'.
   */
  infoFor(
    psgc: string,
    step: TimelineStep = 'now',
    now: number = Math.floor(Date.now() / 1000),
  ): BarangayInfoPanelProps | null {
    const info = barangayInfoByPsgc.get(psgc);
    if (!info) return null;

    const assessment = this.assessments.get(psgc);
    const snap = this.lastSnapshot ?? this.rainfall.snapshot();
    const rainfall = this.rainfallByBarangay.get(psgc) ?? null;
    const baseline =
      assessment?.baselineSusceptibility ??
      baselineSusceptibilityByBarangay.get(psgc) ??
      null;

    const reportSignal = aggregateReportsByBarangay(this.reports, now).get(psgc);
    const official = this.officials.find((o) => o.psgc === psgc) ?? null;
    const officialConfirmed = Boolean(official?.notPassable);
    const officialStatus = officialConfirmed
      ? `Confirmed closure — ${official?.source ?? 'official'}`
      : 'Not confirmed';

    const status = this.status(now);
    const displayNow = this.displayRiskFor(psgc, now);

    // The rainfall value shown per step. +30/+60 are forecast (estimated).
    const rainfallForStep =
      step === 'plus30'
        ? (rainfall?.next30MmHr ?? null)
        : step === 'plus60'
          ? (rainfall?.next60MmHr ?? null)
          : (rainfall?.nowMmHr ?? null);

    // Per-step display risk: for forecast steps we recompute a rainfall-only
    // projection but keep data-quality gating and the official override.
    const displayRisk =
      step === 'now'
        ? displayNow
        : this.projectedRiskFor(psgc, rainfallForStep, displayNow, official?.notPassable);

    const dataUsable = displayRisk !== 'UNKNOWN' && displayRisk !== 'STALE';

    return {
      barangayName: info.name,
      cityName: info.city,
      currentRisk: displayRisk,
      reason: assessment?.reason ?? '',
      confidence: officialConfirmed ? 'verified' : (assessment?.confidence ?? 'none'),
      signals: dataUsable ? (assessment?.signals ?? []) : [],
      rainfallNowMmHr: dataUsable ? rainfallForStep : null,
      trend: dataUsable ? (assessment?.trend ?? 'unknown') : 'unknown',
      rainfallNext30MmHr: rainfall?.next30MmHr ?? null,
      rainfallNext60MmHr: rainfall?.next60MmHr ?? null,
      baselineSusceptibility: baseline,
      recentReportCount: reportSignal?.count ?? 0,
      officialStatus,
      lastUpdated: snap.lastUpdated,
      freshness: status.freshness,
      source: RAINFALL_SOURCE_LABEL,
      timelineStep: step,
    };
  }

  /**
   * A rainfall-only projected level for a forecast step. Reuses the display
   * gating: official closure always wins; if current data is UNKNOWN/STALE the
   * projection is too (we don't forecast off missing data). Otherwise maps the
   * forecast rainfall rate to a coarse level (never above LIKELY_FLOODING).
   */
  private projectedRiskFor(
    _psgc: string,
    forecastMmHr: number | null,
    displayNow: CurrentRiskLevel,
    officialNotPassable: boolean | undefined,
  ): CurrentRiskLevel {
    if (officialNotPassable) return 'CONFIRMED_NOT_PASSABLE';
    if (displayNow === 'UNKNOWN' || displayNow === 'STALE') return displayNow;
    if (forecastMmHr === null) return 'UNKNOWN';
    if (forecastMmHr <= 0) return 'LOW';
    if (forecastMmHr < 7.5) return 'ELEVATED';
    if (forecastMmHr < 30) return 'HIGH';
    return 'LIKELY_FLOODING';
  }
}
