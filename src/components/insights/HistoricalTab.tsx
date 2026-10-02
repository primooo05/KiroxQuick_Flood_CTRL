// src/components/insights/HistoricalTab.tsx
//
// The "Historical" tab of Flood Insights for a selected barangay. Simplified by
// default (headline class + a few key numbers), with the technical metrics
// tucked behind a collapsible "View details". Includes a plain-language "About
// this data" note and a compact return-period scenario selector. Reads the
// STATIC historical dataset (no backend change).

import { useId, useState } from 'react';
import type { BarangayHistoricalRisk } from '../../data/historical/ncrHistoricalFloodRisk';
import { historicalDatasetMeta } from '../../data/historical/ncrHistoricalFloodRisk';
import { HISTORICAL_RISK_COLORS } from '../../map/basemap/colorTokens';
import { InfoTooltip } from './InfoTooltip';
import { historicalMark, TOOLTIP_TEXT } from './statusMarks';

export interface HistoricalTabProps {
  record: BarangayHistoricalRisk | null;
  className?: string;
}

/** Total mapped flood exposure = sum of the three depth-class percentages. */
function totalExposurePct(r: BarangayHistoricalRisk): number {
  return Math.min(100, r.pctLow + r.pctMedium + r.pctHigh);
}

export function HistoricalTab({ record, className }: HistoricalTabProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();

  if (!record) {
    return (
      <div
        className={['baharoute-insights__body', className].filter(Boolean).join(' ')}
        data-testid="historical-tab"
      >
        <p className="baharoute-insights__empty" data-testid="historical-unavailable">
          No mapped historical flood data is available for this barangay. This
          does not mean the area is flood-free.
        </p>
      </div>
    );
  }

  const cls = record.historicalRiskClass;
  const available = historicalDatasetMeta.returnPeriodsAvailable;
  const loaded = historicalDatasetMeta.returnPeriod; // only this one ships at runtime

  return (
    <div
      className={['baharoute-insights__body', className].filter(Boolean).join(' ')}
      data-testid="historical-tab"
    >
      {/* Scenario / return-period selector (compact). Only the loaded period is
          selectable at runtime; others are shown but disabled + explained. */}
      <div className="baharoute-insights__scenario" data-testid="historical-scenario">
        <span className="baharoute-insights__scenario-label">
          Scenario
          <InfoTooltip label="About return periods">{TOOLTIP_TEXT.returnPeriod}</InfoTooltip>
        </span>
        <div role="group" aria-label="Return period scenario" className="baharoute-insights__segmented">
          {available.map((rp) => {
            const isLoaded = rp === loaded;
            const short = rp.replace('yr', ' yr');
            return (
              <button
                key={rp}
                type="button"
                className="baharoute-focus-ring"
                aria-pressed={isLoaded}
                disabled={!isLoaded}
                title={isLoaded ? undefined : 'Only the 100-year scenario is loaded in this build.'}
                data-testid={`historical-rp-${rp}`}
              >
                {short}
              </button>
            );
          })}
        </div>
      </div>

      {/* Headline card: class + the few most important numbers only. */}
      <div className="baharoute-insights__status-card" data-testid="historical-status-card">
        <p className="baharoute-insights__eyebrow">
          Historical flood susceptibility
          <InfoTooltip label="About historical flood susceptibility">
            {TOOLTIP_TEXT.historical}
          </InfoTooltip>
        </p>
        <p className="baharoute-insights__risk" data-testid="historical-class">
          <span
            aria-hidden="true"
            className="baharoute-insights__mark"
            style={{ color: HISTORICAL_RISK_COLORS[cls].hex }}
          >
            {historicalMark(cls)}
          </span>
          <span className="baharoute-insights__risk-label">{cls.toUpperCase()}</span>
        </p>
      </div>

      <dl className="baharoute-insights__metrics" data-testid="historical-summary">
        <div>
          <dt>Total mapped flood exposure</dt>
          <dd data-testid="historical-total-exposure">{totalExposurePct(record).toFixed(1)}%</dd>
        </div>
        <div>
          <dt>Highest mapped hazard</dt>
          <dd data-testid="historical-max-hazard">{record.maxHazard}</dd>
        </div>
        <div>
          <dt>Return period</dt>
          <dd>{record.returnPeriod}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{record.source}</dd>
        </div>
      </dl>

      {/* Advanced metrics behind a collapsible. */}
      <button
        type="button"
        className="baharoute-insights__more baharoute-focus-ring"
        aria-expanded={detailsOpen}
        aria-controls={detailsId}
        onClick={() => setDetailsOpen((v) => !v)}
        data-testid="historical-details-toggle"
      >
        View details {detailsOpen ? '▴' : '▾'}
      </button>
      <div id={detailsId} hidden={!detailsOpen} className="baharoute-insights__fields-wrap">
        <dl className="baharoute-insights__fields">
          <dt>Low hazard exposure</dt>
          <dd data-testid="historical-pct-low">{record.pctLow.toFixed(1)}%</dd>
          <dt>Medium hazard exposure</dt>
          <dd data-testid="historical-pct-medium">{record.pctMedium.toFixed(1)}%</dd>
          <dt>High hazard exposure</dt>
          <dd data-testid="historical-pct-high">{record.pctHigh.toFixed(1)}%</dd>
          <dt>Total exposed area</dt>
          <dd>{record.exposedAreaKm2.toFixed(2)} km²</dd>
          <dt>Source year</dt>
          <dd>{record.sourceYear}</dd>
          <dt>Confidence</dt>
          <dd data-testid="historical-confidence">{record.confidence}</dd>
        </dl>
      </div>

      {/* Plain-language explanation. */}
      <div className="baharoute-insights__about" data-testid="historical-about">
        <p className="baharoute-insights__section-title">About this data</p>
        <p>
          Historical susceptibility shows modeled flood exposure based on Project
          NOAH / Phil-LiDAR data. It does not mean this area is flooding right
          now.
        </p>
      </div>
    </div>
  );
}

export default HistoricalTab;
