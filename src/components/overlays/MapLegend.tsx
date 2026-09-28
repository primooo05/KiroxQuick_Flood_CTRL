// src/components/overlays/MapLegend.tsx
//
// Enhancement: a collapsible on-map legend explaining the flood colors.
// Collapsed by default. Every swatch is paired with a text label so meaning
// never relies on color alone, and Unknown is framed as "no data", never
// as low risk (docs/FLOOD_SEMANTICS.md). Colors come from the canonical reserved
// tokens so the legend cannot drift from the map layers.

import { useId, useState } from 'react';
import {
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

const ENTRIES: readonly LegendEntry[] = [
  { key: 'high', label: 'High', color: SUSCEPTIBILITY_COLORS.HIGH.hex },
  { key: 'moderate', label: 'Moderate', color: SUSCEPTIBILITY_COLORS.MODERATE.hex },
  { key: 'low', label: 'Low', color: SUSCEPTIBILITY_COLORS.LOW.hex },
  {
    key: 'unknown',
    label: 'Unknown',
    hint: "No data. Don't assume it's flood-free.",
    color: FLOOD_STATE_COLORS.GRAY.hex,
    hatched: true,
  },
];

export interface MapLegendProps {
  /** Initial expanded state. Defaults to collapsed. */
  defaultExpanded?: boolean;
}

export function MapLegend({ defaultExpanded = false }: MapLegendProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const bodyId = useId();

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
        <span>Flood susceptibility</span>
        <span aria-hidden="true" className="baharoute-legend__chevron">
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      <div id={bodyId} className="baharoute-legend__body" hidden={!expanded}>
        <ul className="baharoute-legend__list">
          {ENTRIES.map((entry) => (
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
        <p className="baharoute-legend__note">
          Historical/modeled exposure, not live flooding.
        </p>
      </div>
    </section>
  );
}

export default MapLegend;
