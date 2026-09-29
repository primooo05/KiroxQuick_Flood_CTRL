// src/components/controls/RotateControl.tsx
//
// On-screen rotation control giving users discoverable 360° map rotation
// (rotation is also available by right-drag on desktop and two-finger twist on
// touch). Three accessible buttons: rotate counter-clockwise, a compass that
// shows the current bearing and resets to north when activated, and rotate
// clockwise. The parent (MapView) wires these to MapManager.rotateBy /
// resetNorth.
//
// Accessibility: real <button>s with fixed accessible names; the compass needle
// is decorative and rotated to reflect `bearing`. The compass button announces
// the current heading so it is not conveyed by the needle rotation alone.

import { CompassIcon, RotateLeftIcon, RotateRightIcon } from './icons';

export interface RotateControlProps {
  /** Current map bearing in degrees [0, 360). 0 = north. */
  bearing: number;
  /** Rotate by a signed delta (positive = clockwise). */
  onRotate: (deltaDeg: number) => void;
  /** Reset the map to north (bearing 0). */
  onResetNorth: () => void;
  /** Degrees per rotate-button press. Default 45°. */
  stepDeg?: number;
  className?: string;
}

/** Rounds a bearing to the nearest degree in [0, 359] for display. */
function displayBearing(bearing: number): number {
  return Math.round(((bearing % 360) + 360) % 360) % 360;
}

export function RotateControl({
  bearing,
  onRotate,
  onResetNorth,
  stepDeg = 45,
  className,
}: RotateControlProps) {
  const deg = displayBearing(bearing);
  const atNorth = deg === 0;

  return (
    <div
      className={['baharoute-rotate-control', className].filter(Boolean).join(' ')}
      role="group"
      aria-label="Rotate map"
      data-testid="rotate-control"
    >
      <button
        type="button"
        className="baharoute-control baharoute-round-button baharoute-focus-ring"
        aria-label="Rotate counter-clockwise"
        title="Rotate counter-clockwise"
        data-testid="rotate-ccw"
        onClick={() => onRotate(-stepDeg)}
      >
        <span aria-hidden="true">
          <RotateLeftIcon />
        </span>
      </button>

      <button
        type="button"
        className="baharoute-control baharoute-round-button baharoute-focus-ring"
        // Announce the heading + action, since the needle rotation is visual.
        aria-label={
          atNorth ? 'Facing north' : `Bearing ${deg} degrees. Reset to north`
        }
        title={atNorth ? 'Facing north' : 'Reset to north'}
        aria-disabled={atNorth}
        data-testid="rotate-compass"
        onClick={() => {
          if (!atNorth) onResetNorth();
        }}
      >
        {/* The needle rotates opposite the bearing so it keeps pointing to true
            north as the map rotates (Mapbox compass convention). */}
        <span
          aria-hidden="true"
          className="baharoute-rotate-control__needle"
          style={{ transform: `rotate(${-deg}deg)` }}
          data-testid="rotate-compass-needle"
        >
          <CompassIcon />
        </span>
      </button>

      <button
        type="button"
        className="baharoute-control baharoute-round-button baharoute-focus-ring"
        aria-label="Rotate clockwise"
        title="Rotate clockwise"
        data-testid="rotate-cw"
        onClick={() => onRotate(stepDeg)}
      >
        <span aria-hidden="true">
          <RotateRightIcon />
        </span>
      </button>
    </div>
  );
}

export default RotateControl;
