// src/components/insights/CurrentTab.tsx
//
// The "Current" tab of Flood Insights: what is happening now for the selected
// barangay. It consumes the SAME data the controller already produces
// (BarangayInfoPanelProps from BarangayRiskController.infoFor) — no backend
// change. It emphasizes an obvious current-risk status card, the live rainfall
// metrics, honest live/stale/unavailable status, a data-backed "why", any
// community reports, a prominent confirmed-closure block, and a compact
// current-vs-historical cross-reference.

import type { BarangayInfoPanelProps } from '../overlays/BarangayInfoPanel';
import { isDataQualityState } from '../../types/risk';
import { CURRENT_RISK_COLORS, HISTORICAL_RISK_COLORS } from '../../map/basemap/colorTokens';
import {
  currentRiskLabel,
  confidenceLabel,
  formatRainfallRate,
  formatRelativeTime,
  rainfallTrendLabel,
} from '../../layers/riskLabels';
import type { HistoricalRiskClass } from '../../data/historical/ncrHistoricalFloodRisk';
import { InfoTooltip } from './InfoTooltip';
import { currentRiskMark, historicalMark, TOOLTIP_TEXT } from './statusMarks';
import { Disclaimer } from '../overlays/Disclaimer';

export interface CurrentTabProps {
  info: BarangayInfoPanelProps;
  /** Historical class for the same barangay (for the cross-reference), or null. */
  historicalClass: HistoricalRiskClass | null;
  className?: string;
}

/** Live/stale/unavailable status line, honest and never shown as Low. */
function StatusLine({ info }: { info: BarangayInfoPanelProps }) {
  if (info.freshness === 'unavailable') {
    return (
      <p className="baharoute-insights__status baharoute-insights__status--warn" role="status">
        <span aria-hidden="true">⚠</span> Current rainfall unavailable
      </p>
    );
  }
  if (info.freshness === 'stale') {
    return (
      <p className="baharoute-insights__status baharoute-insights__status--warn" role="status">
        <span aria-hidden="true">⚠</span> Data may be outdated — last updated{' '}
        {formatRelativeTime(info.lastUpdated)}
      </p>
    );
  }
  return (
    <p className="baharoute-insights__status baharoute-insights__status--live" role="status">
      <span aria-hidden="true">●</span> Live · updated {formatRelativeTime(info.lastUpdated)}
    </p>
  );
}

export function CurrentTab({ info, historicalClass, className }: CurrentTabProps) {
  const dataQuality = isDataQualityState(info.currentRisk);
  const isClosure = info.currentRisk === 'CONFIRMED_NOT_PASSABLE';
  const estimated = info.timelineStep !== 'now';

  return (
    <div
      className={['baharoute-insights__body', className].filter(Boolean).join(' ')}
      data-testid="current-tab"
    >
      {/* Risk status card — obvious, icon + text + color (never color alone). */}
      <div
        className="baharoute-insights__status-card"
        data-risk={info.currentRisk}
        data-testid="current-status-card"
        style={{ borderColor: CURRENT_RISK_COLORS[info.currentRisk].hex }}
      >
        <p className="baharoute-insights__eyebrow">
          Current flood risk
          {estimated ? ` · ${info.timelineStep === 'plus30' ? '+30 min' : '+1 hr'}` : ''}
          <InfoTooltip label="About current flood risk">
            {TOOLTIP_TEXT.currentRisk}
          </InfoTooltip>
        </p>
        <p className="baharoute-insights__risk" data-testid="current-risk-level">
          <span
            aria-hidden="true"
            className="baharoute-insights__mark"
            style={{ color: CURRENT_RISK_COLORS[info.currentRisk].hex }}
          >
            {currentRiskMark(info.currentRisk)}
          </span>
          <span className="baharoute-insights__risk-label">
            {currentRiskLabel(info.currentRisk).toUpperCase()}
          </span>
        </p>
        <StatusLine info={info} />
      </div>

      {/* Confirmed closure gets its own prominent block, distinct from reports. */}
      {isClosure && (
        <div className="baharoute-insights__closure" data-testid="current-closure" role="alert">
          <p className="baharoute-insights__closure-title">
            Confirmed closure — not passable
            <InfoTooltip label="About confirmed closures">
              {TOOLTIP_TEXT.confirmedClosure}
            </InfoTooltip>
          </p>
          <p className="baharoute-insights__closure-src">{info.officialStatus}</p>
        </div>
      )}

      {/* Rainfall metrics — only meaningful when data is usable. */}
      {!dataQuality ? (
        <dl className="baharoute-insights__metrics" data-testid="current-metrics">
          <div>
            <dt>{estimated ? 'Rainfall (est.)' : 'Rainfall now'}</dt>
            <dd data-testid="current-rainfall-now">{formatRainfallRate(info.rainfallNowMmHr)}</dd>
          </div>
          <div>
            <dt>Trend</dt>
            <dd data-testid="current-trend">{rainfallTrendLabel(info.trend)}</dd>
          </div>
          <div>
            <dt>Next 30 min</dt>
            <dd data-testid="current-next30">{formatRainfallRate(info.rainfallNext30MmHr)}</dd>
          </div>
          <div>
            <dt>Next 1 hour</dt>
            <dd data-testid="current-next60">{formatRainfallRate(info.rainfallNext60MmHr)}</dd>
          </div>
        </dl>
      ) : (
        <p className="baharoute-insights__empty" data-testid="current-unavailable">
          Current flood information is temporarily unavailable. Historical
          information may still be available.
        </p>
      )}

      {/* Why this risk? — only data-backed signals (never invented). */}
      {!dataQuality && info.signals.length > 0 && (
        <div className="baharoute-insights__why" data-testid="current-why">
          <p className="baharoute-insights__section-title">
            Why {currentRiskLabel(info.currentRisk).toLowerCase()}?
          </p>
          <ul>
            {info.signals.map((s) => (
              <li key={s.key}>{s.text}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Community reports (secondary), clearly labeled, not official. */}
      {info.recentReportCount > 0 && (
        <div className="baharoute-insights__reports" data-testid="current-reports">
          <p className="baharoute-insights__section-title">
            Community reports
            <InfoTooltip label="About community reports">
              {TOOLTIP_TEXT.communityReport}
            </InfoTooltip>
          </p>
          <p className="baharoute-insights__reports-count">
            {info.recentReportCount} recent report{info.recentReportCount === 1 ? '' : 's'}
          </p>
          <p className="baharoute-insights__reports-tag">Community reported · unverified</p>
        </div>
      )}

      {/* Current vs historical cross-reference (only when both are known). */}
      {historicalClass && historicalClass !== 'Unknown' && (
        <div className="baharoute-insights__crossref" data-testid="current-crossref">
          <div className="baharoute-insights__crossref-row">
            <span>Current risk</span>
            <strong>{currentRiskLabel(info.currentRisk).toUpperCase()}</strong>
          </div>
          <div className="baharoute-insights__crossref-row">
            <span>Historical susceptibility</span>
            <strong style={{ color: HISTORICAL_RISK_COLORS[historicalClass].hex }}>
              <span aria-hidden="true">{historicalMark(historicalClass)} </span>
              {historicalClass.toUpperCase()}
            </strong>
          </div>
          <p className="baharoute-insights__crossref-note">
            Historical susceptibility does not indicate current flooding.
          </p>
        </div>
      )}

      {/* Details: confidence + source, collapsed context. */}
      <dl className="baharoute-insights__fields">
        <dt>Confidence</dt>
        <dd data-testid="current-confidence">{confidenceLabel(info.confidence)}</dd>
        <dt>Data source</dt>
        <dd data-testid="current-source">{info.source}</dd>
      </dl>

      <Disclaimer variant="general" />
    </div>
  );
}

export default CurrentTab;
