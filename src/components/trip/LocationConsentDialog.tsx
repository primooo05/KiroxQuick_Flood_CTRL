// src/components/trip/LocationConsentDialog.tsx
//
// A small, accessible BahaRoute consent dialog shown BEFORE any browser
// geolocation request. Privacy-first: the browser's native permission prompt is
// only reached after the user explicitly presses "Allow location" here, so the
// device location is never requested just by loading or exploring the app.
//
// Accessibility: it is a modal dialog (role="dialog", aria-modal) with an
// accessible name/description, an initial focus, a focus trap while open, and
// Escape-to-dismiss (equivalent to "Not now"). The copy is neutral and
// non-manipulative — both choices are presented plainly.

import { useCallback, useEffect, useRef } from 'react';

export interface LocationConsentDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** User consents: proceed to the browser geolocation request. */
  onAllow: () => void;
  /** User declines (button or Escape / backdrop): no geolocation request. */
  onDismiss: () => void;
}

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Renders the consent dialog. Returns null when closed so it is fully removed
 * from the DOM (no hidden focus targets). While open it traps focus between its
 * two buttons and restores focus to the previously focused element on close.
 */
export function LocationConsentDialog({ open, onAllow, onDismiss }: LocationConsentDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const allowRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocused = useRef<Element | null>(null);

  // Move focus into the dialog on open; restore it on close.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement;
    // Focus the primary affordance ("Allow location") but do not auto-trigger.
    allowRef.current?.focus();
    return () => {
      const prev = previouslyFocused.current;
      if (prev instanceof HTMLElement) prev.focus();
    };
  }, [open]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onDismiss();
        return;
      }
      if (e.key !== 'Tab') return;
      // Simple focus trap across the dialog's focusable elements.
      const root = dialogRef.current;
      if (!root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('disabled'),
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onDismiss],
  );

  if (!open) return null;

  return (
    <div
      className="baharoute-consent-backdrop"
      data-testid="location-consent-backdrop"
      // A backdrop click is treated as "Not now" (no geolocation request).
      onClick={onDismiss}
    >
      <div
        ref={dialogRef}
        className="baharoute-consent-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="baharoute-consent-title"
        aria-describedby="baharoute-consent-desc"
        data-testid="location-consent-dialog"
        onKeyDown={onKeyDown}
        // Keep clicks inside from bubbling to the backdrop dismiss handler.
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="baharoute-consent-title" className="baharoute-consent-dialog__title">
          Use your current location?
        </h2>
        <p id="baharoute-consent-desc" className="baharoute-consent-dialog__body">
          BahaRoute can use your device location to set your starting point and follow your
          position during navigation. Your location is only requested after you choose Allow.
        </p>
        <div className="baharoute-consent-dialog__actions">
          <button
            type="button"
            className="baharoute-consent-dialog__decline baharoute-focus-ring"
            onClick={onDismiss}
            data-testid="location-consent-decline"
          >
            Not now
          </button>
          <button
            type="button"
            ref={allowRef}
            className="baharoute-consent-dialog__allow baharoute-focus-ring"
            onClick={onAllow}
            data-testid="location-consent-allow"
          >
            Allow location
          </button>
        </div>
      </div>
    </div>
  );
}

export default LocationConsentDialog;
