// src/components/overlays/BarangayInfoPanel.tsx
//
// Commuter-facing barangay info panel (Phase 2 redesign, Req 3/8/9).
//
// Hierarchy:
//   Barangay name · City
//   CURRENT FLOOD RISK  →  <LEVEL>  + one short explanation
//   3 primary metrics: Estimated rainfall now · Trend · Baseline susceptibility
//   Why this risk?  (bullets generated from actual signals)
//   More details ▾  (forecast, community reports, official status, updated,
//                    data source, confidence)
//
// Data-quality states (UNKNOWN/STALE) NEVER show a classified severity or a
// fabricated rainfall value; they show the appropriate "unavailable / stale"
// messaging instead. Estimated/model values are clearly labeled.

import { useId, useState } from 'react';
import type { SusceptibilityLevel } from '../../types/flood';
import type {
  CurrentRiskLevel,
  DataFreshness,
  RainfallTrend,
  RiskConfidence,
  RiskSignal,
  TimelineStep,
} from '../../types/risk';
import { isDataQualityState } from '../../types/risk';
import {
  CURRENT_RISK_COLORS,
  SUSCEPTIBILITY_COLORS,
} from '../../map/basemap/colorTokens';
import { susceptibilityLabel } from '../../layers/visualMapping';
import {
  confidenceLabel,
  currentRiskLabel,
  formatRainfallRate,
  formatRelativeTime,
  rainfallTrendLabel,
} from '../../layers/riskLabels';
import { Disclaimer } from './Disclaimer';

export interface BarangayInfoPanelProps {
  barangayName: string;
  cityName: string;
  /** Display (data-quality-aware) current flood-risk level. */
  currentRisk: CurrentRiskLevel;
  /** One short explanation line for the risk. */
  reason: string;
  /** Deterministic confidence from the signals used. */
  confidence: RiskConfidence;
  /** "Why this risk?" bullets, generated from the actual signals. */
  signals: readonly RiskSignal[];
  /** Estimated rainfall for the selected step, mm/hr (null → unavailable). */
  rainfallNowMmHr: number | null;
  /** Rainfall trend. */
  trend: RainfallTrend;
  /** Estimated forecast rainfall ~30 min ahead, mm/hr. */
  rainfallNext30MmHr: number | null;
  /** Estimated forecast rainfall ~1 hr ahead, mm/hr. */
  rainfallNext60MmHr: number | null;
  /** Historical baseline susceptibility (null → unknown). */
  baselineSusceptibility: SusceptibilityLevel | null;
  /** Count of recent community reports resolving to this barangay. */
  recentReportCount: number;
  /** Official status label. */
  officialStatus: string;
  /** Last successful data update (epoch seconds) or null. */
  lastUpdated: number | null;
  /** Derived freshness bucket. */
  freshness: DataFreshness;
  /** Data source attribution (model-based label). */
  source: string;
  /** The timeline step this data is for. */
  timelineStep: TimelineStep;
  className?: string;
}

const STEP_LABELS: Record<TimelineStep, string> = {
  now: 'now',
  plus30: '+30 min',
  plus60: '+1 hr',
};

export function BarangayInfoPanel({
  barangayName,
  cityName,
  currentRisk,
  reason,
  confidence,
  signals,
  rainfallNowMmHr,
  trend,
  rainfallNext30MmHr,
  rainfallNext60MmHr,
  baselineSusceptibility,
  recentReportCount,
  officialStatus,
  lastUpdated,
  freshness,
  source,
  timelineStep,
  className,
}: BarangayInfoPanelProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();

  const dataQuality = isDataQualityState(currentRisk);
  const estimated = timelineStep !== 'now';

  return (
    <section
      className={['baharoute-barangay-panel', className].filter(Boolean).join(' ')}
      aria-label={`Flood information for ${barangayName}, ${cityName}`}
      data-testid="barangay-info-panel"
    >
      <h2 className="baharoute-barangay-panel__title" data-testid="barangay-name">
        {barangayName}
      </h2>
      <p className="baharoute-barangay-panel__city" data-testid="barangay-city">
        {cityName}
      </p>

      <p className="baharoute-barangay-panel__eyebrow">
        Current flood risk{timelineStep !== 'now' ? ` · ${STEP_LABELS[timelineStep]}` : ''}
      </p>
      <p
        className="baharoute-barangay-panel__risk"
        data-testid="barangay-current-risk"
        data-risk={currentRisk}
      >
        <span
          aria-hidden="true"
          className="baharoute-barangay-panel__risk-swatch"
          style={{ backgroundColor: CURRENT_RISK_COLORS[currentRisk].hex }}
        />
        <span className="baharoute-barangay-panel__risk-label">
          {currentRiskLabel(currentRisk).toUpperCase()}
        </span>
      </p>

      {dataQuality ? (
        <p className="baharoute-barangay-panel__explain" data-testid="barangay-explain">
          {currentRisk === 'UNKNOWN'
            ? 'Current flood-risk data unavailable.'
            : `Data may be out of date — last updated ${formatRelativeTime(lastUpdated)}.`}
        </p>
      ) : (
        reason && (
          <p className="baharoute-barangay-panel__explain" data-testid="barangay-explain">
            {reason}
          </p>
        )
      )}

      {/* 3 primary metrics */}
      <dl className="baharoute-barangay-panel__primary" data-testid="barangay-primary">
        <div>
          <dt>{estimated ? 'Rainfall (est.)' : 'Rainfall'}</dt>
          <dd data-testid="barangay-rainfall">
            {dataQuality ? 'Unavailable' : formatRainfallRate(rainfallNowMmHr)}
          </dd>
        </div>
        <div>
          <dt>Trend</dt>
          <dd data-testid="barangay-trend">
            {dataQuality ? 'Unavailable' : rainfallTrendLabel(trend)}
          </dd>
        </div>
        <div>
          <dt>Baseline</dt>
          <dd data-testid="barangay-baseline">
            {baselineSusceptibility ? (
              <>
                <span
                  aria-hidden="true"
                  className="baharoute-barangay-panel__dot"
                  style={{
                    backgroundColor: SUSCEPTIBILITY_COLORS[baselineSusceptibility].hex,
                  }}
                />
                {susceptibilityLabel(baselineSusceptibility)}
              </>
            ) : (
              'Unknown'
            )}
          </dd>
        </div>
      </dl>

      {/* Why this risk? — generated from actual signals */}
      {signals.length > 0 && (
        <div className="baharoute-barangay-panel__why" data-testid="barangay-why">
          <p className="baharoute-barangay-panel__why-title">
            Why {currentRiskLabel(currentRisk)}?
          </p>
          <ul>
            {signals.map((s) => (
              <li key={s.key}>{s.text}</li>
            ))}
          </ul>
        </div>
      )}

      {/* More details (collapsible) */}
      <button
        type="button"
        className="baharoute-barangay-panel__more baharoute-focus-ring"
        aria-expanded={detailsOpen}
        aria-controls={detailsId}
        onClick={() => setDetailsOpen((v) => !v)}
        data-testid="barangay-more-toggle"
      >
        More details {detailsOpen ? '▴' : '▾'}
      </button>
      <div id={detailsId} hidden={!detailsOpen} className="baharoute-barangay-panel__details">
        <dl className="baharoute-flood-popup__fields">
          <dt>Forecast +30 min (est.)</dt>
          <dd data-testid="barangay-forecast">{formatRainfallRate(rainfallNext30MmHr)}</dd>

          <dt>Forecast +1 hr (est.)</dt>
          <dd data-testid="barangay-forecast60">{formatRainfallRate(rainfallNext60MmHr)}</dd>

          <dt>Community reports</dt>
          <dd data-testid="barangay-reports">
            {recentReportCount === 0 ? 'None recent' : `${recentReportCount} recent`}
          </dd>

          <dt>Official status</dt>
          <dd data-testid="barangay-official">{officialStatus}</dd>

          <dt>Confidence</dt>
          <dd data-testid="barangay-confidence">{confidenceLabel(confidence)}</dd>

          <dt>Data freshness</dt>
          <dd data-testid="barangay-freshness">
            {freshness === 'unavailable'
              ? 'Unavailable'
              : `${formatRelativeTime(lastUpdated)} (${freshness})`}
          </dd>

          <dt>Data source</dt>
          <dd data-testid="barangay-source">{source}</dd>
        </dl>
      </div>

      <Disclaimer variant="general" />
    </section>
  );
}

export default BarangayInfoPanel;
