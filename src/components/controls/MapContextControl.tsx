// src/components/controls/MapContextControl.tsx
//
// The MAP CONTEXT selector: switches the map PRESENTATION between the strict
// NCR-only view (default) and a nearby-areas view. Presentation only — the
// parent (MapView) wires the choice to MapManager.setMapContext(), which
// toggles the outside-NCR mask, basemap place labels, and camera bounds. It
// NEVER changes thematic flood data, which stays NCR-only in both modes.
//
// Rendered as an accessible radiogroup (two radios) so the on/off state is
// conveyed by native semantics + text, not color alone.

import type { MapContext } from '../../map/MapManager';

export interface MapContextControlProps {
  /** The currently selected context mode. */
  value: MapContext;
  /** Called with the requested mode when the user picks a different option. */
  onChange: (next: MapContext) => void;
  className?: string;
}

const OPTIONS: ReadonlyArray<{ value: MapContext; label: string }> = [
  { value: 'ncr-only', label: 'NCR only' },
  { value: 'nearby', label: 'Show nearby areas' },
];

export function MapContextControl({
  value,
  onChange,
  className,
}: MapContextControlProps) {
  return (
    <section
      className={['baharoute-map-context', className].filter(Boolean).join(' ')}
      data-testid="map-context-control"
    >
      <h3 className="baharoute-map-context__title" id="baharoute-map-context-title">
        Map context
      </h3>
      <div
        role="radiogroup"
        aria-labelledby="baharoute-map-context-title"
        className="baharoute-map-context__options"
      >
        {OPTIONS.map((opt) => {
          const id = `baharoute-map-context-${opt.value}`;
          const checked = value === opt.value;
          return (
            <label key={opt.value} htmlFor={id} className="baharoute-map-context__option">
              <input
                id={id}
                type="radio"
                name="baharoute-map-context"
                className="baharoute-focus-ring"
                data-testid={`map-context-${opt.value}`}
                value={opt.value}
                checked={checked}
                onChange={() => onChange(opt.value)}
              />
              <span>{opt.label}</span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

export default MapContextControl;
