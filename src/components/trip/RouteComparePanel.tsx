// src/components/trip/RouteComparePanel.tsx
//
// Step 2 of the trip flow: COMPARE. Given the compared route options (from
// services/routePlanning.compareRoutes), the commuter sees one card per route
// with the decision-relevant facts and picks one to Start.
//
// Each card shows: a recommendation label (Recommended / Lower-risk alternative
// / Higher flood exposure / Alternative / Current information unavailable), ETA,
// distance, aggregate flood-risk status, rainfall trend, higher-risk segment
// count, community report count, confirmed closure count, data freshness, and a
// concise "Why this route?" list. A route is NEVER called "safe".
//
// The single Start button (on the selected card) is the ONLY entry into Driver
// Mode. Pure presentational: all data + the clock come from props.

import { useState } from 'react';
import type { RouteOption } from '../../services/routePlanning';
import { currentRiskLabel, rainfallTrendLabel } from '../../layers/riskLabels';
import { isDataQualityState } from '../../types/risk';
import { formatDistance, formatDuration } from '../../simulation/navigation';

export interface RouteComparePanelProps {
  /** Compared options (already scored + labeled) to display, best first. */
  options: readonly RouteOption[];
  /** Start Driver Mode for the chosen option. The only Driver Mode entry. */
  onStart: (option: RouteOption) => void;
  /** Go back to the search step. */
  onBack: () => void;
  /**
   * Data freshness line for the whole comparison, e.g. "Updated 3 minutes ago".
   * Provided by the parent from the risk controller status.
   */
  freshnessLabel?: string | null;
  /**
   * Controlled selection: the currently selected route id. When provided (with
   * {@link onSelect}) the parent owns selection so the map route-line emphasis
   * and the card highlight stay in sync. When omitted, the panel manages its
   * own selection internally (preselecting the first/recommended option).
   */
  selectedId?: string | null;
  /** Called when the user selects a route card (controlled mode). */
  onSelect?: (id: string) => void;
  /** Injectable clock for ETA (tests). */
  now?: () => Date;
}

/** Commuter-facing label for a recommendation. Never says "safe". */
const RECOMMENDATION_LABELS: Record<RouteOption['recommendation'], string> = {
  recommended: 'Recommended',
  lowerRiskAlternative: 'Lower-risk alternative',
  higherFloodExposure: 'Higher flood exposure',
  alternative: 'Alternative',
  unavailable: 'Current information unavailable',
};

/** Public helper (also used by tests) for the recommendation label text. */
export function recommendationLabel(rec: RouteOption['recommendation']): string {
  return RECOMMENDATION_LABELS[rec];
}

function etaText(durationS: number, now: () => Date): string {
  return new Date(now().getTime() + durationS * 1000).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Renders the route comparison cards + Start action. */
export function RouteComparePanel({
  options,
  onStart,
  onBack,
  freshnessLabel = null,
  selectedId: controlledSelectedId,
  onSelect,
  now = () => new Date(),
}: RouteComparePanelProps) {
  // Uncontrolled fallback: preselect the first (best-balanced) option.
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(
    options.length > 0 ? options[0].candidate.id : null,
  );
  const isControlled = controlledSelectedId !== undefined;
  const selectedId = isControlled ? controlledSelectedId : internalSelectedId;
  const selectId = (id: string): void => {
    if (isControlled) onSelect?.(id);
    else setInternalSelectedId(id);
  };

  const selected =
    options.find((o) => o.candidate.id === selectedId) ?? options[0] ?? null;

  return (
    <section
      className="baharoute-trip-panel baharoute-compare-panel"
      aria-label="Compare routes"
      data-testid="route-compare-panel"
    >
      <header className="baharoute-trip-panel__header">
        <button
          type="button"
          className="baharoute-trip-panel__back baharoute-focus-ring"
          onClick={onBack}
          aria-label="Back to search"
        >
          ← Back
        </button>
        <h2 className="baharoute-trip-panel__title">Choose a route</h2>
        {freshnessLabel && (
          <p className="baharoute-trip-panel__subtitle" data-testid="compare-freshness">
            Flood information: {freshnessLabel}
          </p>
        )}
      </header>

      <ul className="baharoute-route-cards" role="radiogroup" aria-label="Available routes">
        {options.map((option) => {
          const { candidate, risk, recommendation, reasons } = option;
          const isSelected = candidate.id === selected?.candidate.id;
          const riskText = isDataQualityState(risk.level)
            ? 'Current information unavailable'
            : currentRiskLabel(risk.level);
          return (
            <li key={candidate.id}>
              <button
                type="button"
                role="radio"
                aria-checked={isSelected}
                className={`baharoute-route-card baharoute-focus-ring${
                  isSelected ? ' baharoute-route-card--selected' : ''
                }`}
                onClick={() => selectId(candidate.id)}
                data-testid={`route-card-${candidate.id}`}
              >
                <div className="baharoute-route-card__top">
                  <span
                    className={`baharoute-route-card__badge baharoute-route-card__badge--${recommendation}`}
                    data-testid={`route-badge-${candidate.id}`}
                  >
                    {recommendationLabel(recommendation)}
                  </span>
                  <span className="baharoute-route-card__label">{candidate.label}</span>
                </div>

                <div className="baharoute-route-card__primary">
                  <span className="baharoute-route-card__eta">
                    {formatDuration(candidate.durationS)}
                  </span>
                  <span className="baharoute-route-card__sep" aria-hidden="true">
                    ·
                  </span>
                  <span className="baharoute-route-card__distance">
                    {formatDistance(candidate.distanceM)}
                  </span>
                  <span className="baharoute-route-card__sep" aria-hidden="true">
                    ·
                  </span>
                  <span className="baharoute-route-card__arrive">
                    ETA {etaText(candidate.durationS, now)}
                  </span>
                </div>

                <dl className="baharoute-route-card__facts">
                  <div className="baharoute-route-card__fact">
                    <dt>Flood risk</dt>
                    <dd data-testid={`route-risk-${candidate.id}`}>{riskText}</dd>
                  </div>
                  <div className="baharoute-route-card__fact">
                    <dt>Rainfall</dt>
                    <dd>{rainfallTrendLabel(risk.trend)}</dd>
                  </div>
                  <div className="baharoute-route-card__fact">
                    <dt>Higher-risk segments</dt>
                    <dd>{risk.higherRiskSegments}</dd>
                  </div>
                  <div className="baharoute-route-card__fact">
                    <dt>Community reports</dt>
                    <dd>{risk.reportCount}</dd>
                  </div>
                  <div className="baharoute-route-card__fact">
                    <dt>Confirmed closures</dt>
                    <dd>{risk.closureCount}</dd>
                  </div>
                </dl>

                {reasons.length > 0 && (
                  <div className="baharoute-route-card__why">
                    <span className="baharoute-route-card__why-title">Why this route?</span>
                    <ul>
                      {reasons.map((r) => (
                        <li key={r.key}>{r.text}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className="baharoute-trip-panel__primary baharoute-focus-ring"
        onClick={() => selected && onStart(selected)}
        disabled={!selected}
        data-testid="start-route-button"
      >
        Start
      </button>
    </section>
  );
}

export default RouteComparePanel;
