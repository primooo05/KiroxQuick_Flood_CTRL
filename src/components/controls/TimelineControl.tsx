// src/components/controls/TimelineControl.tsx
//
// A compact short-term risk timeline (Phase 2, Req 7): NOW | +30 MIN | +1 HR.
// Selecting a step updates the displayed barangay risk, the map coloring, and
// the explanation. Forecast steps are clearly labeled estimated; we only offer
// steps the data source can reasonably support (hourly + interpolated 15-min).

import type { TimelineStep } from '../../types/risk';

export interface TimelineControlProps {
  step: TimelineStep;
  onStepChange: (step: TimelineStep) => void;
  className?: string;
}

const STEPS: ReadonlyArray<{ step: TimelineStep; label: string }> = [
  { step: 'now', label: 'Now' },
  { step: 'plus30', label: '+30 min' },
  { step: 'plus60', label: '+1 hr' },
];

export function TimelineControl({
  step,
  onStepChange,
  className,
}: TimelineControlProps) {
  return (
    <div
      className={['baharoute-timeline', className].filter(Boolean).join(' ')}
      role="group"
      aria-label="Flood-risk time"
      data-testid="timeline-control"
    >
      {STEPS.map((s) => (
        <button
          key={s.step}
          type="button"
          className={[
            'baharoute-timeline__step',
            'baharoute-focus-ring',
            s.step === step ? 'baharoute-timeline__step--active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-pressed={s.step === step}
          data-testid={`timeline-step-${s.step}`}
          onClick={() => onStepChange(s.step)}
        >
          {s.label}
        </button>
      ))}
      {step !== 'now' && (
        <span className="baharoute-timeline__est" data-testid="timeline-estimated">
          estimated
        </span>
      )}
    </div>
  );
}

export default TimelineControl;
