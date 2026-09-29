// src/components/overlays/MapLegend.tsx
//
// A collapsible on-map legend. It now explains TWO distinct color families,
// kept visually and textually separate so users never read historical exposure
// as current flooding (docs/FLOOD_SEMANTICS.md):
//   1. Current Flood Risk — near-real-time estimated risk per barangay.
//   2. Baseline Flood Susceptibility — historical/modeled exposure (reference).
// Collapsed by default. Every swatch has a text label so meaning never relies
// on color alone, and Unknown is framed as "no data". Colors come from the
// canonical reserved tokens so the legend cannot drift from the map layers.

import { useId, useState } from 'react';
import {
  CURRENT_RISK_COLORS,
  FLOOD_STATE_COLORS,
  SUSCEPTIBILITY_COLORS,
} from '../../map/basemap/colorTokens';

interface LegendEntry {
  key: string;
  label: string;
  hint?: string;
  color: string;
  hatched?: boolean;
}

/** Current-risk color ramp (the primary, near-real-time layer). */
const CURRENT_RISK_ENTRIES: readonly LegendEntry[] = [
  { key: 'cr-low', label: 'Low', color: CURRENT_RISK_COLORS.LOW.hex },
  { key: 'cr-elevated', label: 'Elevated', color: CURRENT_RISK_COLORS.ELEVATED.hex },
  { key: 'cr-high', label: 'High', color: CURRENT_RISK_COLORS.HIGH.hex },
  {
    key: 'cr-likely',
    label: 'Likely flooding',
    color: CURRENT_RISK_COLORS.LIKELY_FLOODING.hex,
  },
  {
    key: 'cr-reported',
    label: 'Reported flooding',
    color: CURRENT_RISK_COLORS.REPORTED_FLOODING.hex,
  },
  {
    key: 'cr-notpassable',
    label: 'Confirmed closure',
    hint: 'Official confirmation only.',
    color: CURRENT_RISK_COLORS.CONFIRMED_NOT_PASSABLE.hex,
  },
  {
    key: 'cr-unknown',
    label: 'Data unavailable / stale',
    hint: 'No current data. Not a low-risk reading.',
    color: CURRENT_RISK_COLORS.UNKNOWN.hex,
    hatched: true,
  },
];

/** Baseline (historical) susceptibility color family (reference layer). */
const BASELINE_ENTRIES: readonly LegendEntry[] = [
  { key: 'b-high', label: 'High', color: SUSCEPTIBILITY_COLORS.HIGH.hex },
  { key: 'b-moderate', label: 'Moderate', color: SUSCEPTIBILITY_COLORS.MODERATE.hex },
  { key: 'b-low', label: 'Low', color: SUSCEPTIBILITY_COLORS.LOW.hex },
  {
    key: 'b-unknown',
    label: 'Unknown',
    hint: "No data. Don't assume it's flood-free.",
    color: FLOOD_STATE_COLORS.GRAY.hex,
    hatched: true,
  },
];

function LegendList({ entries }: { entries: readonly LegendEntry[] }) {
  return (
    <ul className="baharoute-legend__list">
      {entries.map((entry) => (
        <li key={entry.key} className="baharoute-legend__item">
          <span
            aria-hidden="true"
            className={
              entry.hatched
                ? 'baharoute-legend__swatch baharoute-legend__swatch--hatched'
                : 'baharoute-legend__swatch'
            }
            style={{ backgroundColor: entry.color }}
          />
          <span className="baharoute-legend__label">{entry.label}</span>
          {entry.hint && (
            <span className="baharoute-legend__hint">{entry.hint}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export interface MapLegendProps {
  /** Initial expanded state. Defaults to expanded. */
  defaultExpanded?: boolean;
  /**
   * Show the Current Flood Risk section. Legends appear ONLY for enabled layers
   * (Phase 4), so the parent passes whether each layer is currently on.
   * Defaults to `true` for backward-compatible standalone usage/tests.
   */
  showCurrent?: boolean;
  /** Show the Historical Flood Susceptibility section. */
  showHistorical?: boolean;
}

export function MapLegend({
  defaultExpanded = true,
  showCurrent = true,
  showHistorical = false,
}: MapLegendProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  // When both layers are on, current is primary and historical is a collapsed
  // secondary sub-section. When only historical is on, it is shown directly.
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const bodyId = useId();
  const historyId = useId();

  // Nothing enabled → render nothing (defensive; the parent also gates this).
  if (!showCurrent && !showHistorical) return null;

  // Historical-only mode: show the historical legend as the primary content.
  if (!showCurrent && showHistorical) {
    return (
      <section
        className="baharoute-legend"
        data-testid="map-legend"
        aria-label="Map legend"
      >
        <button
          type="button"
          className="baharoute-legend__toggle baharoute-focus-ring"
          data-testid="map-legend-toggle"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded((value) => !value)}
        >
          <span>Historical Flood Susceptibility</span>
          <span aria-hidden="true" className="baharoute-legend__chevron">
            {expanded ? '▾' : '▸'}
          </span>
        </button>
        <div id={bodyId} className="baharoute-legend__body" hidden={!expanded}>
          <LegendList entries={BASELINE_ENTRIES} />
          <p className="baharoute-legend__note">
            Reference / historical data — modeled exposure, not live flooding.
          </p>
        </div>
      </section>
    );
  }

  // Current is on (optionally with historical as a secondary sub-section).
  return (
    <section
      className="baharoute-legend"
      data-testid="map-legend"
      aria-label="Map legend"
    >
      <button
        type="button"
        className="baharoute-legend__toggle baharoute-focus-ring"
        data-testid="map-legend-toggle"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span>Current Flood Risk</span>
        <span aria-hidden="true" className="baharoute-legend__chevron">
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      <div id={bodyId} className="baharoute-legend__body" hidden={!expanded}>
        <LegendList entries={CURRENT_RISK_ENTRIES} />
        <p className="baharoute-legend__note">
          Near-real-time estimate from model-based rainfall.
        </p>

        {/* Historical legend only appears when the Historical layer is on. */}
        {showHistorical && (
          <>
            <button
              type="button"
              className="baharoute-legend__subtoggle baharoute-focus-ring"
              data-testid="map-legend-history-toggle"
              aria-expanded={historyExpanded}
              aria-controls={historyId}
              onClick={() => setHistoryExpanded((v) => !v)}
            >
              <span>Historical Flood Susceptibility</span>
              <span aria-hidden="true" className="baharoute-legend__chevron">
                {historyExpanded ? '▾' : '▸'}
              </span>
            </button>
            <div id={historyId} hidden={!historyExpanded}>
              <LegendList entries={BASELINE_ENTRIES} />
              <p className="baharoute-legend__note">
                Historical/modeled exposure, not live flooding.
              </p>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

export default MapLegend;
