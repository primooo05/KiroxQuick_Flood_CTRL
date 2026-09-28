// src/components/overlays/FloodPopup.tsx
//
// A presentational popup for a flood item — a susceptibility area or a flood
// report — shown when the user selects it on the map (design → "Click/tap popup
// for a susceptibility area"; Req 13.1, 13.2, 13.3). Task 10.2 wires it to map
// click events; this file only renders given props.
//
// It shows: Area (name/id), Data type, Susceptibility level (or Flood_State via
// floodStateLabel so GRAY renders "Unknown"), Source, Dataset date / last
// updated (formatted from epoch-seconds updatedAt), and the historical-exposure
// Disclaimer. It contains NO "safe"/"clear"/"no risk" text and NO numeric
// safety score (Req 13.1, 13.2, 13.4).

import type { FloodDataType, FloodState, SusceptibilityLevel } from '../../types/flood';
import { floodStateLabel, susceptibilityLabel } from '../../layers/visualMapping';
import { Disclaimer } from './Disclaimer';
import {
  FLOOD_STATE_COLORS,
  SUSCEPTIBILITY_COLORS,
} from '../../map/basemap/colorTokens';

/** Human-readable label for the data type shown in the popup. */
const DATA_TYPE_LABELS: Record<FloodDataType, string> = {
  SUSCEPTIBILITY: 'Susceptibility',
  REPORT: 'Report',
  COMMUNITY_REPORT: 'Community report',
};

export interface FloodPopupProps {
  /** Area name or identifier (Req: popup "Area" field). */
  area: string;
  /** The flood data type; drives the label and the disclaimer variant. */
  dataType: FloodDataType;
  /**
   * Susceptibility level, present for SUSCEPTIBILITY items. Rendered as the
   * "Susceptibility" row via susceptibilityLabel (High/Moderate/Low).
   */
  level?: SusceptibilityLevel;
  /**
   * Flood_State, present for REPORT / COMMUNITY_REPORT items. Rendered via
   * floodStateLabel so GRAY becomes "Unknown", never "no risk"/"safe"/"clear".
   */
  state?: FloodState;
  /** Data source attribution (Req: popup "Source" field). */
  source: string;
  /** Last-updated / dataset date as epoch seconds (Req: popup "Dataset date"). */
  updatedAt: number;
  className?: string;
}

/**
 * Formats an epoch-seconds timestamp into a human-readable date string. Uses a
 * fixed locale/format so output is stable across environments (jsdom tests).
 */
function formatDatasetDate(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * Presentational popup. Renders a labeled definition list of the item's fields
 * plus the appropriate Disclaimer. For susceptibility items the disclaimer adds
 * the historical/modeled-exposure framing.
 */
export function FloodPopup({
  area,
  dataType,
  level,
  state,
  source,
  updatedAt,
  className,
}: FloodPopupProps) {
  const isSusceptibility = dataType === 'SUSCEPTIBILITY';

  return (
    <section
      className={['baharoute-flood-popup', className].filter(Boolean).join(' ')}
      aria-label={`Flood information for ${area}`}
      data-testid="flood-popup"
    >
      {/* Enhancement: lead with the place and its level so the answer comes
          first; details (source, date) follow. The chip pairs color with text. */}
      <h2 className="baharoute-flood-popup__title" data-testid="flood-popup-area">
        {area}
      </h2>
      {level !== undefined && (
        <p className="baharoute-flood-popup__chip">
          <span
            aria-hidden="true"
            className="baharoute-flood-popup__swatch"
            style={{ backgroundColor: SUSCEPTIBILITY_COLORS[level].hex }}
          />
          {susceptibilityLabel(level)} susceptibility
        </p>
      )}
      {state !== undefined && (
        <p className="baharoute-flood-popup__chip">
          <span
            aria-hidden="true"
            className="baharoute-flood-popup__swatch"
            style={{ backgroundColor: FLOOD_STATE_COLORS[state].hex }}
          />
          {floodStateLabel(state)}
        </p>
      )}
      <dl className="baharoute-flood-popup__fields">

        <dt>Data type</dt>
        <dd data-testid="flood-popup-data-type">{DATA_TYPE_LABELS[dataType]}</dd>

        {level !== undefined ? (
          <>
            <dt>Susceptibility</dt>
            <dd data-testid="flood-popup-susceptibility">
              {susceptibilityLabel(level)}
            </dd>
          </>
        ) : null}

        {state !== undefined ? (
          <>
            <dt>State</dt>
            <dd data-testid="flood-popup-state">{floodStateLabel(state)}</dd>
          </>
        ) : null}

        <dt>Source</dt>
        <dd data-testid="flood-popup-source">{source}</dd>

        <dt>Dataset date / last updated</dt>
        <dd data-testid="flood-popup-updated">{formatDatasetDate(updatedAt)}</dd>
      </dl>

      <Disclaimer variant={isSusceptibility ? 'susceptibility' : 'general'} />
    </section>
  );
}

export default FloodPopup;
