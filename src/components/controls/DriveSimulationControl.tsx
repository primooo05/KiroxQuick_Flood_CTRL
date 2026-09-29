// src/components/controls/DriveSimulationControl.tsx
//
// Demo-only button that starts/stops the simulated PITX → MOA drive. Thin:
// the parent (MapView) owns the simulator and the map calls.
//
// Accessibility: real <button>, `aria-pressed` for the running state, a name
// that says what it does, and a visible glyph (▶ / ■) besides color.

export interface DriveSimulationControlProps {
  running: boolean;
  onToggle: (next: boolean) => void;
}

export function DriveSimulationControl({ running, onToggle }: DriveSimulationControlProps) {
  const label = running ? 'Stop simulated drive' : 'Simulate drive from PITX to MOA';
  return (
    <button
      type="button"
      className="baharoute-control baharoute-round-button baharoute-view-mode-control baharoute-focus-ring"
      aria-label={label}
      aria-pressed={running}
      title={label}
      onClick={() => onToggle(!running)}
    >
      <span aria-hidden="true">{running ? '■' : '▶'}</span>
    </button>
  );
}

export default DriveSimulationControl;
