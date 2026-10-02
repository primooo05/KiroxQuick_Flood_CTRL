// src/components/insights/InfoTooltip.tsx
//
// A small, accessible info icon that reveals a plain-language explanation.
// Keyboard-operable (focusable button), toggles on click, and exposes its
// content to assistive tech via aria. Used for Current Flood Risk, Historical
// Flood Susceptibility, Return period, Community Report, Confirmed Closure.

import { useId, useState } from 'react';

export interface InfoTooltipProps {
  /** Accessible name for the trigger, e.g. "About current flood risk". */
  label: string;
  /** Plain-language explanation shown when opened. */
  children: React.ReactNode;
  className?: string;
}

export function InfoTooltip({ label, children, className }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span
      className={['baharoute-info', className].filter(Boolean).join(' ')}
      data-testid="info-tooltip"
    >
      <button
        type="button"
        className="baharoute-info__trigger baharoute-focus-ring"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        data-testid="info-tooltip-trigger"
      >
        <span aria-hidden="true">i</span>
      </button>
      {open && (
        <span role="note" id={id} className="baharoute-info__bubble" data-testid="info-tooltip-bubble">
          {children}
        </span>
      )}
    </span>
  );
}

export default InfoTooltip;
