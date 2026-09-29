// src/components/driving/DrivingHud.tsx
//
// Driving-mode UI shown only while the simulated drive runs:
//   - top banner: next maneuver arrow, distance to it, instruction
//   - hazard chip: nearest DEMO flood report ahead (labeled demo/unconfirmed)
//   - bottom bar: remaining distance/time, ETA, camera + 3D radius options, Stop
//
// Pure presentational: all values come from props (see simulation/navigation).
// Accessibility: the banner is a polite live region (turn changes announced),
// options are real buttons with aria-pressed, and hazard severity is given as
// text (not color alone).

import type { ReactNode } from 'react';
import { FLOOD_STATE_COLORS } from '../../map/basemap/colorTokens';
import { floodStateLabel } from '../../layers/visualMapping';
import { DRIVE_HAZARDS_SOURCE_LABEL } from '../../data/fixtures/driveHazards';
import {
  formatDistance,
  formatDuration,
  maneuverRotation,
  maneuverText,
  type NavState,
} from '../../simulation/navigation';
import { DRIVE_RADIUS_OPTIONS, type DriveCameraMode, type DriveRadius } from '../../map/MapManager';

export interface DrivingHudProps {
  nav: NavState;
  camera: DriveCameraMode;
  radius: DriveRadius;
  onCameraChange: (mode: DriveCameraMode) => void;
  onRadiusChange: (radius: DriveRadius) => void;
  onStop: () => void;
  /** Injectable clock for the ETA (tests). */
  now?: () => Date;
  /** Optional prompt (e.g. reroute choice) shown under the turn banner. */
  children?: ReactNode;
}

const CAMERA_LABELS: Record<DriveCameraMode, string> = {
  driver: 'Driver',
  follow: 'Follow',
};

export function DrivingHud({
  nav,
  camera,
  radius,
  onCameraChange,
  onRadiusChange,
  onStop,
  now = () => new Date(),
  children,
}: DrivingHudProps) {
  const rotation = maneuverRotation(nav.next);
  const eta = new Date(now().getTime() + nav.remainingS * 1000).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <div className="baharoute-drive-hud" data-testid="driving-hud">
      <section className="baharoute-drive-banner" aria-label="Next maneuver" aria-live="polite">
        <span className="baharoute-drive-banner__icon" aria-hidden="true">
          {rotation === null ? (
            '◎'
          ) : (
            <span style={{ display: 'inline-block', transform: `rotate(${rotation}deg)` }}>↑</span>
          )}
        </span>
        <div className="baharoute-drive-banner__text">
          <strong className="baharoute-drive-banner__distance">
            {formatDistance(nav.toNextM)}
          </strong>
          <span className="baharoute-drive-banner__instruction">{maneuverText(nav.next)}</span>
        </div>
      </section>

      {/* A pending route choice replaces the hazard chip. */}
      {children}

      {!children && nav.hazard && (
        <div
          className="baharoute-drive-hazard"
          role="status"
          style={{ borderLeftColor: FLOOD_STATE_COLORS[nav.hazard.state].hex }}
        >
          <span
            className="baharoute-drive-hazard__dot"
            aria-hidden="true"
            style={{ background: FLOOD_STATE_COLORS[nav.hazard.state].hex }}
          />
          <span>
            <strong>{floodStateLabel(nav.hazard.state)}</strong> ahead ·{' '}
            {formatDistance(nav.toHazardM)} · {nav.hazard.street}
            <small className="baharoute-drive-hazard__source">{DRIVE_HAZARDS_SOURCE_LABEL}</small>
          </span>
        </div>
      )}

      <section className="baharoute-drive-bar" aria-label="Trip progress and options">
        <div className="baharoute-drive-bar__trip">
          <strong>{formatDuration(nav.remainingS)}</strong>
          <span>
            {formatDistance(nav.remainingM)} · ETA {eta}
          </span>
        </div>
        <div className="baharoute-drive-bar__options">
          <div role="group" aria-label="Camera" className="baharoute-segmented">
            {(['driver', 'follow'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className="baharoute-segmented__option baharoute-focus-ring"
                aria-pressed={camera === mode}
                onClick={() => onCameraChange(mode)}
              >
                {CAMERA_LABELS[mode]}
              </button>
            ))}
          </div>
          <div role="group" aria-label="3D radius" className="baharoute-segmented">
            {DRIVE_RADIUS_OPTIONS.map((r) => (
              <button
                key={r}
                type="button"
                className="baharoute-segmented__option baharoute-focus-ring"
                aria-pressed={radius === r}
                aria-label={`3D radius ${r} meters`}
                onClick={() => onRadiusChange(r)}
              >
                {r} m
              </button>
            ))}
          </div>
          <button
            type="button"
            className="baharoute-drive-bar__stop baharoute-focus-ring"
            onClick={onStop}
          >
            Stop
          </button>
        </div>
      </section>
    </div>
  );
}

export default DrivingHud;
