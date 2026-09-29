// src/components/controls/LocationControl.tsx
//
// LocationControl (design → Components table: LocationControl, Req 6). An
// accessible button that requests the user's current location and reports the
// outcome. On grant it hands the coordinates to the parent (which renders the
// Current_Location_Marker and centers the map) and, when the position is
// outside the NCR, additionally surfaces the "NCR only" message (Req 6.6).
// Denied / unavailable / timeout each show their own status message while the
// map stays interactive (Req 6.3–6.5, 18.4).
//
// Testability: the geolocation request is injected (default the real service)
// so tests drive each branch with a fake `requestLocation`. The
// Current_Location_Marker is represented as a parent callback (`onLocated`) —
// this component never requires a real map.

import { useCallback, useState } from 'react';
import {
  requestLocation as defaultRequestLocation,
  type LocationResult,
} from '../../services/geolocation';
import { isWithinMetroManila } from '../../map/metroManilaExtent';
import { LOCATION_MESSAGES } from './locationMessages';
import { LocationIcon } from './icons';

/** A function that resolves the current location. Matches `requestLocation`. */
export type RequestLocationFn = () => Promise<LocationResult>;

export interface LocationControlProps {
  /**
   * When provided, the button DELEGATES to the parent instead of requesting
   * geolocation itself: it calls `onActivate` and renders no internal status
   * message. This is how the location arrow participates in the app's unified,
   * consent-gated origin flow (BahaRoute consent → geolocation → route-planning
   * origin → 3D preview / recenter). The parent owns messaging (the privacy
   * status line) and the camera. When omitted, the control keeps its legacy,
   * self-contained behavior below.
   */
  onActivate?: () => void;
  /**
   * Injectable location request. Defaults to the real geolocation service with
   * its 20s timeout (Req 6.5). Tests supply a fake to drive each branch. Ignored
   * when {@link onActivate} is provided.
   */
  requestLocation?: RequestLocationFn;
  /**
   * Called when a position is obtained (granted), whether inside or outside the
   * NCR (Req 6.2, 6.6). The parent renders the Current_Location_Marker and
   * centers the map on the coordinates.
   */
  onLocated?: (lng: number, lat: number) => void;
  /**
   * Called when the granted position is outside the Metro_Manila_Extent, in
   * addition to {@link onLocated} (Req 6.6). Lets the parent react beyond the
   * inline message.
   */
  onOutsideNcr?: (lng: number, lat: number) => void;
  /**
   * Called for any non-granted outcome with the resulting status and the
   * message shown to the user (Req 6.3–6.5). Optional.
   */
  onStatus?: (status: LocationResult['status'], message: string | null) => void;
  /** Accessible label for the button (Req 11.3). */
  label?: string;
}

const noop = (): void => undefined;

/**
 * Renders an accessible, keyboard-operable button that requests the user's
 * location and shows the outcome in an accessible live region. In every branch
 * the map remains interactive because this control never disables or blocks it;
 * it only reports results to the parent and renders a status message.
 */
export function LocationControl({
  onActivate,
  requestLocation = defaultRequestLocation,
  onLocated = noop,
  onOutsideNcr = noop,
  onStatus = noop,
  label = 'Show my location',
}: LocationControlProps) {
  const [message, setMessage] = useState<string | null>(null);
  /** 'alert' for error branches, 'status' for informational ones. */
  const [messageRole, setMessageRole] = useState<'status' | 'alert'>('status');
  const [busy, setBusy] = useState(false);

  const handleActivate = useCallback(async () => {
    // Delegated mode: hand off to the parent's consent-gated origin flow. The
    // control requests no geolocation and shows no message of its own.
    if (onActivate) {
      onActivate();
      return;
    }
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await requestLocation();
      switch (result.status) {
        case 'granted': {
          onLocated(result.lng, result.lat);
          if (isWithinMetroManila(result.lng, result.lat)) {
            // Inside the NCR: marker + center handled by the parent; no message.
            setMessage(null);
            setMessageRole('status');
            onStatus('granted', null);
          } else {
            // Outside the NCR: still show the marker (via onLocated above) and
            // inform the user of NCR-only support (Req 6.6).
            onOutsideNcr(result.lng, result.lat);
            setMessage(LOCATION_MESSAGES.outsideNcr);
            setMessageRole('status');
            onStatus('granted', LOCATION_MESSAGES.outsideNcr);
          }
          break;
        }
        case 'denied': {
          setMessage(LOCATION_MESSAGES.denied);
          setMessageRole('alert');
          onStatus('denied', LOCATION_MESSAGES.denied);
          break;
        }
        case 'unavailable': {
          setMessage(LOCATION_MESSAGES.unavailable);
          setMessageRole('alert');
          onStatus('unavailable', LOCATION_MESSAGES.unavailable);
          break;
        }
        case 'timeout': {
          setMessage(LOCATION_MESSAGES.timeout);
          setMessageRole('alert');
          onStatus('timeout', LOCATION_MESSAGES.timeout);
          break;
        }
      }
    } finally {
      setBusy(false);
    }
  }, [onActivate, busy, requestLocation, onLocated, onOutsideNcr, onStatus]);

  return (
    <div className="baharoute-location-control">
      <button
        type="button"
        // Visible focus-ring hook (Task 17, Req 11.2): styled in layout.css.
        className="baharoute-control-button baharoute-round-button baharoute-focus-ring"
        aria-label={label}
        title={label}
        aria-busy={busy}
        onClick={handleActivate}
        // ≥44×44 CSS px touch target (Req 5.4, 10.4). Kept inline so the control
        // meets the size requirement without depending on external CSS.
        style={{ minWidth: 44, minHeight: 44 }}
      >
        {/* Text label ensures an accessible name even without CSS/icons. */}
        <LocationIcon />
      </button>
      {message !== null && (
        <p
          className="baharoute-control-message"
          role={messageRole}
          data-testid="location-message"
        >
          {message}
        </p>
      )}
    </div>
  );
}

export default LocationControl;
