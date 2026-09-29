// src/components/MapView.tsx
//
// React wrapper around MapManager (design → Architecture: "React never touches
// the raw map object directly; MapView mounts a container div and delegates to
// MapManager"). On mount it creates a MapManager and calls init(); on unmount
// it calls destroy().
//
// Task 15.2 makes MapView the coherent whole:
//   - It renders the LoadingIndicator while tiles load and dismisses it on the
//     MapManager `onReady` (Req 1.5). On `onTileFailure` it shows the
//     ErrorMessage ("The map could not load") while keeping the app alive and
//     interactive (Req 1.6, 18.1).
//   - It renders the control cluster over the map: ZoomControls (wired to
//     MapManager.zoomIn/zoomOut), RecenterControl (→ MapManager.recenter),
//     LocationControl (→ MarkerManager origin marker + MapManager center), and
//     LayerControl (listing the DataSource layers, toggling via a
//     LayerRegistry.setVisibility over the real map).
//   - On ready, when a REAL map is present, it installs the flood
//     susceptibility layer (installFloodSusceptibility) via a LayerRegistry and
//     wires the susceptibility popup (installSusceptibilityPopup) to render a
//     FloodPopup. These real-integration paths are guarded so they only run
//     with a real map (getMap() returning a canvas-capable map) and never break
//     the injected fake-map tests (jsdom, no WebGL).
//   - It shows the DemoDataBadge whenever demo/fixture layers are present — in
//     Milestone 1 they always are (Req 15.2).
//
// Testability: the MapManager is created through an injectable `createMapManager`
// seam so a fake can be supplied in jsdom (no WebGL). The default builds a real
// MapManager; a `mapFactory` prop is forwarded to MapManager.init so the map
// constructor itself can also be faked without replacing the manager. The
// DataSource and MarkerManager factory are likewise injectable for tests.

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapManager, type MapFactory, type MinimalMap } from '../map/MapManager';
import type { AppConfig } from '../types/config';
import type { DataLayerMeta, DataSource, LayerId } from '../types/layer';
import { FixtureDataSource } from '../services/FixtureDataSource';
import { LoadingIndicator } from './overlays/LoadingIndicator';
import { ErrorMessage } from './overlays/ErrorMessage';
import { DemoDataBadge } from './overlays/DemoDataBadge';
import { FloodPopup, type FloodPopupProps } from './overlays/FloodPopup';
import { ZoomControls } from './controls/ZoomControls';
import { RecenterControl } from './controls/RecenterControl';
import { ViewModeControl } from './controls/ViewModeControl';
import { DriveSimulationControl } from './controls/DriveSimulationControl';
import { DriveSimulator } from '../simulation/DriveSimulator';
import { SIM_SPEED_MPS } from '../simulation/DriveSimulator';
import { PITX_TO_MOA_MANEUVERS, PITX_TO_MOA_ROUTE } from '../data/fixtures/pitxToMoaRoute';
import { PITX_TO_MOA_HAZARDS, type DriveHazard } from '../data/fixtures/driveHazards';
import { PITX_TO_MOA_REROUTES, type FloodReroute } from '../data/fixtures/floodReroutes';
import type { RouteManeuver } from '../data/fixtures/pitxToMoaRoute';
import {
  findRerouteOffer,
  formatRerouteDelta,
  stitchReroute,
  type RerouteOffer,
} from '../simulation/reroute';
import type { DriveFrame } from '../simulation/DriveSimulator';
import { RerouteOffer as RerouteOfferCard } from './driving/RerouteOffer';
import {
  computeNavState,
  formatDistance,
  formatDuration,
  type NavState,
} from '../simulation/navigation';
import { measureRoute, pointAlong } from '../simulation/routeGeometry';
import { FLOOD_STATE_COLORS } from '../map/basemap/colorTokens';
import { DrivingHud } from './driving/DrivingHud';
import type { DriveCameraMode, DriveMarker, DriveRadius, DriveUpdate } from '../map/MapManager';

/** The original PITX → MOA route, measured once (reroutes branch off it). */
const BASE_ROUTE = measureRoute(PITX_TO_MOA_ROUTE);

/** Demo hazard dots placed on the route (report colors, labeled in the HUD). */
const DRIVE_HAZARD_MARKERS: ReadonlyArray<DriveMarker> = (() => {
  const route = measureRoute(PITX_TO_MOA_ROUTE);
  return PITX_TO_MOA_HAZARDS.map((h) => ({
    position: pointAlong(route, h.atM),
    color: FLOOD_STATE_COLORS[h.state].hex,
  }));
})();
import { LocationControl } from './controls/LocationControl';
import { LayerControl } from './controls/LayerControl';
import { LayersButton } from './controls/LayersButton';
import { CloseIcon } from './controls/icons';
import { MapLegend } from './overlays/MapLegend';
import { MarkerManager, type MarkerManagerOptions } from './markers/markerManager';
import { mapboxMarkerFactory } from './markers/mapboxMarkerFactory';
import {
  requestLocation as defaultRequestLocation,
  type LocationResult,
} from '../services/geolocation';
import { LayerRegistry, type MapLayerAdapter } from '../layers/LayerRegistry';
import {
  installFloodSusceptibility,
  type SusceptibilityMapAdapter,
} from '../layers/floodSusceptibilityLayer';
import {
  installCityFloodSummary,
  type CitySummaryMapAdapter,
} from '../layers/cityFloodSummaryLayer';
import {
  installSusceptibilityPopup,
  type LngLatLike,
  type SusceptibilityPopupMap,
} from '../layers/susceptibilityPopup';
import {
  installCityFloodSummaryPopup,
  type CitySummaryPopupMap,
} from '../layers/cityFloodSummaryPopup';

/**
 * The minimal MapManager surface MapView depends on. A fake implementing this
 * can be injected via {@link MapViewProps.createMapManager} for tests.
 */
export interface MapManagerLike {
  init(options: {
    container: HTMLElement;
    config: AppConfig;
    onReady?: () => void;
    onTileFailure?: (reason: 'timeout' | 'error') => void;
    mapFactory?: MapFactory;
  }): unknown;
  destroy(): void;
  /** Optional imperative controls, present on the real MapManager. */
  zoomIn?: () => void;
  zoomOut?: () => void;
  recenter?: (durationMs?: number) => void;
  /** Switches the 2D/3D view (tilt + Standard 3D buildings). */
  set3D?: (on: boolean) => void;
  /** Demo driver view (follow camera + 3D radius). */
  startDriveView?: (
    route: ReadonlyArray<[number, number]>,
    markers?: ReadonlyArray<DriveMarker>,
  ) => void;
  updateDrive?: (update: DriveUpdate) => void;
  setDriveCamera?: (mode: DriveCameraMode) => void;
  setDriveRoute?: (route: ReadonlyArray<[number, number]>) => void;
  setDriveRadius?: (radius: DriveRadius) => void;
  endDriveView?: () => void;
  /**
   * Frames the tuned NCR overview (Req 1.2). Called on ready so startup shows
   * Metro Manila centered and dominant. Optional so minimal fakes stay valid.
   */
  frameOverview?: () => void;
  /** Returns the underlying map instance, or null before init / after destroy. */
  getMap?: () => MinimalMap | null;
}

export interface MapViewProps {
  /** App config carrying the Tile_Provider API key (used to build the style). */
  config: AppConfig;
  /** Called once when the base map has loaded (Req 1.5). Defaults to a no-op. */
  onReady?: () => void;
  /** Called at most once when the base map fails to load (Req 1.6). Defaults to a no-op. */
  onTileFailure?: (reason: 'timeout' | 'error') => void;
  /**
   * Injectable factory for the MapManager. Defaults to constructing a real
   * MapManager. Tests supply a fake so mount/unmount can be exercised without
   * a real WebGL map.
   */
  createMapManager?: () => MapManagerLike;
  /**
   * Optional mapbox-gl map constructor override forwarded to
   * MapManager.init. Lets tests fake the map without replacing the manager.
   */
  mapFactory?: MapFactory;
  /**
   * The DataSource whose layers populate the LayerControl and drive the demo
   * badge. Defaults to the fixture-backed source (Milestone 1). Injectable for
   * tests.
   */
  dataSource?: DataSource;
  /**
   * Factory for the MarkerManager used to drop the current-location marker.
   * Defaults to a real Mapbox-backed manager. Injectable so tests can avoid
   * constructing real markers.
   */
  createMarkerManager?: (options: MarkerManagerOptions) => MarkerManager;
  /**
   * Startup current-location request (Req 2.1). Called ONCE after the map is
   * ready. On `granted` the Current_Location_Marker is placed WITHOUT moving
   * the camera; on denied/unavailable/timeout the Overview_State framing is
   * preserved (Req 2.2, 2.4, 21.1). Distinct from the user-initiated
   * LocationControl path (`handleLocated`), which MAY center on the user.
   * Defaults to the real `requestLocation`; injectable so tests can supply a
   * fake without a real browser Geolocation API.
   */
  requestLocation?: () => Promise<LocationResult>;
}

const noop = (): void => undefined;

/** Loading phase of the base map, driving which overlay (if any) is shown. */
type MapPhase = 'loading' | 'ready' | 'error';

/**
 * A map that also supports the layer/source/popup integration surface. The real
 * mapboxgl.Map satisfies this; a fake injected in tests generally does not,
 * which is how the integration paths stay guarded to real maps only.
 */
type IntegrableMap = MinimalMap &
  MapLayerAdapter &
  SusceptibilityMapAdapter &
  CitySummaryMapAdapter &
  SusceptibilityPopupMap &
  CitySummaryPopupMap;

/**
 * Best-effort check that a map object exposes the surface needed to install
 * layers/sources/popups. Fake maps used in jsdom tests lack these, so the
 * real-integration paths are skipped for them.
 */
function isIntegrableMap(map: MinimalMap | null | undefined): map is IntegrableMap {
  if (!map) return false;
  const m = map as Partial<IntegrableMap>;
  return (
    typeof m.addSource === 'function' &&
    typeof m.addLayer === 'function' &&
    typeof m.setLayoutProperty === 'function' &&
    typeof m.getLayer === 'function'
  );
}

/**
 * Mounts a full-size container div for the map, manages the MapManager
 * lifecycle, renders loading/error/demo overlays, and renders the control
 * cluster over the map.
 */
export function MapView({
  config,
  onReady = noop,
  onTileFailure = noop,
  createMapManager,
  mapFactory,
  dataSource,
  createMarkerManager,
  requestLocation = defaultRequestLocation,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const managerRef = useRef<MapManagerLike | null>(null);
  const markerManagerRef = useRef<MarkerManager | null>(null);
  const uninstallPopupRef = useRef<(() => void) | null>(null);
  const uninstallCityPopupRef = useRef<(() => void) | null>(null);

  const [phase, setPhase] = useState<MapPhase>('loading');
  const [failureReason, setFailureReason] = useState<'timeout' | 'error' | null>(null);
  /** Popup props + position for the currently selected susceptibility area. */
  const [popup, setPopup] = useState<{ props: FloodPopupProps; lngLat: LngLatLike } | null>(null);

  // The DataSource is stable for the component lifetime; default to fixtures.
  const source = useMemo<DataSource>(() => dataSource ?? new FixtureDataSource(), [dataSource]);
  const layers = useMemo<DataLayerMeta[]>(() => source.listLayers(), [source]);
  const hasDemoLayers = useMemo(() => layers.some((layer) => layer.isDemo), [layers]);

  // Registry over the real map, created on ready so LayerControl toggles hit it.
  const registryRef = useRef<LayerRegistry | null>(null);

  // Keep the latest callbacks in refs so the mount effect stays stable (runs
  // once) without going stale on callback identity changes.
  const onReadyRef = useRef(onReady);
  const onTileFailureRef = useRef(onTileFailure);
  onReadyRef.current = onReady;
  onTileFailureRef.current = onTileFailure;

  // Latest startup location requester, kept in a ref so the once-only mount
  // effect never goes stale on prop identity changes.
  const requestLocationRef = useRef(requestLocation);
  requestLocationRef.current = requestLocation;
  // Guards the startup current-location request so it runs at most once per
  // mounted map (Req 2.1), independent of the user-initiated LocationControl.
  const startupLocationRequestedRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const manager = createMapManager ? createMapManager() : new MapManager();
    managerRef.current = manager;

    manager.init({
      container,
      config,
      onReady: () => {
        setPhase('ready');
        // Explicitly frame the tuned NCR overview now that the base map is
        // ready (Req 1.1). This is the single OVERVIEW-framing camera move at
        // startup; the granted-location path below must NOT move the camera.
        manager.frameOverview?.();
        onReadyRef.current();
        wireRealMapIntegration(manager);
        // Startup current-location behavior, DISTINCT from the user-initiated
        // LocationControl (handleLocated). It places the Current_Location_Marker
        // when permission is granted but never moves/zooms the camera, so the
        // overview framing above is preserved (Req 2.1, 2.2, 2.3). On
        // denied/unavailable/timeout it does nothing to the camera and never
        // throws (Req 2.4, 21.1).
        void requestStartupLocation();
      },
      onTileFailure: (reason) => {
        setPhase('error');
        setFailureReason(reason);
        onTileFailureRef.current(reason);
      },
      mapFactory,
    });

    return () => {
      if (uninstallPopupRef.current) {
        uninstallPopupRef.current();
        uninstallPopupRef.current = null;
      }
      if (uninstallCityPopupRef.current) {
        uninstallCityPopupRef.current();
        uninstallCityPopupRef.current = null;
      }
      markerManagerRef.current?.destroy();
      markerManagerRef.current = null;
      registryRef.current = null;
      manager.destroy();
      managerRef.current = null;
    };
    // The map is created once for the lifetime of the mounted component; config
    // and the injected seams are treated as fixed for that lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * On ready, when a REAL (integrable) map is present, install the flood
   * susceptibility layer through a LayerRegistry and wire the click/tap popup.
   * Guarded so it is a no-op for the injected fake maps used in jsdom tests, and
   * wrapped in try/catch so a failure here never crashes the app (Req 18.1).
   */
  function wireRealMapIntegration(manager: MapManagerLike): void {
    const map = manager.getMap?.() ?? null;
    if (!isIntegrableMap(map)) {
      // Fake map (tests) or no map: skip real integration, stay interactive.
      return;
    }

    try {
      const registry = new LayerRegistry(map);
      registryRef.current = registry;
      // Fire-and-forget: the async installs load fixtures and add layers; a
      // rejection is caught so it never surfaces as an unhandled error.
      //
      // The per-city MODELED susceptibility SUMMARY is the LOWEST app layer
      // (just above the basemap). It reproduces the NCR overview composition and
      // is rendered BELOW the hazard-shaped susceptibility polygons and all
      // reports/routes; the LayerRegistry enforces that z-order regardless of
      // install order. It renders by default so flood awareness is visible in
      // OVERVIEW (Req 5). This is a modeled/historical summary, not current
      // flooding — labeling + popup make that explicit.
      void installCityFloodSummary(map, registry).catch(() => undefined);
      void installFloodSusceptibility(map, registry).catch(() => undefined);

      uninstallPopupRef.current = installSusceptibilityPopup(
        map as SusceptibilityPopupMap,
        (props, lngLat) => setPopup({ props, lngLat }),
      );
      uninstallCityPopupRef.current = installCityFloodSummaryPopup(
        map as CitySummaryPopupMap,
        (props, lngLat) => setPopup({ props, lngLat }),
      );
    } catch {
      // Integration is best-effort; the base map + controls stay usable.
    }
  }

  /** Ensures a MarkerManager exists over the real map (lazy, real-map only). */
  function ensureMarkerManager(): MarkerManager | null {
    if (markerManagerRef.current) return markerManagerRef.current;
    const map = managerRef.current?.getMap?.() ?? null;
    if (!map) return null;
    const factory =
      createMarkerManager ?? ((options: MarkerManagerOptions) => new MarkerManager(options));
    try {
      const manager = factory({ map, markerFactory: mapboxMarkerFactory });
      markerManagerRef.current = manager;
      return manager;
    } catch {
      return null;
    }
  }

  /**
   * Startup current-location behavior (Req 2.1–2.4, 21.1). Runs at most once
   * per mounted map. On a granted result it places the Current_Location_Marker
   * via the MarkerManager (reusing ensureMarkerManager/setOrigin) WITHOUT any
   * camera move — the overview framing from onReady stays intact. On
   * denied/unavailable/timeout it leaves the camera untouched. Never throws:
   * requestLocation itself never rejects, and any incidental error is swallowed
   * so the Overview_State stays framed and interactive.
   *
   * This is deliberately separate from the user-initiated LocationControl path
   * (handleLocated), which MAY center on the user (Req 2.3).
   */
  async function requestStartupLocation(): Promise<void> {
    if (startupLocationRequestedRef.current) return;
    startupLocationRequestedRef.current = true;

    try {
      const result = await requestLocationRef.current();
      if (result.status !== 'granted') {
        // Denied/unavailable/timeout: keep the NCR overview framed and
        // interactive; make no camera move (Req 2.4, 21.1).
        return;
      }
      // Granted: place the marker only. Guarded to a real map + MarkerManager
      // (mirrors handleLocated) so jsdom fake-map tests need no WebGL. Crucially
      // we do NOT call flyTo/easeTo/frameOverview here (Req 2.2, 2.3).
      const markerManager = ensureMarkerManager();
      markerManager?.setOrigin(result.lng, result.lat);
    } catch {
      // Defensive only: requestLocation never rejects, but a fake could. Keep
      // the overview framed and interactive regardless (Req 2.4, 21.1).
    }
  }

  // Enhancement: Escape closes an open popup regardless of where focus is.
  const popupOpen = popup !== null;
  useEffect(() => {
    if (!popupOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPopup(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [popupOpen]);

  const handleZoomIn = (): void => managerRef.current?.zoomIn?.();
  const handleZoomOut = (): void => managerRef.current?.zoomOut?.();
  const handleRecenter = (): void => managerRef.current?.recenter?.();

  // 2D/3D view. Starts in 2D (the existing overview); 3D keeps center/zoom.
  const [is3D, setIs3D] = useState(false);
  const handleViewModeToggle = (next: boolean): void => {
    // The driver view owns the camera while a drive is running.
    if (simulatorRef.current) return;
    setIs3D(next);
    managerRef.current?.set3D?.(next);
  };

  // Demo: simulated PITX → MOA drive. While it runs, the normal controls are
  // replaced by the driving HUD (next turn, hazard ahead, trip progress).
  const [driving, setDriving] = useState(false);
  const [nav, setNav] = useState<NavState | null>(null);
  const [driveCamera, setDriveCameraState] = useState<DriveCameraMode>('driver');
  const [driveRadius, setDriveRadiusState] = useState<DriveRadius>(250);
  const simulatorRef = useRef<DriveSimulator | null>(null);
  /** Last rendered HUD key: only re-render React when displayed text changes. */
  const navKeyRef = useRef('');

  // Reroute: offered while driving (the car never stops) when a demo flood
  // report is within 1 km. If the driver passes the branch point of an offered
  // reroute without choosing, it is missed and the next reroute is offered.
  const [offer, setOffer] = useState<RerouteOffer | null>(null);
  /** Hazards the driver chose to keep driving through: stop offering. */
  const dismissedRef = useRef<Set<string>>(new Set());
  /** Hazards still ahead on the ACTIVE route (empty after a reroute). */
  const activeHazardsRef = useRef<ReadonlyArray<DriveHazard>>(PITX_TO_MOA_HAZARDS);
  /** Reroutes available on the ACTIVE route (empty after a reroute). */
  const activeReroutesRef = useRef<ReadonlyArray<FloodReroute>>(PITX_TO_MOA_REROUTES);
  /** Latest frame, so a tap uses the vehicle's current position. */
  const lastFrameRef = useRef<DriveFrame | null>(null);
  /** Identity of the rendered offer, to avoid per-frame React updates. */
  const offerKeyRef = useRef('');

  const stopDrive = (): void => {
    simulatorRef.current?.stop();
    simulatorRef.current = null;
    managerRef.current?.endDriveView?.();
    navKeyRef.current = '';
    offerKeyRef.current = '';
    dismissedRef.current = new Set();
    activeHazardsRef.current = PITX_TO_MOA_HAZARDS;
    activeReroutesRef.current = PITX_TO_MOA_REROUTES;
    lastFrameRef.current = null;
    setOffer(null);
    setNav(null);
    setDriving(false);
  };

  /** Current reroute offer for a frame on the active (original) route. */
  const offerFor = (frame: DriveFrame, hazardId: string | null): RerouteOffer | null =>
    findRerouteOffer(
      BASE_ROUTE,
      frame.traveledM,
      hazardId,
      activeReroutesRef.current,
      dismissedRef.current,
      SIM_SPEED_MPS,
    );

  /** Plays `route` (optionally from `fromM`), driving the camera + HUD. */
  const runSimulator = (
    manager: MapManagerLike,
    route: ReadonlyArray<[number, number]>,
    maneuvers: ReadonlyArray<RouteManeuver>,
    fromM = 0,
  ): void => {
    simulatorRef.current?.stop();
    const simulator: DriveSimulator = new DriveSimulator({
      route,
      onFrame: (frame) => {
        lastFrameRef.current = frame;
        manager.updateDrive?.(frame);
        const state = computeNavState(
          frame.traveledM,
          frame.lengthM,
          maneuvers,
          activeHazardsRef.current,
          SIM_SPEED_MPS,
        );
        const pending = offerFor(frame, state.hazard?.id ?? null);
        const offerKey = pending
          ? `${pending.reroute.hazardId}@${pending.reroute.fromM}|${formatRerouteDelta(pending)}|${formatDistance(pending.toBranchM)}|${pending.isRetry}`
          : '';
        if (offerKey !== offerKeyRef.current) {
          offerKeyRef.current = offerKey;
          setOffer(pending);
        }
        const key = [
          state.next?.atM,
          formatDistance(state.toNextM),
          state.hazard?.id,
          state.hazard ? formatDistance(state.toHazardM) : '',
          formatDistance(state.remainingM),
          formatDuration(state.remainingS),
        ].join('|');
        if (key !== navKeyRef.current) {
          navKeyRef.current = key;
          setNav(state);
        }
      },
      onFinish: stopDrive,
    });
    simulatorRef.current = simulator;
    simulator.start(fromM);
  };

  const handleDriveToggle = (next: boolean): void => {
    const manager = managerRef.current;
    if (!next || !manager?.startDriveView || !manager.updateDrive) {
      stopDrive();
      return;
    }
    // Drive starts in the Driver camera with the tight 250 m 3D radius.
    setDriveCameraState('driver');
    setDriveRadiusState(250);
    manager.setDriveCamera?.('driver');
    manager.setDriveRadius?.(250);
    manager.startDriveView(PITX_TO_MOA_ROUTE, DRIVE_HAZARD_MARKERS);
    setDriving(true);
    runSimulator(manager, PITX_TO_MOA_ROUTE, PITX_TO_MOA_MANEUVERS);
  };

  /**
   * Accepts the reroute FROM WHERE THE DRIVER IS: the vehicle is not moved.
   * The new route continues on the current road to the turn-off, then onto
   * the flood-avoiding road; directions and ETA update to it.
   */
  const handleReroute = (): void => {
    const manager = managerRef.current;
    const frame = lastFrameRef.current;
    if (!offer || !manager || !frame) return;
    // Re-evaluate at tap time: the car kept moving since the card rendered.
    const fresh = offerFor(frame, offer.reroute.hazardId);
    if (!fresh) return; // Too late for any turn-off; nothing to switch to.
    const next = stitchReroute(BASE_ROUTE, PITX_TO_MOA_MANEUVERS, fresh.reroute, frame.traveledM);
    if (!next) return; // Not joinable on real roads (never offered in practice).
    // The reroute excludes every demo hazard, so none remain ahead on it.
    activeHazardsRef.current = [];
    activeReroutesRef.current = [];
    offerKeyRef.current = '';
    navKeyRef.current = '';
    setOffer(null);
    manager.setDriveRoute?.(next.route);
    runSimulator(manager, next.route, next.maneuvers);
  };

  /** Keeps the current route; no more reroutes for this hazard. */
  const handleKeepRoute = (): void => {
    if (!offer) return;
    dismissedRef.current.add(offer.reroute.hazardId);
    offerKeyRef.current = '';
    setOffer(null);
  };

  const handleDriveCamera = (mode: DriveCameraMode): void => {
    setDriveCameraState(mode);
    managerRef.current?.setDriveCamera?.(mode);
  };
  const handleDriveRadius = (radius: DriveRadius): void => {
    setDriveRadiusState(radius);
    managerRef.current?.setDriveRadius?.(radius);
  };
  // Stop the animation loop if the map unmounts mid-drive.
  useEffect(() => () => simulatorRef.current?.stop(), []);

  /**
   * On a granted location, drop/move the current-location (origin) marker and
   * center the map. Guarded so it is a no-op without a real map (tests).
   */
  const handleLocated = (lng: number, lat: number): void => {
    const markerManager = ensureMarkerManager();
    markerManager?.setOrigin(lng, lat);
    const map = managerRef.current?.getMap?.() ?? null;
    const flyable = map as { flyTo?: (options: unknown) => void } | null;
    flyable?.flyTo?.({ center: [lng, lat] });
  };

  const handleLayerToggle = (id: LayerId, visible: boolean): void => {
    const registry = registryRef.current;
    if (!registry) return;
    // The registry only manages app-managed canvas layers; ignore others.
    try {
      registry.setVisibility(id as never, visible);
    } catch {
      // Non-app layer ids are not registry-managed; ignore safely.
    }
  };

  return (
    <div className="baharoute-map-view" data-testid="map-view">
      <div
        ref={containerRef}
        className="baharoute-map"
        data-testid="map-container"
        role="application"
        aria-label="Metro Manila interactive map"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />

      {/* Loading overlay: shown while tiles load, dismissed on ready (Req 1.5). */}
      {phase === 'loading' && <LoadingIndicator />}

      {/* Error overlay: shown on tile failure/timeout; app stays interactive. */}
      {phase === 'error' && <ErrorMessage reason={failureReason ?? undefined} />}

      {/* Demo-data badge: visible whenever demo/fixture layers are present. */}
      {hasDemoLayers && <DemoDataBadge />}

      {/*
        Control cluster over the map. Placement is driven entirely by the
        `baharoute-controls` class in src/styles/layout.css, whose CSS
        custom-property tokens switch at the 768px breakpoint (Task 16):
        mobile anchors the cluster to the lower two-thirds (bottom), desktop
        flips it to a spaced top-right column. The hardcoded inline
        right/top positioning was removed in favor of that class.
      */}
      {/* Driving mode replaces the normal controls + legend while a drive runs. */}
      {driving && nav && (
        <DrivingHud
          nav={nav}
          camera={driveCamera}
          radius={driveRadius}
          onCameraChange={handleDriveCamera}
          onRadiusChange={handleDriveRadius}
          onStop={stopDrive}
        >
          {offer && nav.hazard && (
            <RerouteOfferCard
              offer={offer}
              hazard={nav.hazard}
              toHazardM={nav.toHazardM}
              onReroute={handleReroute}
              onKeep={handleKeepRoute}
            />
          )}
        </DrivingHud>
      )}

      <div
        className="baharoute-controls"
        data-testid="map-controls"
        hidden={driving}
        style={driving ? { display: 'none' } : undefined}
      >
        <ZoomControls onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} />
        <div className="baharoute-control-card baharoute-control-card--single">
          <RecenterControl onRecenter={handleRecenter} />
        </div>
        <div className="baharoute-control-card baharoute-control-card--single">
          <ViewModeControl is3D={is3D || driving} onToggle={handleViewModeToggle} />
        </div>
        <div className="baharoute-control-card baharoute-control-card--single">
          <DriveSimulationControl running={driving} onToggle={handleDriveToggle} />
        </div>
        <div className="baharoute-control-card baharoute-control-card--single">
          <LocationControl onLocated={handleLocated} />
        </div>
        {/* Enhancement: layer list opens on demand instead of always covering the map. */}
        <LayersButton>
          <LayerControl layers={layers} onToggle={handleLayerToggle} />
        </LayersButton>
      </div>

      {/* Enhancement: collapsible legend explaining the flood colors. */}
      {phase !== 'error' && !driving && <MapLegend />}

      {/* Susceptibility popup, rendered as React state driven by map clicks. */}
      {popup && (
        // Enhancement: floating card (desktop) / bottom sheet (mobile) with an
        // icon close button; Escape also closes it. Placement lives in layout.css.
        <div className="baharoute-popup-host" data-testid="map-popup-host">
          <button
            type="button"
            className="baharoute-popup-close baharoute-icon-button baharoute-focus-ring"
            aria-label="Close popup"
            onClick={() => setPopup(null)}
          >
            <CloseIcon />
          </button>
          <FloodPopup {...popup.props} />
        </div>
      )}
    </div>
  );
}

export default MapView;
