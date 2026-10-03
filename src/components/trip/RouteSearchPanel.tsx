// src/components/trip/RouteSearchPanel.tsx
//
// Step 1 of the trip flow: SEARCH. The commuter chooses an origin and a
// destination, then asks BahaRoute to find routes. This is the first
// interaction — Driver Mode is never entered from here.
//
// Origin ("From") supports three ways to set a point:
//   - Use current location (delegated to the parent, which owns geolocation)
//   - Search a Metro Manila place (local NCR place index, no network)
//   - Select on the map (parent enters a pick mode and reports the tap)
// Destination ("To") supports search + select-on-map.
//
// Coverage is strictly NCR. Any point outside the region (a search result can
// only be inside, but current location or a map tap may not be) is rejected
// with UNSUPPORTED_AREA_MESSAGE and cannot be used to find routes.
//
// Pure presentational + local UI state: place search, current location, and map
// picking are all injected/callbacks so the panel needs no real map and is
// straightforward to test.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import {
  searchPlaces as defaultSearchPlaces,
  isWithinNCR,
  UNSUPPORTED_AREA_MESSAGE,
  type NcrPlace,
} from '../../services/ncrPlaces';

/** How an origin/destination was chosen. Normalized so the rest of the trip
 * flow never has to care which input produced it. */
export type EndpointSource = 'device' | 'search' | 'map';

/** A resolved trip endpoint (origin or destination). */
export interface TripEndpoint {
  /** Display label shown in the field once chosen. */
  readonly label: string;
  /** `[lng, lat]`, guaranteed within NCR when set through this panel. */
  readonly coord: readonly [number, number];
  /** Which input produced this endpoint. */
  readonly source: EndpointSource;
}

/**
 * The device-location permission state, surfaced as a subtle, non-error privacy
 * status near the From controls. Location is "notRequested" (Not shared) by
 * default — BahaRoute never requests it on load.
 */
export type LocationStatus =
  | 'notRequested'
  | 'requesting'
  | 'allowed'
  | 'denied'
  | 'unavailable';

/** Which field is actively picking a point on the map, if any. */
export type PickTarget = 'origin' | 'destination' | null;

export interface RouteSearchPanelProps {
  /** Currently chosen origin, if any. */
  origin: TripEndpoint | null;
  /** Currently chosen destination, if any. */
  destination: TripEndpoint | null;
  /** Set/clear the origin. */
  onOriginChange: (endpoint: TripEndpoint | null) => void;
  /** Set/clear the destination. */
  onDestinationChange: (endpoint: TripEndpoint | null) => void;
  /**
   * Ask the parent to resolve the user's current location for the origin. The
   * parent owns geolocation + the NCR check and calls onOriginChange on success
   * (or surfaces its own message). Optional; hidden when not provided.
   */
  onUseCurrentLocation?: () => void;
  /**
   * Enter/exit "select on map" mode for a field. The parent highlights the map,
   * captures the next tap, validates NCR, and calls the matching change
   * handler. Passing `null` cancels picking.
   */
  onPickOnMap?: (target: PickTarget) => void;
  /** Which field is currently in map-pick mode (controlled by the parent). */
  pickTarget?: PickTarget;
  /** Proceed to route comparison with the chosen origin + destination. */
  onFindRoutes: (origin: TripEndpoint, destination: TripEndpoint) => void;
  /** Injectable place search (tests). Defaults to the local NCR index. */
  searchPlaces?: (query: string, limit?: number) => NcrPlace[];
  /** True while the parent is computing routes (disables the action). */
  busy?: boolean;
  /** Device-location permission state, for the subtle privacy status line. */
  locationStatus?: LocationStatus;
}

type Field = 'origin' | 'destination';

/** Subtle, non-error privacy status copy for the From controls. */
function locationStatusText(status: LocationStatus, originIsDevice: boolean): string {
  if (originIsDevice) return 'Using current location';
  switch (status) {
    case 'requesting':
      return 'Getting your location…';
    case 'allowed':
      return 'Using current location';
    case 'denied':
      return "Location access wasn't allowed. Search or select your starting point instead.";
    case 'unavailable':
      return "We couldn't get your location. Search or select a starting point instead.";
    case 'notRequested':
    default:
      return 'Location not shared';
  }
}

/**
 * Renders the origin/destination search step. Keeps only local UI state (query
 * text + open suggestion list per field); the chosen endpoints are controlled
 * by the parent so the trip-flow state machine owns the source of truth.
 */
export function RouteSearchPanel({
  origin,
  destination,
  onOriginChange,
  onDestinationChange,
  onUseCurrentLocation,
  onPickOnMap,
  pickTarget = null,
  onFindRoutes,
  searchPlaces = defaultSearchPlaces,
  busy = false,
  locationStatus = 'notRequested',
}: RouteSearchPanelProps) {
  const [originQuery, setOriginQuery] = useState('');
  const [destQuery, setDestQuery] = useState('');
  const [openField, setOpenField] = useState<Field | null>(null);
  // A local, non-blocking hint (e.g. an out-of-NCR map tap) surfaced inline.
  const [notice, setNotice] = useState<string | null>(null);

  const listboxId = useRef(`baharoute-place-list-${Math.random().toString(36).slice(2)}`).current;

  const originResults = useMemo(
    () => (openField === 'origin' ? searchPlaces(originQuery) : []),
    [openField, originQuery, searchPlaces],
  );
  const destResults = useMemo(
    () => (openField === 'destination' ? searchPlaces(destQuery) : []),
    [openField, destQuery, searchPlaces],
  );

  const choosePlace = useCallback(
    (field: Field, place: NcrPlace) => {
      const endpoint: TripEndpoint = {
        source: 'search',
        label: place.area ? `${place.name} — ${place.area}` : place.name,
        coord: place.coord,
      };
      // Search results are always inside NCR, but guard defensively.
      if (!isWithinNCR(place.coord[0], place.coord[1])) {
        setNotice(UNSUPPORTED_AREA_MESSAGE);
        return;
      }
      setNotice(null);
      if (field === 'origin') {
        onOriginChange(endpoint);
        setOriginQuery('');
      } else {
        onDestinationChange(endpoint);
        setDestQuery('');
      }
      setOpenField(null);
    },
    [onOriginChange, onDestinationChange],
  );

  const clearField = useCallback(
    (field: Field) => {
      if (field === 'origin') onOriginChange(null);
      else onDestinationChange(null);
    },
    [onOriginChange, onDestinationChange],
  );

  const startPick = useCallback(
    (field: Field) => {
      setOpenField(null);
      onPickOnMap?.(pickTarget === field ? null : field);
    },
    [onPickOnMap, pickTarget],
  );

  const handleUseCurrentLocation = useCallback(() => {
    setOpenField(null);
    onUseCurrentLocation?.();
  }, [onUseCurrentLocation]);

  // Auto-enter route preview: once BOTH endpoints are set, request routes
  // automatically (no manual "Find routes" click). A ref guards against
  // re-firing for the same origin/destination pair (e.g. on unrelated
  // re-renders); it re-arms whenever either endpoint changes.
  const lastPairRef = useRef<string | null>(null);
  const pairKey =
    origin && destination
      ? `${origin.coord[0]},${origin.coord[1]}->${destination.coord[0]},${destination.coord[1]}`
      : null;
  useEffect(() => {
    if (!origin || !destination || !pairKey) {
      lastPairRef.current = null;
      return;
    }
    if (lastPairRef.current === pairKey) return;
    lastPairRef.current = pairKey;
    onFindRoutes(origin, destination);
    // onFindRoutes identity is stable enough for this trigger; pairKey drives it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairKey]);

  const panelRef = useRef<HTMLElement>(null);
  const dragStartRef = useRef<number | null>(null);
  const dragOffsetRef = useRef(0);
  const [isClosed, setIsClosed] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const startPanelDrag = (event: PointerEvent<HTMLElement>) => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(min-width: 768px)').matches) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    dragStartRef.current = event.clientY;
    dragOffsetRef.current = 0;
    setIsDragging(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Some mobile browsers do not support pointer capture on a section.
    }
  };
  const movePanelDrag = (event: PointerEvent<HTMLElement>) => {
    if (dragStartRef.current !== null) {
      const offset = Math.max(0, event.clientY - dragStartRef.current);
      dragOffsetRef.current = offset;
      setDragOffset(offset);
    }
  };
  const finishPanelDrag = (event: PointerEvent<HTMLElement>) => {
    if (dragStartRef.current === null) return;
    const height = panelRef.current?.getBoundingClientRect().height ?? 1;
    const offset = Math.max(dragOffsetRef.current, event.clientY - dragStartRef.current);
    const shouldClose = offset / height >= 0.75;
    dragStartRef.current = null;
    dragOffsetRef.current = 0;
    setIsDragging(false);
    setDragOffset(0);
    if (shouldClose) setIsClosed(true);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  if (isClosed) {
    return (
      <button type="button" className="baharoute-trip-reopen baharoute-focus-ring" onClick={() => { setIsReopening(true); setIsClosed(false); }}>
        Baha-Route
      </button>
    );
  }

  return (
    // Baha-Route Trip Panel
    <section
      ref={panelRef}
      className={`baharoute-trip-panel baharoute-search-panel${isDragging ? ' is-dragging' : ''}${isReopening ? ' is-reopening' : ''}`}
      style={{ '--baharoute-trip-drag': `${dragOffset}px` } as CSSProperties}
      aria-label="Plan a trip"
      data-testid="route-search-panel"
    >
      <div
        className="baharoute-search-panel__drag-target"
        style={{ display: 'flex', height: 36, touchAction: 'none' }}
        role="separator"
        aria-label="Drag down to close Baha-Route"
        onPointerDown={startPanelDrag}
        onPointerMove={movePanelDrag}
        onPointerUp={finishPanelDrag}
        onPointerCancel={finishPanelDrag}
      >
        <span className="baharoute-search-panel__drag-line" style={{ display: 'block', width: 64, height: 7, background: '#68727d', borderRadius: 999 }} />
      </div>
      <header className="baharoute-trip-panel__header">
        <h2 className="baharoute-trip-panel__title">Where to?</h2>
        <p className="baharoute-trip-panel__subtitle">
          Metro Manila / NCR only. Choose a starting point and destination.
        </p>
      </header>

      {/* FROM */}
      <div className="baharoute-search-field" data-testid="search-field-origin">
        <label className="baharoute-search-field__label" htmlFor="baharoute-origin-input">
          From
        </label>
        {origin ? (
          <div className="baharoute-search-field__chosen">
            <span className="baharoute-search-field__value">{origin.label}</span>
            <button
              type="button"
              className="baharoute-search-field__clear baharoute-focus-ring"
              onClick={() => clearField('origin')}
              aria-label="Clear starting point"
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              id="baharoute-origin-input"
              type="text"
              className="baharoute-search-field__input baharoute-focus-ring"
              placeholder="Search a place in NCR"
              autoComplete="off"
              role="combobox"
              aria-expanded={openField === 'origin'}
              aria-controls={listboxId}
              aria-autocomplete="list"
              value={originQuery}
              onFocus={() => setOpenField('origin')}
              onChange={(e) => {
                setOriginQuery(e.target.value);
                setOpenField('origin');
              }}
            />
            <div className="baharoute-search-field__actions">
              {onUseCurrentLocation && (
                <button
                  type="button"
                  className="baharoute-chip-button baharoute-focus-ring"
                  onClick={handleUseCurrentLocation}
                >
                  Use current location
                </button>
              )}
              {onPickOnMap && (
                <button
                  type="button"
                  className="baharoute-chip-button baharoute-focus-ring"
                  aria-pressed={pickTarget === 'origin'}
                  onClick={() => startPick('origin')}
                >
                  {pickTarget === 'origin' ? 'Tap the map…' : 'Select on map'}
                </button>
              )}
            </div>
          </>
        )}
        {/* Subtle, non-error privacy status. Communicates state only. */}
        {onUseCurrentLocation && (
          <p
            className="baharoute-location-status"
            data-testid="location-privacy-status"
            data-status={locationStatus}
          >
            {locationStatusText(locationStatus, origin?.source === 'device')}
          </p>
        )}
      </div>

      {/* TO */}
      <div className="baharoute-search-field" data-testid="search-field-destination">
        <label className="baharoute-search-field__label" htmlFor="baharoute-dest-input">
          To
        </label>
        {destination ? (
          <div className="baharoute-search-field__chosen">
            <span className="baharoute-search-field__value">{destination.label}</span>
            <button
              type="button"
              className="baharoute-search-field__clear baharoute-focus-ring"
              onClick={() => clearField('destination')}
              aria-label="Clear destination"
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              id="baharoute-dest-input"
              type="text"
              className="baharoute-search-field__input baharoute-focus-ring"
              placeholder="Search a place in NCR"
              autoComplete="off"
              role="combobox"
              aria-expanded={openField === 'destination'}
              aria-controls={listboxId}
              aria-autocomplete="list"
              value={destQuery}
              onFocus={() => setOpenField('destination')}
              onChange={(e) => {
                setDestQuery(e.target.value);
                setOpenField('destination');
              }}
            />
            <div className="baharoute-search-field__actions">
              {onPickOnMap && (
                <button
                  type="button"
                  className="baharoute-chip-button baharoute-focus-ring"
                  aria-pressed={pickTarget === 'destination'}
                  onClick={() => startPick('destination')}
                >
                  {pickTarget === 'destination' ? 'Tap the map…' : 'Select on map'}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Shared suggestion list for whichever field is open. */}
      {openField && (
        <ul
          className="baharoute-place-suggestions"
          id={listboxId}
          role="listbox"
          aria-label={openField === 'origin' ? 'Starting point suggestions' : 'Destination suggestions'}
          data-testid="place-suggestions"
        >
          {(openField === 'origin' ? originResults : destResults).map((place) => (
            <li key={place.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="baharoute-place-suggestions__item baharoute-focus-ring"
                onClick={() => choosePlace(openField, place)}
              >
                <span className="baharoute-place-suggestions__name">{place.name}</span>
                {place.area && (
                  <span className="baharoute-place-suggestions__area">{place.area}</span>
                )}
              </button>
            </li>
          ))}
          {(openField === 'origin' ? originResults : destResults).length === 0 && (
            <li className="baharoute-place-suggestions__empty" role="option" aria-selected={false} aria-disabled>
              No matching places in NCR
            </li>
          )}
        </ul>
      )}

      {notice && (
        <p className="baharoute-trip-panel__notice" role="status" data-testid="search-notice">
          {notice}
        </p>
      )}

      {/* Route preview starts automatically once both points are set. While it
          computes, show a subtle status; otherwise a hint of what to do next. */}
      {busy ? (
        <p className="baharoute-trip-panel__hint" role="status" data-testid="finding-routes-status">
          Finding routes…
        </p>
      ) : (
        !(origin && destination) && (
          <p className="baharoute-trip-panel__hint" data-testid="search-hint">
            Set a starting point and destination to see routes.
          </p>
        )
      )}
    </section>
  );
}

export default RouteSearchPanel;
