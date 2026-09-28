// src/components/controls/ViewModeControl.tsx
//
// 2D/3D toggle. A thin, accessible toggle button: it reports the requested
// mode through `onToggle`; the parent (MapView) wires that to
// MapManager.set3D(), which tilts the camera and shows Mapbox Standard's 3D
// buildings (clipped to Metro Manila).
//
// Accessibility: a real <button> with a fixed accessible name and
// `aria-pressed` for the on/off state, a visible "3D" text glyph, and a
// pressed style that uses an outline as well as color (not color alone).
// Touch target is at least 44×44 CSS px via the shared round-button class.

export interface ViewModeControlProps {
  /** Whether the 3D view is currently on. */
  is3D: boolean;
  /** Called with the requested next state when the button is activated. */
  onToggle: (next: boolean) => void;
}

export function ViewModeControl({ is3D, onToggle }: ViewModeControlProps) {
  const label = '3D view';
  return (
    <button
      type="button"
      className="baharoute-control baharoute-round-button baharoute-view-mode-control baharoute-focus-ring"
      aria-label={label}
      aria-pressed={is3D}
      title={is3D ? 'Switch to 2D view' : 'Switch to 3D view'}
      onClick={() => onToggle(!is3D)}
    >
      <span aria-hidden="true">3D</span>
    </button>
  );
}

export default ViewModeControl;
