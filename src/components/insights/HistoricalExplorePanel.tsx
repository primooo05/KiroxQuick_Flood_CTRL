// src/components/insights/HistoricalExplorePanel.tsx
//
// The layer-driven "Explore historical risk" panel: conditional Area / City /
// Barangay / Risk filters that drive the historical map layer, plus a compact
// NCR overview summary and per-city summary (with a simple distribution bar).
// Detailed per-barangay metrics live in Flood Insights, not here.
//
// This replaces the previous dense HistoricalFloodRiskPanel with a lighter,
// progressive-disclosure layout. Filter semantics are unchanged.

import { useId, useMemo } from 'react';
import {
  historicalCitySummaries,
  historicalCitySummaryByPsgc,
  historicalRiskByBarangay,
  historicalRiskRecords,
  historicalDatasetMeta,
} from '../../data/historical/ncrHistoricalFloodRisk';
import {
  shownCount,
  type HistoricalFilterState,
  type HistoricalRiskFilter,
  type HistoricalViewLevel,
} from '../../layers/historicalFloodRisk';
import { HISTORICAL_RISK_COLORS } from '../../map/basemap/colorTokens';
import { DistributionBar } from './DistributionBar';
import { InfoTooltip } from './InfoTooltip';
import { TOOLTIP_TEXT } from './statusMarks';
import { Disclaimer } from '../overlays/Disclaimer';

export interface HistoricalExplorePanelProps {
  filter: HistoricalFilterState;
  onFilterChange: (next: HistoricalFilterState) => void;
  /** Open the per-barangay Flood Insights for a PSGC (from "View barangays"). */
  onOpenBarangay?: (psgc: string) => void;
  className?: string;
}

const RISK_OPTIONS: readonly HistoricalRiskFilter[] = ['all', 'Low', 'Moderate', 'High', 'Unknown'];

/** NCR-wide totals derived once from the static dataset. */
function ncrTotals() {
  let high = 0;
  let moderate = 0;
  let low = 0;
  let unknown = 0;
  for (const r of historicalRiskRecords) {
    if (r.historicalRiskClass === 'High') high += 1;
    else if (r.historicalRiskClass === 'Moderate') moderate += 1;
    else if (r.historicalRiskClass === 'Low') low += 1;
    else unknown += 1;
  }
  return { high, moderate, low, unknown, total: historicalRiskRecords.length };
}

export function HistoricalExplorePanel({
  filter,
  onFilterChange,
  onOpenBarangay,
  className,
}: HistoricalExplorePanelProps) {
  const ids = { area: useId(), city: useId(), barangay: useId(), risk: useId() };

  const cityBarangays = useMemo(
    () =>
      filter.cityPsgc
        ? historicalRiskRecords.filter((r) => r.cityPsgc === filter.cityPsgc)
        : historicalRiskRecords,
    [filter.cityPsgc],
  );

  const matches = useMemo(() => shownCount(filter), [filter]);
  const totals = useMemo(ncrTotals, []);
  const set = (patch: Partial<HistoricalFilterState>): void => onFilterChange({ ...filter, ...patch });

  const selectedCity =
    filter.cityPsgc != null ? (historicalCitySummaryByPsgc.get(filter.cityPsgc) ?? null) : null;

  const distColors = {
    High: HISTORICAL_RISK_COLORS.High.hex,
    Moderate: HISTORICAL_RISK_COLORS.Moderate.hex,
    Low: HISTORICAL_RISK_COLORS.Low.hex,
    Unknown: HISTORICAL_RISK_COLORS.Unknown.hex,
  };

  return (
    <section
      className={['baharoute-explore', className].filter(Boolean).join(' ')}
      aria-label="Explore historical flood risk"
      data-testid="historical-explore"
    >
      <h2 className="baharoute-explore__title">
        Explore historical risk
        <InfoTooltip label="About historical flood susceptibility">
          {TOOLTIP_TEXT.historical}
        </InfoTooltip>
      </h2>

      {/* Breadcrumb drill-down: NCR > City > Barangay. Parent levels reset the
          scope when clicked (full visual reset for NCR). */}
      <nav className="baharoute-breadcrumb" aria-label="Historical scope" data-testid="hist-breadcrumb">
        <button
          type="button"
          className="baharoute-breadcrumb__crumb baharoute-focus-ring"
          data-testid="breadcrumb-ncr"
          aria-current={filter.view === 'ncr' ? 'page' : undefined}
          disabled={filter.view === 'ncr'}
          onClick={() => onFilterChange({ view: 'ncr', cityPsgc: null, barangayPsgc: null, risk: filter.risk })}
        >
          NCR
        </button>
        {filter.view !== 'ncr' && selectedCity && (
          <>
            <span className="baharoute-breadcrumb__sep" aria-hidden="true">›</span>
            <button
              type="button"
              className="baharoute-breadcrumb__crumb baharoute-focus-ring"
              data-testid="breadcrumb-city"
              aria-current={filter.view === 'city' ? 'page' : undefined}
              disabled={filter.view === 'city'}
              onClick={() => set({ view: 'city', barangayPsgc: null })}
            >
              {selectedCity.cityName}
            </button>
          </>
        )}
        {filter.view === 'barangay' && filter.barangayPsgc && (
          <>
            <span className="baharoute-breadcrumb__sep" aria-hidden="true">›</span>
            <span className="baharoute-breadcrumb__crumb baharoute-breadcrumb__crumb--current" aria-current="page" data-testid="breadcrumb-barangay">
              {historicalRiskByBarangay.get(filter.barangayPsgc)?.name ?? 'Barangay'}
            </span>
          </>
        )}
      </nav>

      <div className="baharoute-explore__controls">
        <label htmlFor={ids.area}>Area</label>
        <select
          id={ids.area}
          data-testid="explore-area-select"
          value={filter.view}
          onChange={(e) =>
            set({
              view: e.target.value as HistoricalViewLevel,
              // Reset dependent selections when the level changes upward.
              ...(e.target.value === 'ncr' ? { cityPsgc: null, barangayPsgc: null } : {}),
              ...(e.target.value === 'city' ? { barangayPsgc: null } : {}),
            })
          }
        >
          <option value="ncr">NCR</option>
          <option value="city">City / LGU</option>
          <option value="barangay">Barangay</option>
        </select>

        {(filter.view === 'city' || filter.view === 'barangay') && (
          <>
            <label htmlFor={ids.city}>City</label>
            <select
              id={ids.city}
              data-testid="explore-city-select"
              value={filter.cityPsgc ?? ''}
              onChange={(e) => set({ cityPsgc: e.target.value || null, barangayPsgc: null })}
            >
              <option value="">Select city</option>
              {historicalCitySummaries.map((c) => (
                <option key={c.cityPsgc} value={c.cityPsgc}>
                  {c.cityName}
                </option>
              ))}
            </select>
          </>
        )}

        {filter.view === 'barangay' && (
          <>
            <label htmlFor={ids.barangay}>Barangay</label>
            <select
              id={ids.barangay}
              data-testid="explore-barangay-select"
              value={filter.barangayPsgc ?? ''}
              onChange={(e) => set({ barangayPsgc: e.target.value || null })}
            >
              <option value="">Select barangay</option>
              {cityBarangays.map((b) => (
                <option key={b.psgc} value={b.psgc}>
                  {b.name}
                </option>
              ))}
            </select>
          </>
        )}

        <label htmlFor={ids.risk}>Risk</label>
        <select
          id={ids.risk}
          data-testid="explore-risk-select"
          value={filter.risk}
          onChange={(e) => set({ risk: e.target.value as HistoricalRiskFilter })}
        >
          {RISK_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r === 'all' ? 'All' : r}
            </option>
          ))}
        </select>
      </div>

      <p className="baharoute-explore__count" data-testid="explore-match-count">
        {matches} barangay{matches === 1 ? '' : 's'} shown
      </p>

      {/* Barangay + risk-filter mismatch: never silently drop the selected
          barangay — explain the mismatch and offer to clear the risk filter. */}
      {(() => {
        if (filter.view !== 'barangay' || !filter.barangayPsgc || filter.risk === 'all') {
          return null;
        }
        const rec = historicalRiskByBarangay.get(filter.barangayPsgc);
        if (!rec || rec.historicalRiskClass === filter.risk) return null;
        return (
          <div className="baharoute-explore__mismatch" role="status" data-testid="hist-risk-mismatch">
            <p>
              {rec.name} — historical susceptibility:{' '}
              <strong>{rec.historicalRiskClass}</strong>
            </p>
            <p className="baharoute-explore__mismatch-sub">Current filter: {filter.risk}</p>
            <button
              type="button"
              className="baharoute-explore__clear baharoute-focus-ring"
              data-testid="hist-clear-risk"
              onClick={() => set({ risk: 'all' })}
            >
              Clear risk filter
            </button>
          </div>
        );
      })()}

      {/* NCR overview summary (compact). */}
      {filter.view === 'ncr' && (
        <div className="baharoute-explore__summary" data-testid="explore-ncr-summary">
          <p className="baharoute-explore__summary-title">Metro Manila / NCR</p>
          <p className="baharoute-explore__summary-sub">{totals.total} barangays</p>
          <DistributionBar
            segments={[
              { key: 'h', label: 'High', count: totals.high, color: distColors.High },
              { key: 'm', label: 'Moderate', count: totals.moderate, color: distColors.Moderate },
              { key: 'l', label: 'Low', count: totals.low, color: distColors.Low },
              { key: 'u', label: 'Unknown', count: totals.unknown, color: distColors.Unknown },
            ]}
          />
          <dl className="baharoute-explore__counts">
            <div><dt>High</dt><dd data-testid="ncr-high">{totals.high}</dd></div>
            <div><dt>Moderate</dt><dd data-testid="ncr-moderate">{totals.moderate}</dd></div>
            <div><dt>Low</dt><dd data-testid="ncr-low">{totals.low}</dd></div>
            <div><dt>Unknown</dt><dd data-testid="ncr-unknown">{totals.unknown}</dd></div>
          </dl>
        </div>
      )}

      {/* City / LGU summary. */}
      {filter.view !== 'ncr' && selectedCity && (
        <div className="baharoute-explore__summary" data-testid="explore-city-summary">
          <p className="baharoute-explore__summary-title">{selectedCity.cityName}</p>
          <p className="baharoute-explore__summary-sub">Historical flood exposure</p>
          <DistributionBar
            segments={[
              { key: 'h', label: 'High', count: selectedCity.highCount, color: distColors.High },
              { key: 'm', label: 'Moderate', count: selectedCity.moderateCount, color: distColors.Moderate },
              { key: 'l', label: 'Low', count: selectedCity.lowCount, color: distColors.Low },
              { key: 'u', label: 'Unknown', count: selectedCity.unknownCount, color: distColors.Unknown },
            ]}
          />
          <dl className="baharoute-explore__counts">
            <div><dt>Barangays</dt><dd data-testid="city-total">{selectedCity.barangayCount}</dd></div>
            <div><dt>High</dt><dd data-testid="city-high">{selectedCity.highCount}</dd></div>
            <div><dt>Moderate</dt><dd data-testid="city-moderate">{selectedCity.moderateCount}</dd></div>
            <div><dt>Low</dt><dd data-testid="city-low">{selectedCity.lowCount}</dd></div>
            <div><dt>Unknown</dt><dd data-testid="city-unknown">{selectedCity.unknownCount}</dd></div>
          </dl>
          <p className="baharoute-explore__summary-sub">
            Flood-exposed area {selectedCity.totalExposedAreaKm2.toFixed(1)} km²
          </p>
          {filter.view === 'city' && onOpenBarangay && cityBarangays.length > 0 && (
            <button
              type="button"
              className="baharoute-explore__viewbrgy baharoute-focus-ring"
              data-testid="explore-view-barangays"
              onClick={() => set({ view: 'barangay' })}
            >
              View barangays
            </button>
          )}
        </div>
      )}

      <p className="baharoute-explore__provenance" data-testid="explore-provenance">
        {historicalDatasetMeta.source} · {historicalDatasetMeta.returnPeriod} ·{' '}
        {historicalDatasetMeta.license}
      </p>
      <Disclaimer variant="susceptibility" />
    </section>
  );
}

export default HistoricalExplorePanel;
