// src/components/MapView.test.tsx
//
// Verifies MapView mounts a container, initializes a MapManager on mount, and
// destroys it on unmount — all with an injected fake manager so nothing touches
// a real WebGL map (the environment is jsdom). Req 1.1, 1.4.
//
// Task 15.2 additions: the LoadingIndicator shows initially and is dismissed on
// the MapManager onReady (Req 1.5); the ErrorMessage shows on onTileFailure
// while the app stays interactive (Req 1.6, 18.1); the control cluster renders;
// and the DemoDataBadge shows when demo layers are present (Req 15.2).

import { act } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MapView, type MapManagerLike } from './MapView';
import type { AppConfig } from '../types/config';
import type { MinimalMap } from '../map/MapManager';
import type { LocationResult } from '../services/geolocation';

const CONFIG: AppConfig = { tileKey: 'test-key-123', hasTileKey: true };

/**
 * A fake MapManager tracking init/destroy calls and the options it received. It
 * intentionally does NOT expose an integrable map (getMap returns null) so the
 * real susceptibility/layer/popup integration paths stay skipped under jsdom.
 *
 * `mapOverride` lets a test supply a non-null map object so the guarded
 * marker-placement path runs (still jsdom-safe: it is a plain object of vi.fns,
 * never a real WebGL map). `flyTo`/`easeTo` on that map are recorded so tests
 * can assert the startup path never moves the camera.
 */
function makeFakeManager(mapOverride?: MinimalMap | null) {
  const init = vi.fn();
  const destroy = vi.fn();
  const zoomIn = vi.fn();
  const zoomOut = vi.fn();
  const recenter = vi.fn();
  const frameOverview = vi.fn();
  const setMapContext = vi.fn();
  const getMap = vi.fn(() => mapOverride ?? null);
  // Planning-camera spies (origin 3D preview + both-points frame + token guard).
  let token = 0;
  const nextCameraToken = vi.fn(() => (token += 1));
  const focusOrigin = vi.fn();
  const framePoints = vi.fn();
  // Route-preview spies.
  const showRoutePreview = vi.fn();
  const updateRoutePreviewSelection = vi.fn();
  const clearRoutePreview = vi.fn();
  const manager: MapManagerLike = {
    init,
    destroy,
    zoomIn,
    zoomOut,
    recenter,
    frameOverview,
    setMapContext,
    getMap,
    nextCameraToken,
    focusOrigin,
    framePoints,
    showRoutePreview,
    updateRoutePreviewSelection,
    clearRoutePreview,
  };
  return {
    manager,
    init,
    destroy,
    zoomIn,
    zoomOut,
    recenter,
    frameOverview,
    setMapContext,
    getMap,
    nextCameraToken,
    focusOrigin,
    framePoints,
    showRoutePreview,
    updateRoutePreviewSelection,
    clearRoutePreview,
  };
}

/**
 * A minimal non-integrable fake map exposing only `flyTo`/`easeTo` (recorded)
 * so a granted startup location can place a marker without WebGL, while letting
 * tests assert the startup path issues no camera move. It intentionally omits
 * addSource/addLayer so the susceptibility integration stays skipped.
 */
function makeFakeMap() {
  const flyTo = vi.fn();
  const easeTo = vi.fn();
  const map = { flyTo, easeTo } as unknown as MinimalMap;
  return { map, flyTo, easeTo };
}

/** Reads the onReady/onTileFailure callbacks passed to the fake init. */
function initCallbacks(init: ReturnType<typeof vi.fn>) {
  const options = init.mock.calls[0][0];
  return {
    onReady: options.onReady as () => void,
    onTileFailure: options.onTileFailure as (
      reason: 'timeout' | 'error',
    ) => void,
  };
}

describe('MapView', () => {
  it('mounts a full-size container and calls init on mount', () => {
    const { manager, init } = makeFakeManager();

    render(<MapView config={CONFIG} createMapManager={() => manager} />);

    const container = screen.getByTestId('map-container');
    expect(container).toBeInTheDocument();

    expect(init).toHaveBeenCalledTimes(1);
    const options = init.mock.calls[0][0];
    expect(options.container).toBe(container);
    expect(options.config).toBe(CONFIG);
  });

  it('calls destroy on unmount', () => {
    const { manager, destroy } = makeFakeManager();

    const { unmount } = render(
      <MapView config={CONFIG} createMapManager={() => manager} />,
    );

    expect(destroy).not.toHaveBeenCalled();
    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('forwards onReady and onTileFailure through to the manager', () => {
    const { manager, init } = makeFakeManager();
    const onReady = vi.fn();
    const onTileFailure = vi.fn();

    render(
      <MapView
        config={CONFIG}
        createMapManager={() => manager}
        onReady={onReady}
        onTileFailure={onTileFailure}
      />,
    );

    const { onReady: readyCb, onTileFailure: failCb } = initCallbacks(init);
    // The wrappers delegate to the current props.
    act(() => readyCb());
    act(() => failCb('timeout'));

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onTileFailure).toHaveBeenCalledWith('timeout');
  });

  it('shows the LoadingIndicator initially and dismisses it on ready (Req 1.5)', () => {
    const { manager, init } = makeFakeManager();

    render(<MapView config={CONFIG} createMapManager={() => manager} />);

    // Loading is visible before the map reports ready.
    expect(screen.getByTestId('loading-indicator')).toBeInTheDocument();
    expect(screen.queryByTestId('error-message')).not.toBeInTheDocument();

    const { onReady } = initCallbacks(init);
    act(() => onReady());

    // Dismissed once the base map is ready.
    expect(screen.queryByTestId('loading-indicator')).not.toBeInTheDocument();
    expect(screen.queryByTestId('error-message')).not.toBeInTheDocument();
  });

  it('shows the ErrorMessage on tile failure while staying interactive (Req 1.6, 18.1)', () => {
    const { manager, init } = makeFakeManager();

    render(<MapView config={CONFIG} createMapManager={() => manager} />);

    const { onTileFailure } = initCallbacks(init);
    act(() => onTileFailure('error'));

    const error = screen.getByTestId('error-message');
    expect(error).toBeInTheDocument();
    expect(screen.queryByTestId('loading-indicator')).not.toBeInTheDocument();
    // App stays interactive: the control cluster is still present.
    expect(screen.getByTestId('map-controls')).toBeInTheDocument();
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
  });

  it('renders the control cluster over the map', () => {
    const { manager } = makeFakeManager();

    render(<MapView config={CONFIG} createMapManager={() => manager} />);

    expect(screen.getByTestId('map-controls')).toBeInTheDocument();
    expect(screen.getByTestId('zoom-controls')).toBeInTheDocument();
    expect(screen.getByTestId('layer-control')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /recenter map to metro manila/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /show my location/i }),
    ).toBeInTheDocument();
  });

  it('wires zoom / recenter controls to the manager', async () => {
    const { manager, zoomIn, zoomOut, recenter } = makeFakeManager();
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();

    render(<MapView config={CONFIG} createMapManager={() => manager} />);

    await user.click(screen.getByTestId('zoom-in'));
    await user.click(screen.getByTestId('zoom-out'));
    await user.click(
      screen.getByRole('button', { name: /recenter map to metro manila/i }),
    );

    expect(zoomIn).toHaveBeenCalledTimes(1);
    expect(zoomOut).toHaveBeenCalledTimes(1);
    expect(recenter).toHaveBeenCalledTimes(1);
  });

  it('shows the DemoDataBadge because the fixture layers are demo (Req 15.2)', () => {
    const { manager } = makeFakeManager();

    render(<MapView config={CONFIG} createMapManager={() => manager} />);

    expect(screen.getByTestId('demo-data-badge')).toBeInTheDocument();
  });

  it('shows the NCR-only coverage badge', () => {
    const { manager } = makeFakeManager();
    render(<MapView config={CONFIG} createMapManager={() => manager} />);
    expect(screen.getByTestId('coverage-badge')).toHaveTextContent(
      /Metro Manila \/ NCR/i,
    );
  });

  it('does not throw in jsdom with an injected fake manager (no WebGL)', () => {
    const { manager } = makeFakeManager();
    expect(() =>
      render(<MapView config={CONFIG} createMapManager={() => manager} />),
    ).not.toThrow();
  });

  it('frames the tuned NCR overview on ready (Req 1.1)', () => {
    const { manager, init, frameOverview } = makeFakeManager();

    render(<MapView config={CONFIG} createMapManager={() => manager} />);

    // No framing until the base map reports ready.
    expect(frameOverview).not.toHaveBeenCalled();

    const { onReady } = initCallbacks(init);
    act(() => onReady());

    expect(frameOverview).toHaveBeenCalledTimes(1);
  });

  it('PRIVACY-FIRST: never requests device location on load and never moves the camera to a user position', async () => {
    const { map, flyTo, easeTo } = makeFakeMap();
    const { manager, init, frameOverview } = makeFakeManager(map);

    // A location requester that, if ever called, would resolve granted. It must
    // NOT be called on mount/ready — location is "Not shared" by default.
    const requestLocation = vi.fn(
      async (): Promise<LocationResult> => ({ status: 'granted', lng: 121.05, lat: 14.6 }),
    );
    const setOrigin = vi.fn();
    const createMarkerManager = vi.fn(
      () => ({ setOrigin, setDestination: vi.fn(), destroy: vi.fn() }) as never,
    );

    render(
      <MapView
        config={CONFIG}
        createMapManager={() => manager}
        createMarkerManager={createMarkerManager}
        requestLocation={requestLocation}
      />,
    );

    const { onReady } = initCallbacks(init);
    await act(async () => {
      onReady();
      await Promise.resolve();
      await Promise.resolve();
    });

    // No geolocation request, no origin inferred, no camera move to a position.
    expect(requestLocation).not.toHaveBeenCalled();
    expect(setOrigin).not.toHaveBeenCalled();
    expect(flyTo).not.toHaveBeenCalled();
    // Only the single overview framing happened.
    expect(frameOverview).toHaveBeenCalledTimes(1);
    expect(easeTo).not.toHaveBeenCalled();

    // The map + controls remain rendered and interactive without location.
    expect(screen.getByTestId('map-container')).toBeInTheDocument();
    expect(screen.getByTestId('map-controls')).toBeInTheDocument();
  });

  it('starts with the route search panel and the "Location not shared" privacy status', () => {
    const { manager } = makeFakeManager();
    render(<MapView config={CONFIG} createMapManager={() => manager} />);
    expect(screen.getByTestId('route-search-panel')).toBeInTheDocument();
    expect(screen.getByTestId('location-privacy-status')).toHaveTextContent(/not shared/i);
  });
});

describe('MapView layer visibility UX (Phase 4)', () => {
  async function setup() {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const fake = makeFakeManager();
    render(<MapView config={CONFIG} createMapManager={() => fake.manager} />);
    // Open the layers drawer so the toggles are interactable.
    await user.click(screen.getByTestId('layers-button'));
    return { user, setMapContext: fake.setMapContext };
  }

  it('initial load: no thematic legend, no rainfall pill, shows the empty hint', async () => {
    await setup();
    expect(screen.queryByTestId('map-legend')).toBeNull();
    expect(screen.queryByTestId('live-status-pill')).toBeNull();
    expect(screen.getByTestId('layer-control-hint')).toHaveTextContent(
      /select a layer/i,
    );
  });

  it('Flood Risk ON → current-risk legend appears; OFF → legend hidden again', async () => {
    const { user } = await setup();
    await user.click(screen.getByTestId('layer-checkbox-barangayFloodRisk'));
    const legend = screen.getByTestId('map-legend');
    expect(legend).toHaveTextContent('Current Flood Risk');
    // The empty hint is gone once a layer is enabled.
    expect(screen.queryByTestId('layer-control-hint')).toBeNull();

    await user.click(screen.getByTestId('layer-checkbox-barangayFloodRisk'));
    expect(screen.queryByTestId('map-legend')).toBeNull();
  });

  it('Historical ONLY → historical legend, labeled reference, no current-risk pill', async () => {
    const { user } = await setup();
    await user.click(screen.getByTestId('layer-checkbox-floodSusceptibility'));
    // In this (pre-ready) phase the tall Historical Explore rail is not yet
    // mounted, so the standalone legend still provides the historical reference
    // key. (When the map is ready and the Explore rail occupies the left
    // column, the legend is suppressed to avoid the orphan-card overlap — see
    // the dedicated primaryLeftPanel/legend-suppression test.)
    const legend = screen.getByTestId('map-legend');
    expect(legend).toHaveTextContent('Historical Flood Susceptibility');
    expect(legend).toHaveTextContent(/reference|historical/i);
    // Live rainfall pill is only for the Flood Risk layer.
    expect(screen.queryByTestId('live-status-pill')).toBeNull();
  });

  it('Reports and Closures toggle independently of Flood Risk (no legend needed)', async () => {
    const { user } = await setup();
    await user.click(screen.getByTestId('layer-checkbox-communityReports'));
    // Reports on, but no flood-risk/historical legend appears.
    expect(screen.queryByTestId('map-legend')).toBeNull();
    expect(screen.queryByTestId('live-status-pill')).toBeNull();
    expect(
      (screen.getByTestId('layer-checkbox-communityReports') as HTMLInputElement)
        .checked,
    ).toBe(true);

    await user.click(screen.getByTestId('layer-checkbox-officialClosures'));
    expect(
      (screen.getByTestId('layer-checkbox-officialClosures') as HTMLInputElement)
        .checked,
    ).toBe(true);
    // Still no thematic legend for reports/closures alone.
    expect(screen.queryByTestId('map-legend')).toBeNull();
  });

  it('all layers OFF again → clean base map (no legend, pill, or hint-less warnings)', async () => {
    const { user } = await setup();
    await user.click(screen.getByTestId('layer-checkbox-barangayFloodRisk'));
    expect(screen.getByTestId('map-legend')).toBeInTheDocument();
    await user.click(screen.getByTestId('layer-checkbox-barangayFloodRisk'));
    expect(screen.queryByTestId('map-legend')).toBeNull();
    expect(screen.queryByTestId('live-status-pill')).toBeNull();
    expect(screen.queryByTestId('history-context-message')).toBeNull();
    // Empty hint returns.
    expect(screen.getByTestId('layer-control-hint')).toBeInTheDocument();
  });

  it('toggling the layer drawer open/closed does not reset selections', async () => {
    const { user } = await setup();
    await user.click(screen.getByTestId('layer-checkbox-communityReports'));
    // Close then reopen the drawer.
    const layersButton = screen.getByTestId('layers-button');
    await user.click(layersButton);
    await user.click(layersButton);
    expect(
      (screen.getByTestId('layer-checkbox-communityReports') as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it('Map Context defaults to "Show nearby areas" and routes changes to the manager', async () => {
    const { user, setMapContext } = await setup();
    // Default selection is "Show nearby areas".
    expect(
      (screen.getByTestId('map-context-nearby') as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByTestId('map-context-ncr-only') as HTMLInputElement).checked,
    ).toBe(false);

    await user.click(screen.getByTestId('map-context-ncr-only'));
    expect(setMapContext).toHaveBeenLastCalledWith('ncr-only');
    expect(
      (screen.getByTestId('map-context-ncr-only') as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('switching Map Context does NOT reset flood-layer selections', async () => {
    const { user, setMapContext } = await setup();
    // Enable a couple of thematic layers first.
    await user.click(screen.getByTestId('layer-checkbox-barangayFloodRisk'));
    await user.click(screen.getByTestId('layer-checkbox-communityReports'));

    // Switch presentation context (default is nearby; switch to NCR only).
    await user.click(screen.getByTestId('map-context-ncr-only'));
    expect(setMapContext).toHaveBeenLastCalledWith('ncr-only');

    // Layer selections are untouched by the presentation switch.
    expect(
      (screen.getByTestId('layer-checkbox-barangayFloodRisk') as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (screen.getByTestId('layer-checkbox-communityReports') as HTMLInputElement)
        .checked,
    ).toBe(true);
    // Current-risk legend (from Flood Risk being on) still shows.
    expect(screen.getByTestId('map-legend')).toBeInTheDocument();
  });

  it('coverage badge remains Metro Manila / NCR in both contexts', async () => {
    const { user } = await setup();
    expect(screen.getByTestId('coverage-badge')).toHaveTextContent(
      /Metro Manila \/ NCR/i,
    );
    await user.click(screen.getByTestId('map-context-ncr-only'));
    expect(screen.getByTestId('coverage-badge')).toHaveTextContent(
      /Metro Manila \/ NCR/i,
    );
  });
});

describe('MapView — trip flow entry (Search → Compare → Start)', () => {
  it('shows the route SEARCH panel as the first interaction, not Driver Mode', () => {
    const { manager } = makeFakeManager();
    render(<MapView config={CONFIG} createMapManager={() => manager} />);
    // The search panel is present on load; the driving HUD is not.
    expect(screen.getByTestId('route-search-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('driving-hud')).toBeNull();
    // The trip host renders the search step.
    expect(screen.getByTestId('trip-host')).toBeInTheDocument();
  });

  it('has no standalone drive/Play control (removed in the redesign)', () => {
    const { manager } = makeFakeManager();
    render(<MapView config={CONFIG} createMapManager={() => manager} />);
    expect(
      screen.queryByRole('button', { name: /simulate drive|stop simulated drive/i }),
    ).toBeNull();
  });

  it('advances to the COMPARE step after finding routes for PITX → MOA', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const { manager } = makeFakeManager();
    render(<MapView config={CONFIG} createMapManager={() => manager} />);

    // Choose PITX as origin.
    await user.click(screen.getByLabelText('From'));
    await user.type(screen.getByLabelText('From'), 'PITX');
    await user.click(screen.getByText(/PITX/));

    // Choose SM Mall of Asia as destination — completing the pair AUTOMATICALLY
    // requests routes (no manual Find routes button).
    await user.click(screen.getByLabelText('To'));
    await user.type(screen.getByLabelText('To'), 'Mall of Asia');
    await user.click(screen.getByText(/Mall of Asia/));

    // Compare panel appears automatically with the demo route options + Start.
    // planRoutes resolves asynchronously (Promise), so await its appearance.
    expect(await screen.findByTestId('route-compare-panel')).toBeInTheDocument();
    expect(screen.getByTestId('start-route-button')).toBeInTheDocument();
    expect(screen.queryByTestId('route-search-panel')).toBeNull();
  });
});

describe('MapView — route preview (auto lines + selection + Start)', () => {
  async function pickPitxToMoa(user: ReturnType<typeof import('@testing-library/user-event').default.setup>) {
    await user.click(screen.getByLabelText('From'));
    await user.type(screen.getByLabelText('From'), 'PITX');
    await user.click(screen.getByText(/PITX/));
    await user.click(screen.getByLabelText('To'));
    await user.type(screen.getByLabelText('To'), 'Mall of Asia');
    await user.click(screen.getByText(/Mall of Asia/));
  }

  it('draws the route preview on the map automatically and previews (not Driver Mode)', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const { manager, showRoutePreview } = makeFakeManager();
    render(<MapView config={CONFIG} createMapManager={() => manager} />);

    await pickPitxToMoa(user);

    // Preview panel appears and the map preview overlay was drawn.
    expect(await screen.findByTestId('route-compare-panel')).toBeInTheDocument();
    expect(showRoutePreview).toHaveBeenCalledTimes(1);
    // Called with the candidate routes, a selected id, and the O/D endpoints.
    const [routes, selectedId, ends] = showRoutePreview.mock.calls[0];
    expect(routes.length).toBeGreaterThan(0);
    expect(typeof selectedId).toBe('string');
    expect(ends).toHaveLength(2);
    // Still a preview — Driver Mode HUD is not shown.
    expect(screen.queryByTestId('driving-hud')).toBeNull();
  });

  it('selecting a different route updates the map emphasis', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const { manager, updateRoutePreviewSelection } = makeFakeManager();
    render(<MapView config={CONFIG} createMapManager={() => manager} />);

    await pickPitxToMoa(user);
    await screen.findByTestId('route-compare-panel');

    // The PITX→MOA demo yields two routes; select the alternative.
    await user.click(screen.getByTestId('route-card-pitx-moa-lowrisk'));
    expect(updateRoutePreviewSelection).toHaveBeenCalled();
    const calls = updateRoutePreviewSelection.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[1]).toBe('pitx-moa-lowrisk');
  });

  it('Start clears the preview and enters Driver Mode with the selected route', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const { manager, clearRoutePreview } = makeFakeManager();
    render(<MapView config={CONFIG} createMapManager={() => manager} />);

    await pickPitxToMoa(user);
    await screen.findByTestId('route-compare-panel');

    await user.click(screen.getByTestId('start-route-button'));
    expect(clearRoutePreview).toHaveBeenCalled();
    // Compare panel is gone once navigating begins.
    expect(screen.queryByTestId('route-compare-panel')).toBeNull();
  });
});

describe('MapView — location consent flow (privacy-first)', () => {
  it('does not request geolocation until the user consents via the dialog', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const { manager } = makeFakeManager();
    const requestLocation = vi.fn(
      async (): Promise<LocationResult> => ({ status: 'granted', lng: 121.0, lat: 14.6 }),
    );
    render(
      <MapView config={CONFIG} createMapManager={() => manager} requestLocation={requestLocation} />,
    );

    // No consent dialog and no geolocation on load.
    expect(screen.queryByTestId('location-consent-dialog')).toBeNull();
    expect(requestLocation).not.toHaveBeenCalled();

    // Pressing "Use current location" opens the consent dialog but does NOT
    // request geolocation yet.
    await user.click(screen.getByRole('button', { name: /use current location/i }));
    expect(screen.getByTestId('location-consent-dialog')).toBeInTheDocument();
    expect(requestLocation).not.toHaveBeenCalled();

    // "Not now" dismisses without any geolocation request.
    await user.click(screen.getByTestId('location-consent-decline'));
    expect(screen.queryByTestId('location-consent-dialog')).toBeNull();
    expect(requestLocation).not.toHaveBeenCalled();

    // Re-open and Allow: only now is geolocation requested.
    await user.click(screen.getByRole('button', { name: /use current location/i }));
    await user.click(screen.getByTestId('location-consent-allow'));
    expect(requestLocation).toHaveBeenCalledTimes(1);
  });

  it('surfaces a subtle denied status without breaking route planning', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const { manager } = makeFakeManager();
    const requestLocation = vi.fn(async (): Promise<LocationResult> => ({ status: 'denied' }));
    render(
      <MapView config={CONFIG} createMapManager={() => manager} requestLocation={requestLocation} />,
    );

    await user.click(screen.getByRole('button', { name: /use current location/i }));
    await user.click(screen.getByTestId('location-consent-allow'));

    // Denied is reflected in the subtle status; search/select remain usable.
    expect(await screen.findByTestId('location-privacy-status')).toHaveTextContent(
      /wasn't allowed/i,
    );
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /select on map/i }).length).toBeGreaterThan(0);
  });
});

describe('MapView — location arrow (consent-gated origin + 3D preview + recenter)', () => {
  it('first click shows consent (no geolocation); Allow sets origin + 3D preview', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const { manager, focusOrigin } = makeFakeManager();
    const requestLocation = vi.fn(
      async (): Promise<LocationResult> => ({ status: 'granted', lng: 121.0, lat: 14.6 }),
    );
    render(
      <MapView config={CONFIG} createMapManager={() => manager} requestLocation={requestLocation} />,
    );

    // First arrow click → consent dialog, no geolocation yet.
    await user.click(screen.getByRole('button', { name: 'Show my location' }));
    expect(screen.getByTestId('location-consent-dialog')).toBeInTheDocument();
    expect(requestLocation).not.toHaveBeenCalled();

    // Allow → geolocation requested, origin set, 3D origin preview invoked.
    await user.click(screen.getByTestId('location-consent-allow'));
    await screen.findByText(/using current location/i);
    expect(requestLocation).toHaveBeenCalledTimes(1);
    expect(focusOrigin).toHaveBeenCalledWith([121.0, 14.6], expect.anything());
  });

  it('reuses the session grant on a later click without re-showing consent', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const { manager, focusOrigin } = makeFakeManager();
    const requestLocation = vi.fn(
      async (): Promise<LocationResult> => ({ status: 'granted', lng: 121.0, lat: 14.6 }),
    );
    render(
      <MapView config={CONFIG} createMapManager={() => manager} requestLocation={requestLocation} />,
    );

    // Grant once via the arrow.
    await user.click(screen.getByRole('button', { name: 'Show my location' }));
    await user.click(screen.getByTestId('location-consent-allow'));
    await screen.findByText(/using current location/i);
    expect(focusOrigin).toHaveBeenCalledTimes(1);

    // Second arrow click: no consent dialog re-shown; it recenters to origin.
    await user.click(screen.getByRole('button', { name: 'Show my location' }));
    expect(screen.queryByTestId('location-consent-dialog')).toBeNull();
    expect(focusOrigin).toHaveBeenCalledTimes(2);
    // Only the single initial grant fetch occurred (recenter reused the origin).
    expect(requestLocation).toHaveBeenCalledTimes(1);
  });

  it('rejects an outside-NCR device location cleanly (route planning stays usable)', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const { manager, focusOrigin } = makeFakeManager();
    const requestLocation = vi.fn(
      async (): Promise<LocationResult> => ({ status: 'granted', lng: 125.0, lat: 10.0 }),
    );
    render(
      <MapView config={CONFIG} createMapManager={() => manager} requestLocation={requestLocation} />,
    );

    await user.click(screen.getByRole('button', { name: 'Show my location' }));
    await user.click(screen.getByTestId('location-consent-allow'));

    // Coverage message shown; no origin preview; search still available.
    expect(await screen.findByTestId('trip-notice')).toHaveTextContent(/NCR only/i);
    expect(focusOrigin).not.toHaveBeenCalled();
    expect(screen.getByLabelText('From')).toBeInTheDocument();
  });

  it('renders cambutton on the right side and opens webcam list on click', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const { manager } = makeFakeManager();
    const loadCameraSnapshot = vi.fn().mockResolvedValue({
      cameras: [
        {
          sourceId: 'cam-999',
          source: 'Windy',
          name: 'Roxas Blvd - Manila Bay',
          coordinates: [120.98, 14.58],
          mediaKind: 'image',
          mediaUrl: 'https://images.example.test/cam999.jpg',
          city: { id: 'manila', name: 'Manila' },
        },
      ],
      fetchedAt: 1700000000,
      stale: false,
    });

    render(
      <MapView
        config={CONFIG}
        createMapManager={() => manager}
        loadCameraSnapshot={loadCameraSnapshot}
      />,
    );

    const camBtn = screen.getByTestId('cambutton');
    expect(camBtn).toBeVisible();
    expect(screen.getByTestId('cam-panel')).not.toBeVisible();

    await user.click(camBtn);
    expect(screen.getByTestId('cam-panel')).toBeVisible();
    expect(await screen.findByText('Roxas Blvd - Manila Bay')).toBeVisible();
  });

  it('toggles controls collapse via the hamburger icon button across mobile and desktop', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const { manager } = makeFakeManager();

    render(<MapView config={CONFIG} createMapManager={() => manager} />);

    const controls = screen.getByTestId('map-controls');
    const menuBtn = screen.getByTestId('controls-menu-button');

    expect(menuBtn).toBeVisible();
    expect(menuBtn).toHaveAttribute('aria-expanded', 'false');
    expect(menuBtn).toHaveAttribute('aria-label', 'Open map controls');
    expect(controls).not.toHaveAttribute('data-mobile-open');
    const controlItems = controls.querySelector('#map-control-items');
    expect(controlItems).toContainElement(
      screen.getByRole('button', { name: /recenter map to metro manila/i }),
    );

    // Click hamburger button to expand controls
    await user.click(menuBtn);
    expect(menuBtn).toHaveAttribute('aria-expanded', 'true');
    expect(menuBtn).toHaveAttribute('aria-label', 'Close map controls');
    expect(controls).toHaveAttribute('data-mobile-open', 'true');

    // Click again to collapse controls
    await user.click(menuBtn);
    expect(menuBtn).toHaveAttribute('aria-expanded', 'false');
    expect(menuBtn).toHaveAttribute('aria-label', 'Open map controls');
    expect(controls).not.toHaveAttribute('data-mobile-open');
  });
});
