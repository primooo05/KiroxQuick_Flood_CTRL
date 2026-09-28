// src/components/controls/RecenterControl.tsx
//
// RecenterControl (design → Components table, Req 7). An accessible on-screen
// button that, when activated, returns the map view to Metro_Manila_Extent
// within 1000 ms (Req 7.2). The control itself is intentionally thin: it only
// invokes the provided `onRecenter` callback, which the parent (MapView) wires
// to MapManager.recenter() — MapManager already animates within the ≤1000 ms
// budget (see MapManager.recenter, default 800 ms duration).
//
// Safety framing / no-op behavior (Req 7.3): activating the control while the
// map is already framed on Metro_Manila_Extent simply calls `onRecenter` again;
// MapManager.recenter is a no-op-safe fitBounds and never throws, so repeated
// activation is safe.
//
// Accessibility (Req 11.1–11.3, 11.4): rendered as a real <button> so it is
// keyboard-focusable and keyboard-activatable (Enter/Space) by default. It
// carries an accessible name via aria-label and is not distinguished by color
// alone — it pairs a visible text/icon glyph with the label, and exposes a
// visible focus ring token. The touch target is sized to at least 44×44 CSS
// pixels (Req 10.4).

import type { CSSProperties } from 'react';
import { RecenterIcon } from './icons';

export interface RecenterControlProps {
  /**
   * Invoked when the control is activated (click / Enter / Space). The parent
   * wires this to MapManager.recenter(); calling it when already framed is a
   * safe no-op that does not throw (Req 7.3).
   */
  onRecenter: () => void;
  /**
   * Accessible name for the button. Defaults to a descriptive label naming the
   * NCR target so the action is clear without relying on the icon (Req 11.3).
   */
  label?: string;
  /** Optional extra class names appended to the control's base class. */
  className?: string;
}

/** Minimum touch-target size in CSS pixels (Req 10.4). */
const MIN_TOUCH_TARGET_PX = 44;

const baseStyle: CSSProperties = {
  minWidth: MIN_TOUCH_TARGET_PX,
  minHeight: MIN_TOUCH_TARGET_PX,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

/**
 * An accessible recenter button. Activating it returns the map to the
 * Metro_Manila_Extent by invoking {@link RecenterControlProps.onRecenter}.
 */
export function RecenterControl({
  onRecenter,
  label = 'Recenter map to Metro Manila',
  className,
}: RecenterControlProps) {
  const classNames = [
    'baharoute-control',
    'baharoute-round-button',
    'baharoute-recenter-control',
    // Visible focus-ring hook (Task 17, Req 11.2): styled in layout.css.
    'baharoute-focus-ring',
  ];
  if (className) classNames.push(className);

  return (
    <button
      type="button"
      className={classNames.join(' ')}
      aria-label={label}
      title={label}
      onClick={onRecenter}
      style={baseStyle}
    >
      {/* Non-color cue: an icon glyph plus a text label backs the control so it
          is not identified by color alone (Req 11.4). The glyph is decorative;
          the accessible name comes from aria-label. */}
      <span aria-hidden="true" className="baharoute-recenter-control__icon">
        <RecenterIcon />
      </span>
      {/* Enhancement: text kept for assistive tech but visually hidden so the
          control reads as a compact round icon button. */}
      <span className="baharoute-recenter-control__text baharoute-visually-hidden">
        Recenter
      </span>
    </button>
  );
}

export default RecenterControl;
