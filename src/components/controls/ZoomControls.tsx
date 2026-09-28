// src/components/controls/ZoomControls.tsx
//
// On-screen zoom-in / zoom-out controls rendered over the map (design →
// Components: `ZoomControls`, Req 5.4, 5.5).
//
// Behavior:
// - Two real <button> elements, keyboard-operable, each with an accessible name
//   ("Zoom in" / "Zoom out") — Req 11.1, 11.3.
// - Each button is a ≥44×44 CSS px Touch_Target (Req 5.4 / 10.4), enforced via
//   inline minWidth/minHeight sizing so it holds regardless of external CSS.
// - Activation calls the provided `onZoomIn` / `onZoomOut` callbacks. The parent
//   wires these to MapManager.zoomIn / zoomOut, which clamp at the Basemap_Style
//   min/max zoom bounds. Zooming past a limit therefore keeps the level and does
//   not error (Req 5.5) — the control itself only invokes the callback and never
//   throws on its own.
// - A dedicated focus-ring class hook (`baharoute-focus-ring`) plus a
//   :focus-visible outline provides a visible focus indicator (Req 11.2). Task 17
//   will formalize the focus-ring token; the class hook and inline fallback keep
//   focus visible until then.

import type { CSSProperties } from 'react';
import { MinusIcon, PlusIcon } from './icons';

/** Minimum Touch_Target size in CSS pixels (Req 5.4 / 10.4). */
export const MIN_TOUCH_TARGET_PX = 44;

export interface ZoomControlsProps {
  /** Invoked when the user activates zoom-in. Parent wires to MapManager.zoomIn. */
  onZoomIn: () => void;
  /** Invoked when the user activates zoom-out. Parent wires to MapManager.zoomOut. */
  onZoomOut: () => void;
  /** Optional extra class appended to the container for layout/positioning. */
  className?: string;
}

const buttonStyle: CSSProperties = {
  // ≥44×44 CSS px Touch_Target (Req 5.4 / 10.4).
  minWidth: `${MIN_TOUCH_TARGET_PX}px`,
  minHeight: `${MIN_TOUCH_TARGET_PX}px`,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
};

/**
 * Renders accessible zoom-in / zoom-out buttons. Presentation only — all zoom
 * state and clamping live in MapManager, reached through the callbacks.
 */
export function ZoomControls({
  onZoomIn,
  onZoomOut,
  className,
}: ZoomControlsProps) {
  const containerClass = className
    ? `baharoute-zoom-controls ${className}`
    : 'baharoute-zoom-controls';
  // Enhancement: both buttons share one rounded card (baharoute-control-card).

  return (
    <div className={`${containerClass} baharoute-control-card`} data-testid="zoom-controls" role="group" aria-label="Zoom controls">
      <button
        type="button"
        className="baharoute-zoom-in baharoute-focus-ring"
        data-testid="zoom-in"
        aria-label="Zoom in"
        title="Zoom in"
        style={buttonStyle}
        onClick={onZoomIn}
      >
        <PlusIcon />
      </button>
      <button
        type="button"
        className="baharoute-zoom-out baharoute-focus-ring"
        data-testid="zoom-out"
        aria-label="Zoom out"
        title="Zoom out"
        style={buttonStyle}
        onClick={onZoomOut}
      >
        <MinusIcon />
      </button>
    </div>
  );
}

export default ZoomControls;
