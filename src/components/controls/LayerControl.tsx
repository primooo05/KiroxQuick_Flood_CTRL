// src/components/controls/LayerControl.tsx
//
// The Layer_Control lists every available Data_Layer uniformly, one toggle per
// layer (design → Components: `LayerControl`, Req 9).
//
// Behavior:
// - Renders one entry per provided DataLayerMeta, in the order given. Every
//   layer — flood, route, evacuation-center, boundaries — is exposed through the
//   SAME toggle interaction, so future layers are added as additional entries
//   without introducing a different control (Req 9.1, 9.4).
// - Each entry is a real <input type="checkbox"> with an associated <label>
//   text (the meta.label). On/off state is conveyed by the native checkbox
//   state plus text, never by color alone (Req 9.5, 11.4). The checkbox is
//   keyboard-operable and carries an accessible name via the label association
//   (Req 11.1–11.3).
// - Toggling an entry calls `onToggle(id, newVisible)` synchronously; the parent
//   wires this to LayerRegistry.setVisibility, which shows/hides the layer. The
//   500 ms rendering budget (Req 9.2) is a MapLibre/registry concern — the
//   control just fires the callback.
// - An empty layers list renders an empty list with a subtle "No layers" note
//   and NO error/alert (Req 9.3).
// - Each toggle manages its own checked state, seeded from `meta.defaultVisible`
//   (or an optional `initialVisibility` override), so the checkbox reflects the
//   current on/off state locally while still notifying the parent.

import { useState, type CSSProperties } from 'react';
import type { DataLayerMeta, LayerId } from '../../types/layer';

/** A named group of layers (e.g. "Current" / "Reference"). */
export interface LayerGroup {
  /** Group heading text. */
  title: string;
  /** The layers in this group, in display order. */
  layers: DataLayerMeta[];
}

export interface LayerControlProps {
  /** Every available Data_Layer, listed uniformly (Req 9.1, 9.4). */
  layers: DataLayerMeta[];
  /**
   * Optional grouped presentation (Phase 2, Req 5). When provided, the control
   * renders labeled sections instead of one flat list. `layers` is still used
   * for the empty-state check and as a fallback when `groups` is absent.
   */
  groups?: LayerGroup[];
  /**
   * Invoked when the user toggles a layer entry. The parent wires this to
   * LayerRegistry.setVisibility(id, visible) (Req 9.2).
   */
  onToggle: (id: LayerId, visible: boolean) => void;
  /**
   * Optional initial visibility override per layer id. When a layer id is
   * absent from this map, the entry seeds its state from `meta.defaultVisible`.
   */
  initialVisibility?: Partial<Record<LayerId, boolean>>;
  /**
   * Optional compact status text per layer id (e.g. "⚠ unavailable" beside
   * Flood Risk when its live source is down). Kept subtle; no fabricated data.
   */
  statusById?: Partial<Record<LayerId, string>>;
  /**
   * Optional neutral hint shown when no layer is enabled (empty map state),
   * e.g. "Select a layer to explore flood conditions."
   */
  hint?: string;
  /** Optional extra class appended to the container for layout/positioning. */
  className?: string;
}

const listStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
};

const itemLabelStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  cursor: 'pointer',
};

/**
 * Resolves the initial checked state for a layer: the explicit override when
 * present, otherwise the layer's `defaultVisible`.
 */
function initialCheckedFor(
  meta: DataLayerMeta,
  overrides: Partial<Record<LayerId, boolean>> | undefined,
): boolean {
  const override = overrides?.[meta.id];
  return override === undefined ? meta.defaultVisible : override;
}

/** A single labeled layer toggle. Manages its own checked state locally. */
function LayerToggle({
  meta,
  initialChecked,
  onToggle,
  status,
}: {
  meta: DataLayerMeta;
  initialChecked: boolean;
  onToggle: (id: LayerId, visible: boolean) => void;
  status?: string;
}) {
  const [checked, setChecked] = useState(initialChecked);
  const checkboxId = `baharoute-layer-toggle-${meta.id}`;
  // The visible UI no longer shows redundant "On"/"Off" text (Phase 2, Req 5) —
  // the native checkbox conveys state. We keep the state as VISUALLY-HIDDEN text
  // so it remains available to assistive tech (non-color cue, Req 11.4).
  const stateText = checked ? 'On' : 'Off';

  return (
    <li className="baharoute-layer-item" data-testid={`layer-item-${meta.id}`}>
      <label htmlFor={checkboxId} style={itemLabelStyle}>
        <input
          id={checkboxId}
          type="checkbox"
          className="baharoute-layer-checkbox baharoute-focus-ring"
          data-testid={`layer-checkbox-${meta.id}`}
          // Prefer the longer descriptive name for assistive tech; the visible
          // label can be shorter (Phase 3, Req 7).
          aria-label={meta.ariaLabel ?? meta.label}
          checked={checked}
          onChange={(event) => {
            const next = event.target.checked;
            setChecked(next);
            onToggle(meta.id, next);
          }}
        />
        <span className="baharoute-layer-label">{meta.label}</span>
        {status && (
          <span
            className="baharoute-layer-status"
            data-testid={`layer-status-note-${meta.id}`}
          >
            {status}
          </span>
        )}
        <span
          className="baharoute-visually-hidden"
          data-testid={`layer-state-${meta.id}`}
        >
          {stateText}
        </span>
      </label>
    </li>
  );
}

/**
 * Renders the accessible layer-toggle list. Presentation only — visibility
 * state is applied to the map by the parent via `onToggle`.
 */
export function LayerControl({
  layers,
  groups,
  onToggle,
  initialVisibility,
  statusById,
  hint,
  className,
}: LayerControlProps) {
  const containerClass = className
    ? `baharoute-layer-control ${className}`
    : 'baharoute-layer-control';

  const renderList = (items: DataLayerMeta[]) => (
    <ul className="baharoute-layer-list" style={listStyle}>
      {items.map((meta) => (
        <LayerToggle
          key={meta.id}
          meta={meta}
          initialChecked={initialCheckedFor(meta, initialVisibility)}
          onToggle={onToggle}
          status={statusById?.[meta.id]}
        />
      ))}
    </ul>
  );

  return (
    <div
      className={containerClass}
      data-testid="layer-control"
      role="group"
      aria-label="Map layers"
    >
      {layers.length === 0 ? (
        // Empty list: no error, no toggles — just a subtle note (Req 9.3).
        <p className="baharoute-layer-empty" data-testid="layer-control-empty">
          No layers
        </p>
      ) : groups && groups.length > 0 ? (
        groups.map((group) => (
          <section
            key={group.title}
            className="baharoute-layer-group"
            data-testid={`layer-group-${group.title.toLowerCase()}`}
          >
            <h3 className="baharoute-layer-group__title">{group.title}</h3>
            {renderList(group.layers)}
          </section>
        ))
      ) : (
        renderList(layers)
      )}
      {hint && (
        <p className="baharoute-layer-hint" data-testid="layer-control-hint">
          {hint}
        </p>
      )}
    </div>
  );
}

export default LayerControl;
