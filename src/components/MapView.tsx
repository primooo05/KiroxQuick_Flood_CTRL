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
import {
  MapManager,
  type MapContext,
  type MapFactory,
  type MinimalMap,
} from '../map/MapManager';
import type { AppConfig } from '../types/config';
import type { DataLayerMeta, DataSource, LayerId } from '../types/layer';
import { FixtureDataSource } from '../services/FixtureDataSource';
import { LoadingIndicator } from './overlays/LoadingIndicator';
import { ErrorMessage } from './overlays/ErrorMessage';
import { DemoDataBadge } from './overlays/DemoDataBadge';
import { CoverageBadge } from './overlays/CoverageBadge';
import { FloodPopup, type FloodPopupProps } from './overlays/FloodPopup';
import { ZoomControls } from './controls/ZoomControls';
import { RecenterControl } from './controls/RecenterControl';
import { ViewModeControl } from './controls/ViewModeControl';
import { MapContextControl } from './controls/MapContextControl';
import { RotateControl } from './controls/RotateControl';
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
import { measureRoute, pointAlong, type MeasuredRoute } from '../simulation/routeGeometry';
import {
  RouteSearchPanel,
  type TripEndpoint,
  type PickTarget,
  type LocationStatus,
} from './trip/RouteSearchPanel';
import { RouteComparePanel } from './trip/RouteComparePanel';
import { LocationConsentDialog } from './trip/LocationConsentDialog';
import {
  planRoutes,
  compareRoutes,
  type RouteOption,
  type RoutePreference,
} from '../services/routePlanning';
import type { TravelMode } from '../services/directions';
import { isWithinNCR, UNSUPPORTED_AREA_MESSAGE } from '../services/ncrPlaces';
import { currentRiskLabel, formatRelativeTime } from '../layers/riskLabels';
import { isDataQualityState } from '../types/risk';
import { FLOOD_STATE_COLORS, HISTORICAL_RISK_COLORS } from '../map/basemap/colorTokens';
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
import { CameraMarkerManager } from './markers/cameraMarkerManager';
import { mapboxCameraMarkerFactory } from './markers/mapboxCameraFactory';
import {
  clipCameraViewportToNcr,
  fetchWindyCameraImageUrl,
  fetchWindyCameras,
  type CameraViewportBounds,
  type WindyCameraSnapshot,
} from '../services/windyCameraService';
import { fetchCameraWeather } from '../services/cameraWeatherService';
import { isCameraCityVisible } from '../layers/cameraWebcamLayer';
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
import {
  installBarangayFloodRisk,
  setSelectedBarangay,
  barangayRiskFillOpacityExpression,
  barangayRiskFillOpacityDimmedExpression,
  BARANGAY_RISK_SOURCE_ID,
  BARANGAY_RISK_FILL_LAYER_ID,
  type BarangayRiskMapAdapter,
  type FeatureStateMap,
} from '../layers/barangayFloodRiskLayer';
import {
  installBarangayPopup,
  type BarangayPopupMap,
} from '../layers/barangayPopup';
import {
  installReportMarkers,
  installReportPopups,
  updateCommunityReportsSource,
  COMMUNITY_REPORTS_LAYER_ID,
  type PointLayerMapAdapter,
  type PointSourceUpdateMap,
  type ReportPopupMap,
} from '../layers/reportMarkersLayer';
import {
  installCityContext,
  type CityContextMapAdapter,
} from '../layers/cityContextLayer';
import { ReportPopup, type ReportPopupProps } from './overlays/ReportPopup';
import { FloodInsights, type InsightsTab, type SheetState } from './insights/FloodInsights';
import { HistoricalExplorePanel } from './insights/HistoricalExplorePanel';
import { historicalRiskByBarangay } from '../data/historical/ncrHistoricalFloodRisk';
import {
  applyHistoricalRiskStates,
  applyHistoricalFilter,
  historicalFillOpacityExpression,
  historicalFillOpacityDimmedExpression,
  setSelectedHistoricalBarangay,
  buildHistoricalSource,
  buildHistoricalFillLayer,
  buildHistoricalOutlineLayer,
  buildHistoricalSelectedLayer,
  buildHistoricalBarangayLabelLayer,
  buildHistoricalSelectedLabelLayer,
  buildBarangayLabelSource,
  cityLabelFilter,
  selectedLabelFilter,
  cityBounds,
  barangayBounds,
  DEFAULT_HISTORICAL_FILTER,
  HISTORICAL_RISK_SOURCE_ID,
  HISTORICAL_RISK_FILL_LAYER_ID,
  HISTORICAL_RISK_OUTLINE_LAYER_ID,
  HISTORICAL_SELECTED_LAYER_ID,
  HISTORICAL_LABEL_LAYER_ID,
  HISTORICAL_LABEL_SELECTED_LAYER_ID,
  HISTORICAL_LABEL_SOURCE_ID,
  type HistoricalFilterState,
  type HistoricalMapAdapter,
  type HistoricalFeatureStateMap,
} from '../layers/historicalFloodRisk';
import {
  buildCityBoundarySource,
  buildCityBoundaryLayer,
  buildCityBoundarySelectedLayer,
  installCityHover,
  installCityClick,
  applyCityFocus,
  CITY_BOUNDARY_SOURCE_ID,
  CITY_BOUNDARY_LAYER_ID,
  CITY_BOUNDARY_SELECTED_LAYER_ID,
  type CityBoundaryMapAdapter,
  type CityBoundaryFeatureStateMap,
  type CityHoverInfo,
  type CityHoverMap,
  type CityClickMap,
} from '../layers/historicalCityBoundary';
import {
  installHistoricalHover,
  type HistoricalHoverInfo,
  type HistoricalHoverMap,
} from '../layers/historicalHover';
import {
  BarangayRiskController,
  type RiskControllerStatus,
} from '../services/barangayRiskController';
import { LiveStatusPill } from './overlays/LiveStatusPill';
import {
  resolvePrimaryLeftPanel,
  type PrimaryLeftPanel,
} from './primaryLeftPanel';
import type { TimelineStep } from '../types/risk';
import type { CommunityReport } from '../types/report';
import {
  communityReportFixtures,
  COMMUNITY_REPORTS_DEMO_SOURCE,
} from '../data/fixtures/communityReports';
import { loadOfficialConfirmations } from '../data/fixtures/officialConfirmations';

/** Dev-only Driver-Mode diagnostics: on in Vite dev, off in prod and tests. */
function driveDiagnosticsEnabled(): boolean {
  try {
    const env = (import.meta as { env?: { DEV?: boolean; MODE?: string } }).env;
    return Boolean(env?.DEV) && env?.MODE !== 'test';
  } catch {
    return false;
  }
}

/**
 * Logs the route-following state for one frame (throttled to ~1/sec of traveled
 * distance) so divergence between the interpolated position and the route line
 * is observable during development. Suppressed in production and under test.
 */
function logDriveFrame(
  route: MeasuredRoute,
  frame: DriveFrame,
): void {
  if (!driveDiagnosticsEnabled()) return;
  // Locate the current segment index for the traveled distance.
  const { cumulative } = route;
  let seg = 0;
  while (seg < cumulative.length - 1 && cumulative[seg + 1] < frame.traveledM) seg += 1;
  // eslint-disable-next-line no-console
  console.debug('[drive]', {
    coords: route.points.length,
    totalM: Math.round(route.length),
    traveledM: Math.round(frame.traveledM),
    segment: seg,
    lng: frame.position[0].toFixed(6),
    lat: frame.position[1].toFixed(6),
    bearing: Math.round(frame.bearing),
  });
}

/**
 * A thin, persistent Driver-Mode banner summarizing the CHOSEN route's flood
 * risk plus data freshness ("Route risk: Elevated · Updated 3 minutes ago").
 * It is intentionally minimal (not a modal) and uses a cached snapshot of the
 * route's aggregate risk captured at Start, so GPS movement does not re-query
 * the environment. Freshness comes from the shared risk-controller status.
 */
function DriveRiskBanner({
  option,
  status,
}: {
  option: RouteOption;
  status: RiskControllerStatus | null;
}) {
  const level = option.risk.level;
  const riskText =
    option.risk.dataUnavailable || isDataQualityState(level)
      ? 'Current information unavailable'
      : currentRiskLabel(level);
  const freshness =
    status && status.lastUpdated !== null
      ? `Updated ${formatRelativeTime(status.lastUpdated)}`
      : 'Live flood data unavailable';
  return (
    <div className="baharoute-drive-risk" role="status" data-testid="drive-risk-banner">
      <span className="baharoute-drive-risk__label">Route risk: {riskText}</span>
      <span className="baharoute-drive-risk__sep" aria-hidden="true">
        ·
      </span>
      <span className="baharoute-drive-risk__freshness">{freshness}</span>
    </div>
  );
}

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
  /** Switches the Map Context presentation (NCR-only ↔ nearby areas). */
  setMapContext?: (context: MapContext) => void;
  /** Rotates the map by a signed degree delta (positive = clockwise). */
  rotateBy?: (deltaDeg: number, durationMs?: number) => void;
  /** Resets the map bearing to north (0). */
  resetNorth?: (durationMs?: number) => void;
  /** Reserves the next camera-intent token (stale-move guard). */
  nextCameraToken?: () => number;
  /** Smoothly focuses a chosen origin for a 3D preview (not Driver Mode). */
  focusOrigin?: (origin: [number, number], token?: number, bearing?: number) => void;
  /** Frames both trip points (origin + destination) with a mild 3D pitch. */
  framePoints?: (
    a: [number, number],
    b: [number, number],
    token?: number,
  ) => void;
  /** Draws the pre-drive route preview (selected emphasized + alternatives faded). */
  showRoutePreview?: (
    routes: ReadonlyArray<{ id: string; geometry: ReadonlyArray<[number, number]> }>,
    selectedId: string,
    ends: [[number, number], [number, number]],
  ) => void;
  /** Re-emphasizes the preview for a newly selected route id. */
  updateRoutePreviewSelection?: (
    routes: ReadonlyArray<{ id: string; geometry: ReadonlyArray<[number, number]> }>,
    selectedId: string,
  ) => void;
  /** Binds a click on alternative route lines → route id; returns teardown. */
  onRoutePreviewSelect?: (onSelect: (routeId: string) => void) => () => void;
  /** Removes the route-preview overlays. */
  clearRoutePreview?: () => void;
  /** Current map bearing in degrees [0, 360). */
  getBearing?: () => number;
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
  /** Optional same-origin camera service override, primarily for integration tests. */
  loadCameraSnapshot?: (signal?: AbortSignal) => Promise<WindyCameraSnapshot>;
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
 * Sets a raw Mapbox layout `visibility` on a specific layer id, guarded so a
 * missing layer/map is a safe no-op. Used for companion layers (e.g. the
 * barangay-risk outline) that the LayerRegistry does not own.
 */
function setLayoutVisibility(
  map: unknown,
  layerId: string,
  visible: boolean,
): void {
  try {
    (map as { setLayoutProperty?: (l: string, k: string, v: unknown) => void })
      ?.setLayoutProperty?.(layerId, 'visibility', visible ? 'visible' : 'none');
  } catch {
    // Layer not present; ignore safely.
  }
}

/**
 * Sets a raw Mapbox PAINT property on a layer, guarded so a missing layer/map
 * is a safe no-op. Used only for visual co-existence when both flood layers are
 * on (dim the historical fill) — it never changes data or feature-state.
 */
function setPaint(map: unknown, layerId: string, name: string, value: unknown): void {
  try {
    (map as { setPaintProperty?: (l: string, k: string, v: unknown) => void })
      ?.setPaintProperty?.(layerId, name, value);
  } catch {
    // Layer not present; ignore safely.
  }
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
  loadCameraSnapshot,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const managerRef = useRef<MapManagerLike | null>(null);
  const markerManagerRef = useRef<MarkerManager | null>(null);
  const cameraMarkerManagerRef = useRef<CameraMarkerManager | null>(null);
  const cameraSnapshotRef = useRef<WindyCameraSnapshot | null>(null);
  const uninstallPopupRef = useRef<(() => void) | null>(null);
  const uninstallCityPopupRef = useRef<(() => void) | null>(null);
  const uninstallBarangayPopupRef = useRef<(() => void) | null>(null);
  const uninstallReportPopupRef = useRef<(() => void) | null>(null);
  /** Owns the live barangay current-risk pipeline (rainfall → risk → paint). */
  const riskControllerRef = useRef<BarangayRiskController | null>(null);
  const unsubscribeRiskStatusRef = useRef<(() => void) | null>(null);
  /** Teardown for the community-report change listener (marker refresh). */
  const unsubscribeReportsRef = useRef<(() => void) | null>(null);
  /** Teardown for the barangay-source-ready reapply listener (sourcedata). */
  const uninstallRiskReapplyRef = useRef<(() => void) | null>(null);
  /** Teardown for the historical hover-tooltip listener. */
  const uninstallHistoricalHoverRef = useRef<(() => void) | null>(null);
  /** Teardown for the city hover-tooltip listener. */
  const uninstallCityHoverRef = useRef<(() => void) | null>(null);
  /** Teardown for the city map-click (select city) listener. */
  const uninstallCityClickRef = useRef<(() => void) | null>(null);
  /** Latest city-click handler, so the map click uses fresh state. */
  const cityClickHandlerRef = useRef<(cityPsgc: string) => void>(() => undefined);
  /** Teardown for the route-preview map-line click selection. */
  const uninstallRoutePreviewClickRef = useRef<(() => void) | null>(null);
  /** Latest route-select handler, so the map-line click uses fresh state. */
  const selectRouteHandlerRef = useRef<(id: string) => void>(() => undefined);
  /** Current Map Context, mirrored for the once-only ready handler. */
  const mapContextRef = useRef<MapContext>('nearby');
  /** Teardown for the map rotate-event listener that syncs the compass. */
  const uninstallRotateSyncRef = useRef<(() => void) | null>(null);
  /** Teardown for the "select on map" (trip pick) click listener. */
  const uninstallPickClickRef = useRef<(() => void) | null>(null);
  /**
   * Live visibility of the app-managed layers, read by the click handlers to
   * enforce interaction PRIORITY. When Current Flood Risk is visible, the
   * historical (susceptibility / city-summary) popup handlers defer so the
   * current-risk panel is what opens on a barangay click.
   */
  const layerVisibilityRef = useRef<Partial<Record<LayerId, boolean>>>({
    barangayFloodRisk: false,
    communityReports: false,
    officialClosures: false,
    floodSusceptibility: false,
  });

  const [phase, setPhase] = useState<MapPhase>('loading');
  const [failureReason, setFailureReason] = useState<'timeout' | 'error' | null>(null);
  /**
   * The currently open popup. Either a susceptibility/city FloodPopup or a
   * barangay current-risk info panel, tagged by `kind`.
   */
  const [popup, setPopup] = useState<
    | { kind: 'flood'; props: FloodPopupProps; lngLat: LngLatLike }
    | { kind: 'barangay'; psgc: string; lngLat?: LngLatLike }
    | { kind: 'report'; props: ReportPopupProps; lngLat: LngLatLike }
    | null
  >(null);
  /** Live rainfall/risk status for the compact status pill. */
  const [riskStatus, setRiskStatus] = useState<RiskControllerStatus | null>(null);
  /** Selected short-term timeline step (NOW / +30 MIN / +1 HR). */
  const [timelineStep, setTimelineStep] = useState<TimelineStep>('now');
  /**
   * Which thematic layers are currently enabled. ALL default OFF on initial
   * load (only the Mapbox base map shows). This React state drives legend and
   * warning visibility; `layerVisibilityRef` mirrors it for the once-only mount
   * effect (click-priority) which cannot read state directly. Kept for the
   * browser session — toggling the layer drawer does not reset it.
   */
  const [layerVisible, setLayerVisible] = useState<Record<
    'barangayFloodRisk' | 'communityReports' | 'officialClosures' | 'floodSusceptibility',
    boolean
  >>({
    barangayFloodRisk: false,
    communityReports: false,
    officialClosures: false,
    floodSusceptibility: false,
  });
  const floodRiskVisible = layerVisible.barangayFloodRisk;
  const historicalVisible = layerVisible.floodSusceptibility;
  /**
   * The Historical Flood Risk filter (View by NCR/City/Barangay + city/barangay
   * selectors + risk-class filter). Independent of current-risk state; drives
   * the historical layer's per-barangay `histShown` feature-state.
   */
  const [historicalFilter, setHistoricalFilter] = useState<HistoricalFilterState>(
    DEFAULT_HISTORICAL_FILTER,
  );
  /**
   * Active tab of the unified Flood Insights panel. Remembered across barangay
   * selections so a user who prefers "Historical" keeps it; a barangay click
   * only overrides it when exactly one flood layer is enabled (see below).
   */
  const [insightsTab, setInsightsTab] = useState<InsightsTab>('current');
  /** Mobile bottom-sheet height state for Flood Insights. */
  const [insightsSheet, setInsightsSheet] = useState<SheetState>('half');
  /** Hovered historical barangay (name/city/class + cursor point), or null. */
  const [historicalHover, setHistoricalHover] = useState<HistoricalHoverInfo | null>(null);
  /** Hovered city boundary (name/count + cursor point), or null. */
  const [cityHover, setCityHover] = useState<CityHoverInfo | null>(null);
  /**
   * Bumps whenever the risk controller repaints (poll tick / report added), so
   * an open barangay panel re-derives its props from the latest live data.
   */
  const [riskRevision, setRiskRevision] = useState(0);
  /**
   * Map Context presentation mode. Defaults to "nearby" (surrounding areas
   * shown for orientation); thematic data stays NCR-only regardless. Preserved
   * for the browser session; switching it never resets flood-layer selections
   * and never touches rainfall/risk state — it only re-styles the basemap
   * presentation.
   */
  const [mapContext, setMapContext] = useState<MapContext>('nearby');

  // The DataSource is stable for the component lifetime; default to fixtures.
  const source = useMemo<DataSource>(() => dataSource ?? new FixtureDataSource(), [dataSource]);
  const sourceLayers = useMemo<DataLayerMeta[]>(() => source.listLayers(), [source]);
  const hasDemoLayers = useMemo(() => sourceLayers.some((layer) => layer.isDemo), [sourceLayers]);

  /**
   * The curated LayerControl entries for this feature: the primary Current
   * Barangay Flood Risk layer (default on), the Baseline Flood Susceptibility
   * reference (default off), Community Reports and Confirmed Closures overlays
   * (default off). These map to app-managed canvas layers toggled via the
   * LayerRegistry in {@link handleLayerToggle}.
   */
  const currentLayerMetas = useMemo<DataLayerMeta[]>(
    () => [
      {
        id: 'barangayFloodRisk',
        label: 'Flood Risk',
        // Longer descriptive name for assistive tech.
        ariaLabel: 'Current barangay flood risk',
        isDemo: true,
        defaultVisible: false,
      },
      {
        id: 'communityReports',
        label: 'Community Reports',
        ariaLabel: 'Community flood reports (unconfirmed)',
        isDemo: true,
        defaultVisible: false,
      },
      {
        id: 'officialClosures',
        label: 'Confirmed Closures',
        ariaLabel: 'Confirmed road or area closures',
        isDemo: true,
        defaultVisible: false,
      },
    ],
    [],
  );
  const referenceLayerMetas = useMemo<DataLayerMeta[]>(
    () => [
      {
        id: 'floodSusceptibility',
        label: 'Historical Flood Risk',
        ariaLabel: 'Historical flood susceptibility (reference)',
        isDemo: true,
        defaultVisible: false,
      },
    ],
    [],
  );
  /** Flat list (for empty-state checks) + grouped presentation (Current/Reference). */
  const layers = useMemo<DataLayerMeta[]>(
    () => [...currentLayerMetas, ...referenceLayerMetas],
    [currentLayerMetas, referenceLayerMetas],
  );
  const layerGroups = useMemo(
    () => [
      { title: 'Current', layers: currentLayerMetas },
      { title: 'Reference', layers: referenceLayerMetas },
    ],
    [currentLayerMetas, referenceLayerMetas],
  );

  // Registry over the real map, created on ready so LayerControl toggles hit it.
  const registryRef = useRef<LayerRegistry | null>(null);

  // Keep the latest callbacks in refs so the mount effect stays stable (runs
  // once) without going stale on callback identity changes.
  const onReadyRef = useRef(onReady);
  const onTileFailureRef = useRef(onTileFailure);
  onReadyRef.current = onReady;
  onTileFailureRef.current = onTileFailure;


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
        // Apply the current Map Context presentation (default NCR-only) once the
        // basemap + mask are ready, so a mode chosen before ready is honored.
        manager.setMapContext?.(mapContextRef.current);
        // PRIVACY-FIRST: BahaRoute does NOT request the device location on load.
        // The user's location is "Not shared" until they explicitly consent via
        // the "Use current location" flow. No navigator.geolocation call, no
        // browser permission prompt, no origin inferred, no camera move here.
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
      if (uninstallBarangayPopupRef.current) {
        uninstallBarangayPopupRef.current();
        uninstallBarangayPopupRef.current = null;
      }
      if (uninstallReportPopupRef.current) {
        uninstallReportPopupRef.current();
        uninstallReportPopupRef.current = null;
      }
      if (uninstallRotateSyncRef.current) {
        uninstallRotateSyncRef.current();
        uninstallRotateSyncRef.current = null;
      }
      if (uninstallPickClickRef.current) {
        uninstallPickClickRef.current();
        uninstallPickClickRef.current = null;
      }
      if (unsubscribeRiskStatusRef.current) {
        unsubscribeRiskStatusRef.current();
        unsubscribeRiskStatusRef.current = null;
      }
      if (unsubscribeReportsRef.current) {
        unsubscribeReportsRef.current();
        unsubscribeReportsRef.current = null;
      }
      if (uninstallRiskReapplyRef.current) {
        uninstallRiskReapplyRef.current();
        uninstallRiskReapplyRef.current = null;
      }
      if (uninstallHistoricalHoverRef.current) {
        uninstallHistoricalHoverRef.current();
        uninstallHistoricalHoverRef.current = null;
      }
      if (uninstallCityHoverRef.current) {
        uninstallCityHoverRef.current();
        uninstallCityHoverRef.current = null;
      }
      if (uninstallCityClickRef.current) {
        uninstallCityClickRef.current();
        uninstallCityClickRef.current = null;
      }
      if (uninstallRoutePreviewClickRef.current) {
        uninstallRoutePreviewClickRef.current();
        uninstallRoutePreviewClickRef.current = null;
      }
      if (riskControllerRef.current) {
        riskControllerRef.current.stop();
        riskControllerRef.current = null;
      }
      markerManagerRef.current?.destroy();
      markerManagerRef.current = null;
      cameraMarkerManagerRef.current?.destroy();
      cameraMarkerManagerRef.current = null;
      registryRef.current = null;
      manager.destroy();
      managerRef.current = null;
    };
    // The map is created once for the lifetime of the mounted component; config
    // and the injected seams are treated as fixed for that lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live camera data is an independent overlay. Query only the visible NCR
  // viewport on map movement; open image popups renew URLs by webcam ID.
  useEffect(() => {
    if (phase !== 'ready') return;
    const map = managerRef.current?.getMap?.() ?? null;
    if (!isIntegrableMap(map)) return;

    const markerManager = new CameraMarkerManager({
      map,
      factory: mapboxCameraMarkerFactory,
      refreshImageUrl: (webcamId, signal) => fetchWindyCameraImageUrl(webcamId, fetch, signal),
      loadWeather: (coordinates, signal) => fetchCameraWeather(coordinates, fetch, signal),
      canOpenPopup: (camera) => {
        const minimalMap = map as unknown as {
          getZoom?: () => number;
          getCenter?: () => { lng: number; lat: number } | [number, number];
          getBounds?: () => { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number };
        };
        const zoom = minimalMap.getZoom?.() ?? 12;
        const rawCenter = minimalMap.getCenter?.();
        const center: [number, number] | undefined = Array.isArray(rawCenter)
          ? rawCenter
          : rawCenter
            ? [rawCenter.lng, rawCenter.lat]
            : undefined;
        const rawBounds = minimalMap.getBounds?.();
        const bounds: [number, number, number, number] | undefined = rawBounds
          ? [rawBounds.getWest(), rawBounds.getSouth(), rawBounds.getEast(), rawBounds.getNorth()]
          : undefined;

        return isCameraCityVisible(camera, { zoom, center, bounds });
      },
    });
    cameraMarkerManagerRef.current = markerManager;

    const mapWithBounds = map as IntegrableMap & {
      getBounds?: () => { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number };
    };
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let requestController: AbortController | null = null;
    let requestSequence = 0;
    let lastViewportKey = '';
    let disposed = false;

    const currentViewport = (): CameraViewportBounds | null => {
      const bounds = mapWithBounds.getBounds?.();
      if (!bounds) return clipCameraViewportToNcr({ west: 120.9, south: 14.34, east: 121.15, north: 14.8 });
      return clipCameraViewportToNcr({
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      });
    };

    const loadViewport = async (forceFresh = false): Promise<void> => {
      const bounds = currentViewport();
      if (!bounds) {
        lastViewportKey = 'outside-ncr';
        requestSequence += 1;
        requestController?.abort();
        requestController = null;
        cameraSnapshotRef.current = null;
        markerManager.setCameras([]);
        return;
      }

      const key = [bounds.west, bounds.south, bounds.east, bounds.north]
        .map((value) => value.toFixed(5)).join(',');
      if (!forceFresh && key === lastViewportKey) return;
      lastViewportKey = key;
      const camerasAlreadyInViewport = cameraSnapshotRef.current?.cameras.filter((camera) => {
        const [longitude, latitude] = camera.coordinates;
        return longitude >= bounds.west && longitude <= bounds.east &&
          latitude >= bounds.south && latitude <= bounds.north;
      }) ?? [];
      markerManager.setCameras(camerasAlreadyInViewport);
      requestController?.abort();
      const controller = new AbortController();
      requestController = controller;
      const sequence = ++requestSequence;

      try {
        const snapshot = loadCameraSnapshot
          ? await loadCameraSnapshot(controller.signal)
          : await fetchWindyCameras(fetch, controller.signal, bounds, forceFresh);
        if (disposed || sequence !== requestSequence) return;
        cameraSnapshotRef.current = snapshot;
        markerManager.setCameras(snapshot.cameras);
      } catch (error) {
        if (disposed || sequence !== requestSequence || (error instanceof DOMException && error.name === 'AbortError')) return;
        if (lastViewportKey === key) lastViewportKey = '';
        cameraSnapshotRef.current = null;
        markerManager.setCameras([]);
      } finally {
        if (requestController === controller) requestController = null;
      }
    };

    const scheduleViewportLoad = (): void => {
      const bounds = currentViewport();
      const observedKey = bounds
        ? [bounds.west, bounds.south, bounds.east, bounds.north].map((value) => value.toFixed(5)).join(',')
        : 'outside-ncr';
      if (observedKey !== lastViewportKey) {
        requestSequence += 1;
        requestController?.abort();
        requestController = null;
      }
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void loadViewport();
      }, 180);
    };

    map.on('moveend', scheduleViewportLoad);
    map.on('zoomend', scheduleViewportLoad);
    void loadViewport(true);

    return () => {
      disposed = true;
      requestSequence += 1;
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      requestController?.abort();
      map.off('moveend', scheduleViewportLoad);
      map.off('zoomend', scheduleViewportLoad);
      markerManager.destroy();
      cameraMarkerManagerRef.current = null;
    };
  }, [phase, loadCameraSnapshot]);

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

    // Keep the compass in sync with rotation done via gestures OR the control.
    try {
      const onRotate = (): void => setBearing(manager.getBearing?.() ?? 0);
      const rotatingMap = map as unknown as {
        on?: (t: string, l: () => void) => void;
        off?: (t: string, l: () => void) => void;
      };
      rotatingMap.on?.('rotate', onRotate);
      uninstallRotateSyncRef.current = () => rotatingMap.off?.('rotate', onRotate);
    } catch {
      // Rotation sync is best-effort; the control still works imperatively.
    }

    // "Select on map" for the trip flow: while a pick is active, the next map
    // click resolves an origin/destination. NCR-gated; out-of-NCR taps surface
    // the unsupported-area message and do NOT set the endpoint.
    try {
      const clickMap = map as unknown as {
        on?: (t: string, l: (e: { lngLat?: { lng: number; lat: number } }) => void) => void;
        off?: (t: string, l: (e: { lngLat?: { lng: number; lat: number } }) => void) => void;
      };
      const onClick = (e: { lngLat?: { lng: number; lat: number } }): void => {
        if (!e.lngLat) return;
        // Report-flooding pick takes priority when active: the next NCR tap
        // drops an unconfirmed community report at that point.
        if (reportPickActiveRef.current) {
          handleReportMapPick(e.lngLat.lng, e.lngLat.lat);
          return;
        }
        const target = pickTargetRef.current;
        if (!target) return;
        handleMapPick(target, e.lngLat.lng, e.lngLat.lat);
      };
      clickMap.on?.('click', onClick);
      uninstallPickClickRef.current = () => clickMap.off?.('click', onClick);
    } catch {
      // Best-effort; search + current location still set endpoints.
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
      // These installs are ASYNC (they load fixtures then add layers). Their
      // layers are added visible by default, so we must hide them AFTER the
      // install resolves — hiding synchronously here would run before the
      // layers exist and leave "Historical Flood Risk" showing on load. All
      // thematic layers start OFF; the user opts in via the layer drawer.
      void installCityFloodSummary(map, registry)
        .then(() => registry.setVisibility('cityFloodSummary', false))
        .catch(() => undefined);
      void installFloodSusceptibility(map, registry)
        .then(() => registry.setVisibility('floodSusceptibility', false))
        .catch(() => undefined);

      // HISTORICAL Flood Risk (derived Project NOAH / Phil-LiDAR per-barangay
      // susceptibility). Its own source + fill + outline, painted STATICALLY
      // via feature-state (no live API). Installed hidden; the "Historical
      // Flood Risk" layer toggle reveals it. Kept fully INDEPENDENT of the
      // current-risk layer/state.
      try {
        // Install in a deliberate BOTTOM→TOP order so the polygon hierarchy
        // holds (spec #8): city base boundary → barangay fill → barangay
        // outline → selected-city boundary → selected-barangay outline.
        const cityAdapter = map as unknown as CityBoundaryMapAdapter;
        cityAdapter.addSource(CITY_BOUNDARY_SOURCE_ID, buildCityBoundarySource());
        cityAdapter.addLayer(buildCityBoundaryLayer(CITY_BOUNDARY_SOURCE_ID));

        const brgyAdapter = map as unknown as HistoricalMapAdapter;
        brgyAdapter.addSource(HISTORICAL_RISK_SOURCE_ID, buildHistoricalSource());
        brgyAdapter.addLayer(buildHistoricalFillLayer(HISTORICAL_RISK_SOURCE_ID));
        brgyAdapter.addLayer(buildHistoricalOutlineLayer(HISTORICAL_RISK_SOURCE_ID));

        // Selected-city boundary above barangay fills, below selected barangay.
        cityAdapter.addLayer(buildCityBoundarySelectedLayer(CITY_BOUNDARY_SOURCE_ID));
        // Selected-barangay outline on top of everything.
        brgyAdapter.addLayer(buildHistoricalSelectedLayer(HISTORICAL_RISK_SOURCE_ID));
        // Dedicated barangay LABEL point source (official name + derived class
        // as display props) feeding two symbol layers: zoom-aware city-scoped
        // labels + an always-visible selected-barangay label. Pure projection
        // of existing data; the polygon fill stays the primary risk viz.
        brgyAdapter.addSource(HISTORICAL_LABEL_SOURCE_ID, buildBarangayLabelSource());
        // Zoom-aware barangay NAME+CLASS labels (scoped to the selected city via
        // setFilter below; starts matching nothing so NCR overview stays clean).
        brgyAdapter.addLayer(buildHistoricalBarangayLabelLayer(HISTORICAL_LABEL_SOURCE_ID));
        // Always-visible selected-barangay label (scoped to the selected psgc).
        brgyAdapter.addLayer(buildHistoricalSelectedLabelLayer(HISTORICAL_LABEL_SOURCE_ID));

        applyHistoricalRiskStates(map as unknown as HistoricalFeatureStateMap);
        applyHistoricalFilter(
          map as unknown as HistoricalFeatureStateMap,
          DEFAULT_HISTORICAL_FILTER,
        );
        applyCityFocus(map as unknown as CityBoundaryFeatureStateMap, null);

        for (const id of [
          CITY_BOUNDARY_LAYER_ID,
          CITY_BOUNDARY_SELECTED_LAYER_ID,
          HISTORICAL_RISK_FILL_LAYER_ID,
          HISTORICAL_RISK_OUTLINE_LAYER_ID,
          HISTORICAL_SELECTED_LAYER_ID,
          HISTORICAL_LABEL_LAYER_ID,
          HISTORICAL_LABEL_SELECTED_LAYER_ID,
        ]) {
          setLayoutVisibility(map, id, false);
        }

        // Barangay hover tooltip (name / city / historical class).
        uninstallHistoricalHoverRef.current = installHistoricalHover(
          map as unknown as HistoricalHoverMap,
          (info) => setHistoricalHover(info),
        );
        // City hover tooltip (city name + barangay count), city mode only.
        uninstallCityHoverRef.current = installCityHover(
          map as unknown as CityHoverMap,
          (info) => setCityHover(info),
        );
        // City map-line/polygon click → select that city (city mode).
        uninstallCityClickRef.current = installCityClick(
          map as unknown as CityClickMap,
          (cityPsgc) => cityClickHandlerRef.current(cityPsgc),
        );
      } catch {
        // Historical layer is best-effort; its absence never breaks the map.
      }

      // Historical popups DEFER to the current-risk panel: they only open when
      // Current Flood Risk is not the active context (its layer is hidden). This
      // enforces the interaction priority regardless of Mapbox handler order —
      // the current-risk handler always wins while its layer is visible.
      const historicalIsActiveContext = (): boolean =>
        layerVisibilityRef.current.barangayFloodRisk !== true;

      uninstallPopupRef.current = installSusceptibilityPopup(
        map as SusceptibilityPopupMap,
        (props, lngLat) => {
          if (!historicalIsActiveContext()) return;
          setPopup({ kind: 'flood', props, lngLat });
        },
      );
      uninstallCityPopupRef.current = installCityFloodSummaryPopup(
        map as CitySummaryPopupMap,
        (props, lngLat) => {
          if (!historicalIsActiveContext()) return;
          setPopup({ kind: 'flood', props, lngLat });
        },
      );

      // PRIMARY current-conditions layer: barangay-level current flood risk.
      // The polygon source is installed once; the live rainfall poll repaints
      // it via feature-state through the BarangayRiskController. Wrapped in its
      // own try so a failure here never breaks the baseline layers above.
      try {
        installBarangayFloodRisk(map as unknown as BarangayRiskMapAdapter, registry);
        // ALL thematic layers start hidden on initial load — only the base map
        // shows until the user enables a layer. The barangay-risk fill + its
        // outline start off too (the current-risk fill is added visible by the
        // registry, so hide it explicitly here).
        registry.setVisibility('barangayFloodRisk', false);
        setLayoutVisibility(map, 'barangayFloodRisk-outline', false);
        // Historical (floodSusceptibility) + cityFloodSummary are hidden in the
        // async install .then handlers above (they add their layers later).

        const controller = new BarangayRiskController({
          reports: [...communityReportFixtures],
          officials: [...loadOfficialConfirmations()],
        });
        riskControllerRef.current = controller;
        controller.attachMap(map as unknown as FeatureStateMap);
        // When a report is submitted at runtime, refresh the community-reports
        // marker source so the new (unconfirmed) point appears immediately. The
        // controller already recomputed risk + the panel count; this only
        // updates the marker geometry. Teardown clears the single listener.
        unsubscribeReportsRef.current = controller.onReportsChanged((reports) => {
          const liveMap = managerRef.current?.getMap?.() ?? null;
          if (!liveMap) return;
          updateCommunityReportsSource(
            liveMap as unknown as PointSourceUpdateMap,
            reports,
          );
        });
        unsubscribeRiskStatusRef.current = controller.onStatus((status) => {
          setRiskStatus(status);
          // Nudge any open barangay panel to re-derive from the latest data.
          setRiskRevision((r) => r + 1);
        });
        controller.start();

        // FIX (current-risk race): feature-state written before the barangay
        // GeoJSON source has parsed its features is SILENTLY DROPPED by Mapbox,
        // so the controller's early paints (on attach + first poll) can be lost
        // and the fill renders the invisible UNKNOWN fallback — the "Live —
        // updated Just now but no colors" symptom. Re-apply the latest risk
        // snapshot whenever the barangay source (re)loads and once the map goes
        // idle, so the states land as soon as the features exist. Cheap and
        // idempotent (feature-state is keyed by PSGC; applying all is fine).
        try {
          const evented = map as unknown as {
            on?: (t: string, l: (e?: unknown) => void) => void;
            off?: (t: string, l: (e?: unknown) => void) => void;
            isSourceLoaded?: (id: string) => boolean;
          };
          const onSourceData = (e?: unknown): void => {
            const ev = e as { sourceId?: string; isSourceLoaded?: boolean } | undefined;
            if (ev?.sourceId && ev.sourceId !== BARANGAY_RISK_SOURCE_ID) return;
            // Only reapply once the source's tiles are actually loaded.
            const loaded =
              ev?.isSourceLoaded ??
              evented.isSourceLoaded?.(BARANGAY_RISK_SOURCE_ID) ??
              true;
            if (loaded) riskControllerRef.current?.repaint();
          };
          const onIdle = (): void => riskControllerRef.current?.repaint();
          evented.on?.('sourcedata', onSourceData);
          evented.on?.('idle', onIdle);
          uninstallRiskReapplyRef.current = () => {
            evented.off?.('sourcedata', onSourceData);
            evented.off?.('idle', onIdle);
          };
        } catch {
          // Reapply is best-effort; the poll still repaints on each tick.
        }

        uninstallBarangayPopupRef.current = installBarangayPopup(
          map as unknown as BarangayPopupMap,
          // Only open the panel for barangays we can resolve.
          (psgc) => (controller.infoFor(psgc) ? psgc : null),
          (psgc, lngLat) => {
            // Default the Flood Insights tab from the active layer(s):
            //   only Current on  → Current; only Historical on → Historical;
            //   both on (or neither) → keep the user's last-selected tab.
            const currentOn = layerVisibilityRef.current.barangayFloodRisk === true;
            const historicalOn = layerVisibilityRef.current.floodSusceptibility === true;
            if (currentOn && !historicalOn) setInsightsTab('current');
            else if (historicalOn && !currentOn) setInsightsTab('historical');
            setInsightsSheet('half');
            setPopup({ kind: 'barangay', psgc, lngLat });
            // MAP → DROPDOWN sync: when the Historical layer is the active
            // context, clicking a barangay drills the Historical filter to that
            // barangay so the Explore panel's Barangay dropdown follows the map
            // (and the selected-barangay highlight stays in agreement). Data,
            // classification and PSGC mapping are untouched — this only moves
            // the filter selection.
            if (historicalOn) {
              const rec = historicalRiskByBarangay.get(psgc);
              if (rec) {
                setHistoricalFilter((prev) => ({
                  ...prev,
                  view: 'barangay',
                  cityPsgc: rec.cityPsgc,
                  barangayPsgc: psgc,
                }));
              }
            }
          },
          // Also listen on the historical fill so barangay selection works when
          // only the Historical layer is visible (its polygons share the PSGC
          // feature id). Fixes dead clicks in Historical-only mode.
          [HISTORICAL_RISK_FILL_LAYER_ID],
        );

        // Map-line selection: clicking an ALTERNATIVE route line selects it,
        // synced with the route cards. Bound once; the handler ref always points
        // at the latest selection logic so it uses current options.
        uninstallRoutePreviewClickRef.current =
          manager.onRoutePreviewSelect?.((routeId) =>
            selectRouteHandlerRef.current(routeId),
          ) ?? null;

        // Point overlays: community reports + official closures. installReport-
        // Markers adds them hidden and they STAY hidden until the user enables
        // them (all thematic layers OFF on initial load).
        installReportMarkers(
          map as unknown as PointLayerMapAdapter,
          registry,
          [...communityReportFixtures],
          [...loadOfficialConfirmations()],
        );
        uninstallReportPopupRef.current = installReportPopups(
          map as unknown as ReportPopupMap,
          (data, lngLat) =>
            setPopup({
              kind: 'report',
              props: {
                kind: data.kind,
                state: data.state,
                barangay: data.barangay,
                note: data.note,
                updatedAt: data.updatedAt,
                source: data.source,
              },
              lngLat,
            }),
        );
      } catch {
        // Barangay integration is best-effort; the rest of the map stays usable.
      }

      // ALWAYS-ON base geographic context: NCR City/LGU boundaries + labels.
      // Independent of every thematic layer (no toggle) and of the rainfall/
      // risk pipeline. Installed last so the city name labels sit on top and
      // stay readable; its own try so a failure never affects other layers.
      try {
        installCityContext(map as unknown as CityContextMapAdapter);
      } catch {
        // City context is best-effort base decoration.
      }
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

  // Selected-barangay highlight: mirror the open barangay popup to the map's
  // `selected` feature-state so exactly one barangay gets the stronger outline.
  // Clears when the popup closes or a non-barangay popup opens.
  const selectedPsgc = popup?.kind === 'barangay' ? popup.psgc : null;
  const previousSelectedRef = useRef<string | null>(null);
  /** Tracks the historical-layer selection so it can be cleared on change. */
  const historicalSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    const map = managerRef.current?.getMap?.() ?? null;
    setSelectedBarangay(
      map as FeatureStateMap | null,
      selectedPsgc,
      previousSelectedRef.current,
    );
    previousSelectedRef.current = selectedPsgc;
  }, [selectedPsgc]);

  const handleZoomIn = (): void => managerRef.current?.zoomIn?.();
  const handleZoomOut = (): void => managerRef.current?.zoomOut?.();
  const handleRecenter = (): void => managerRef.current?.recenter?.();

  // Map rotation: current bearing (degrees), kept in sync with the map so the
  // compass needle reflects rotation done via gestures too.
  const [bearing, setBearing] = useState(0);
  const handleRotateBy = (deltaDeg: number): void => {
    managerRef.current?.rotateBy?.(deltaDeg);
  };
  const handleResetNorth = (): void => {
    managerRef.current?.resetNorth?.();
  };

  // 2D/3D view. Starts in 2D (the existing overview); 3D keeps center/zoom.
  const [is3D, setIs3D] = useState(false);
  const handleViewModeToggle = (next: boolean): void => {
    // The driver view owns the camera while a drive is running.
    if (simulatorRef.current) return;
    setIs3D(next);
    managerRef.current?.set3D?.(next);
  };

  /**
   * Switches the MAP CONTEXT presentation (NCR-only ↔ nearby areas). Purely a
   * basemap-presentation change routed to MapManager.setMapContext; it does NOT
   * touch flood-layer selections, rainfall, or risk state. Preserved in React
   * state for the session so it survives drawer open/close.
   */
  const handleMapContextChange = (next: MapContext): void => {
    setMapContext(next);
    mapContextRef.current = next;
    managerRef.current?.setMapContext?.(next);
  };

  // Trip flow: Search → Compare → Navigate. The commuter first plans a trip
  // (origin/destination), compares flood-aware routes, then presses Start to
  // enter Driver Mode. Driver Mode is NEVER the first interaction and there is
  // no standalone Play button.
  type TripStage = 'search' | 'comparing' | 'navigating';
  const [tripStage, setTripStage] = useState<TripStage>('search');
  const [tripOrigin, setTripOrigin] = useState<TripEndpoint | null>(null);
  const [tripDestination, setTripDestination] = useState<TripEndpoint | null>(null);
  const [routeOptions, setRouteOptions] = useState<readonly RouteOption[]>([]);
  /** The route id selected in the preview (drives map emphasis + Start). */
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  /** Active travel mode for route planning (Drive/Bike/Walk). */
  const [travelMode, setTravelMode] = useState<TravelMode>('drive');
  /** Active route preference (ranking only; never changes geometry). */
  const [routePreference, setRoutePreference] =
    useState<RoutePreference>('lowerFloodExposure');
  /**
   * True once the user has EXPLICITLY picked a route card/line, so a preference
   * change preserves their choice instead of snapping to the new recommended.
   */
  const manualRouteSelectionRef = useRef<boolean>(false);
  /** Which endpoint (if any) is being picked by tapping the map. */
  const [pickTarget, setPickTarget] = useState<PickTarget>(null);
  const pickTargetRef = useRef<PickTarget>(null);
  /** True while "report flooding" map-pick mode is active (next tap = report). */
  const [reportPickActive, setReportPickActive] = useState(false);
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
  const reportPickActiveRef = useRef(false);
  /** A transient trip-flow notice (e.g. out-of-NCR tap/location). */
  const [tripNotice, setTripNotice] = useState<string | null>(null);
  /** True while route geometry is being fetched (disables Find routes). */
  const [findingRoutes, setFindingRoutes] = useState(false);
  /**
   * Device-location permission state. PRIVACY-FIRST: starts 'notRequested' and
   * only advances after the user explicitly consents in the BahaRoute dialog.
   * Held as runtime/session state only — never persisted, and precise
   * coordinates are never written to storage or logged.
   */
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('notRequested');
  /** Whether the BahaRoute location-consent dialog is open. */
  const [consentOpen, setConsentOpen] = useState(false);
  /**
   * True once the user has consented to device location THIS SESSION. Lets the
   * location arrow reuse the grant (fetch position + recenter) without showing
   * the consent dialog again. Session-only; never persisted.
   */
  const sessionLocationGrantedRef = useRef(false);

  // Driver Mode. While it runs, the normal controls + trip panels are replaced
  // by the driving HUD (next turn, flood-ahead banner, trip progress).
  const driving = tripStage === 'navigating';
  const [nav, setNav] = useState<NavState | null>(null);
  const [driveCamera, setDriveCameraState] = useState<DriveCameraMode>('driver');
  const [driveRadius, setDriveRadiusState] = useState<DriveRadius>(250);
  const simulatorRef = useRef<DriveSimulator | null>(null);
  /** Last rendered HUD key: only re-render React when displayed text changes. */
  const navKeyRef = useRef('');
  /**
   * The active route summary shown in Driver Mode (aggregate route risk +
   * freshness), captured at Start from the chosen option so GPS ticks do NOT
   * re-query the environment on every frame. A separate cached snapshot.
   */
  const [driveRisk, setDriveRisk] = useState<RouteOption | null>(null);

  // Reroute: offered while driving (the car never stops) when a demo flood
  // report is within 1 km. If the driver passes the branch point of an offered
  // reroute without choosing, it is missed and the next reroute is offered.
  const [offer, setOffer] = useState<RerouteOffer | null>(null);
  /** Hazards the driver chose to keep driving through: stop offering. */
  const dismissedRef = useRef<Set<string>>(new Set());
  /** Hazards still ahead on the ACTIVE route (empty after a reroute). */
  const activeHazardsRef = useRef<ReadonlyArray<DriveHazard>>([]);
  /** Reroutes available on the ACTIVE route (empty for non-demo routes). */
  const activeReroutesRef = useRef<ReadonlyArray<FloodReroute>>([]);
  /**
   * Measured geometry of the ACTIVE route's ORIGINAL line (reroutes branch off
   * it). For the PITX→MOA demo this is BASE_ROUTE; for other routes it is that
   * route's own measurement (no reroutes offered).
   */
  const activeBaseRouteRef = useRef<MeasuredRoute>(BASE_ROUTE);
  /** Maneuvers of the ACTIVE route's original line (for reroute stitching). */
  const activeBaseManeuversRef = useRef<ReadonlyArray<RouteManeuver>>(PITX_TO_MOA_MANEUVERS);
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
    activeHazardsRef.current = [];
    activeReroutesRef.current = [];
    lastFrameRef.current = null;
    setOffer(null);
    setNav(null);
    setDriveRisk(null);
    // Return to the comparison so the commuter can pick another route or search.
    setTripStage(routeOptions.length > 0 ? 'comparing' : 'search');
  };

  /** Current reroute offer for a frame on the active (original) route. */
  const offerFor = (frame: DriveFrame, hazardId: string | null): RerouteOffer | null =>
    findRerouteOffer(
      activeBaseRouteRef.current,
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
    // Measure the SAME geometry the simulator drives (dev diagnostics only).
    const measuredForDiag = measureRoute(route);
    const simulator: DriveSimulator = new DriveSimulator({
      route,
      onFrame: (frame) => {
        lastFrameRef.current = frame;
        logDriveFrame(measuredForDiag, frame);
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

  // ---- Trip flow (Search → Compare → Start) ------------------------------

  /** Builds the live route-planning context from the risk controller. */
  const routePlanningContext = () => {
    const controller = riskControllerRef.current;
    const status = controller?.status();
    return {
      riskByBarangay: controller ? (psgc: string) => controller.riskFor(psgc) : undefined,
      reportCountByBarangay: controller
        ? (psgc: string) => controller.reportCountFor(psgc)
        : undefined,
      closedBarangays: controller?.closedBarangays(),
      trend: controller?.overallTrend(),
      dataUnavailable: status ? status.dataUnavailable || status.dataStale : true,
    };
  };

  /**
   * Compares flood-aware routes for the chosen O/D and moves to Compare. Route
   * geometry is REAL and road-following: the flagship pair uses the bundled
   * offline route; other NCR pairs are routed via Mapbox Directions (token from
   * config) so the simulated drive follows roads rather than a straight line.
   */
  const handleFindRoutes = (origin: TripEndpoint, destination: TripEndpoint): void => {
    // Drop origin/destination markers immediately (real map only; no-op in tests).
    const markerManager = ensureMarkerManager();
    markerManager?.setOrigin(origin.coord[0], origin.coord[1]);
    markerManager?.setDestination(destination.coord[0], destination.coord[1]);
    setTripStage('comparing');
    // A fresh search resets any manual selection so the recommended route wins.
    manualRouteSelectionRef.current = false;
    void computeAndShowRoutes(origin, destination, travelMode, routePreference);
  };

  /**
   * Plans routes for the given O/D + travel MODE, compares them with the current
   * live flood context + PREFERENCE, updates the cards, selects the recommended
   * route (unless a manual selection should be preserved — handled by callers),
   * and draws the map preview. Shared by initial search, mode change, and
   * preference change. Never fabricates routes: it shows only what the provider
   * returns. Flood-data unavailability does NOT prevent routes from showing.
   */
  const computeAndShowRoutes = async (
    origin: TripEndpoint,
    destination: TripEndpoint,
    mode: TravelMode,
    preference: RoutePreference,
    preserveSelectedId: string | null = null,
  ): Promise<void> => {
    setFindingRoutes(true);
    try {
      const candidates = await planRoutes(origin.coord, destination.coord, {
        mapboxToken: config.tileKey,
        mode,
      });
      const options = compareRoutes(candidates, routePlanningContext(), preference);
      setRouteOptions(options);

      // Preserve an explicit manual selection when it still exists; otherwise
      // select the recommended (first, best-ranked) option.
      const preserved =
        preserveSelectedId != null &&
        options.some((o) => o.candidate.id === preserveSelectedId)
          ? preserveSelectedId
          : null;
      const nextId = preserved ?? options[0]?.candidate.id ?? null;
      setSelectedRouteId(nextId);

      if (nextId) {
        managerRef.current?.showRoutePreview?.(previewRoutesFor(options), nextId, [
          [origin.coord[0], origin.coord[1]],
          [destination.coord[0], destination.coord[1]],
        ]);
      } else {
        managerRef.current?.clearRoutePreview?.();
      }
    } finally {
      setFindingRoutes(false);
    }
  };

  /**
   * Travel-mode change (Drive/Bike/Walk): recalculates routes for the new mode
   * (fresh geometry — never reused across modes), clears any manual selection,
   * and selects the newly recommended route.
   */
  const handleModeChange = (mode: TravelMode): void => {
    if (mode === travelMode) return;
    setTravelMode(mode);
    manualRouteSelectionRef.current = false;
    setSelectedRouteId(null);
    const origin = tripOrigin;
    const destination = tripDestination;
    if (origin && destination) {
      void computeAndShowRoutes(origin, destination, mode, routePreference);
    }
  };

  /**
   * Route-preference change (Lower flood exposure ↔ Faster): RERANKS the
   * existing provider routes (no new fetch, geometry unchanged) and updates the
   * Recommended badge. Preserves an explicit manual selection; otherwise auto-
   * selects the new recommended route.
   */
  const handlePreferenceChange = (preference: RoutePreference): void => {
    if (preference === routePreference) return;
    setRoutePreference(preference);
    const reranked = compareRoutes(
      routeOptions.map((o) => o.candidate),
      routePlanningContext(),
      preference,
    );
    setRouteOptions(reranked);
    const keep =
      manualRouteSelectionRef.current &&
      selectedRouteId != null &&
      reranked.some((o) => o.candidate.id === selectedRouteId)
        ? selectedRouteId
        : (reranked[0]?.candidate.id ?? null);
    setSelectedRouteId(keep);
    if (keep) {
      managerRef.current?.updateRoutePreviewSelection?.(previewRoutesFor(reranked), keep);
    }
  };

  /** Maps compared options to the MapManager preview-route shape (id + geometry). */
  const previewRoutesFor = (
    options: readonly RouteOption[],
  ): Array<{ id: string; geometry: ReadonlyArray<[number, number]> }> =>
    options.map((o) => ({
      id: o.candidate.id,
      geometry: o.candidate.route as ReadonlyArray<[number, number]>,
    }));

  /**
   * Selects a route in the preview (from a card or a map line). Updates the map
   * emphasis so the chosen route becomes dominant; this selection is what Start
   * will use. Does not enter Driver Mode.
   */
  const handleSelectRoute = (id: string): void => {
    manualRouteSelectionRef.current = true;
    setSelectedRouteId(id);
    managerRef.current?.updateRoutePreviewSelection?.(previewRoutesFor(routeOptions), id);
  };
  // Keep the map-line click handler pointing at the latest selection logic so a
  // click on an alternative route line stays in sync with the current options.
  selectRouteHandlerRef.current = handleSelectRoute;

  /**
   * Applies a normalized ORIGIN and drives the "Origin 3D Preview" camera state.
   * All three inputs (device / search / map) funnel through here so downstream
   * logic never cares which produced it. Places the origin marker and smoothly
   * focuses the origin in 3D (a preview — NOT Driver Mode). If a destination
   * already exists, both points are framed instead.
   */
  const applyOrigin = (endpoint: TripEndpoint): void => {
    setTripNotice(null);
    setTripOrigin(endpoint);
    const [lng, lat] = endpoint.coord;
    ensureMarkerManager()?.setOrigin(lng, lat);
    const manager = managerRef.current;
    const token = manager?.nextCameraToken?.();
    if (tripDestination) {
      manager?.framePoints?.([lng, lat], [tripDestination.coord[0], tripDestination.coord[1]], token);
    } else {
      manager?.focusOrigin?.([lng, lat], token);
    }
  };

  /**
   * Applies a normalized DESTINATION and drives the "Origin + Destination
   * Overview" camera state (fit both points). Not Driver Mode.
   */
  const applyDestination = (endpoint: TripEndpoint): void => {
    setTripNotice(null);
    setTripDestination(endpoint);
    const [lng, lat] = endpoint.coord;
    ensureMarkerManager()?.setDestination(lng, lat);
    const manager = managerRef.current;
    const token = manager?.nextCameraToken?.();
    if (tripOrigin) {
      manager?.framePoints?.([tripOrigin.coord[0], tripOrigin.coord[1]], [lng, lat], token);
    } else {
      // No origin yet: just preview the destination point.
      manager?.focusOrigin?.([lng, lat], token);
    }
  };

  /** Routes a search-panel origin/destination change through the camera logic. */
  const handleOriginChange = (endpoint: TripEndpoint | null): void => {
    if (endpoint) applyOrigin(endpoint);
    else setTripOrigin(null);
  };
  const handleDestinationChange = (endpoint: TripEndpoint | null): void => {
    if (endpoint) applyDestination(endpoint);
    else setTripDestination(null);
  };

  /** Enters/exits "select on map" mode for an endpoint (selection click priority). */
  const handlePickOnMap = (target: PickTarget): void => {
    setPickTarget(target);
    pickTargetRef.current = target;
    if (target) setTripNotice(null);
  };

  /**
   * Resolves a map tap for the active pick target into a normalized endpoint.
   * NCR-gated: a tap outside coverage surfaces the coverage message and leaves
   * the endpoint unset. Exits pick mode immediately after a valid tap.
   */
  const handleMapPick = (target: PickTarget, lng: number, lat: number): void => {
    if (!target) return;
    if (!isWithinNCR(lng, lat)) {
      setTripNotice(UNSUPPORTED_AREA_MESSAGE);
      return;
    }
    const endpoint: TripEndpoint = { label: 'Dropped pin', coord: [lng, lat], source: 'map' };
    if (target === 'origin') applyOrigin(endpoint);
    else applyDestination(endpoint);
    setPickTarget(null);
    pickTargetRef.current = null;
  };

  /**
   * Enters/exits "report flooding" mode. While active, the next NCR map tap
   * drops an UNCONFIRMED community report (see handleReportMapPick). Mutually
   * exclusive with the trip endpoint pick so a tap is never ambiguous.
   */
  const handleReportFloodingToggle = (): void => {
    const next = !reportPickActive;
    setReportPickActive(next);
    reportPickActiveRef.current = next;
    if (next) {
      // Cancel any trip-endpoint pick so the two modes never both consume a tap.
      setPickTarget(null);
      pickTargetRef.current = null;
      setTripNotice(null);
    }
  };

  /**
   * Submits a user-reported, UNCONFIRMED community flood report at the tapped
   * point. NCR-gated. The report is ALWAYS UNCONFIRMED and carries the demo
   * community source — a user submission can never be verified or official, and
   * (via the risk model) can at most escalate a barangay to REPORTED_FLOODING,
   * NEVER CONFIRMED_NOT_PASSABLE. Reuses the controller's addReport (which
   * recomputes risk + report count) and the marker-refresh listener.
   */
  const handleReportMapPick = (lng: number, lat: number): void => {
    if (!isWithinNCR(lng, lat)) {
      setTripNotice(UNSUPPORTED_AREA_MESSAGE);
      return;
    }
    const controller = riskControllerRef.current;
    if (!controller) return;
    const now = Math.floor(Date.now() / 1000);
    const report: CommunityReport = {
      id: `user-report-${now}-${Math.round(lng * 1e4)}-${Math.round(lat * 1e4)}`,
      state: 'ORANGE',
      passable: false,
      metadata: {
        location: { lng, lat },
        source: COMMUNITY_REPORTS_DEMO_SOURCE,
        dataType: 'COMMUNITY_REPORT',
        updatedAt: now,
        verificationStatus: 'UNCONFIRMED',
        description:
          'User-submitted community report of flooding. Unverified / not authoritative.',
      },
    };
    controller.addReport(report);
    // Reveal the community-reports layer so the new (unconfirmed) point is
    // visible immediately, using the existing toggle path.
    if (!layerVisibilityRef.current.communityReports) {
      handleLayerToggle(COMMUNITY_REPORTS_LAYER_ID, true);
    }
    setReportPickActive(false);
    reportPickActiveRef.current = false;
    setTripNotice('Thanks — your unverified report was added to the map.');
  };

  /**
   * Smoothly recenters/zooms back to the CURRENT origin's 3D preview without
   * changing any state — used when the location arrow is pressed and an origin
   * already exists. Does not touch destination, layers, or route state.
   */
  const recenterOrigin = (): void => {
    if (!tripOrigin) return;
    const manager = managerRef.current;
    manager?.focusOrigin?.(
      [tripOrigin.coord[0], tripOrigin.coord[1]],
      manager.nextCameraToken?.(),
    );
  };

  /**
   * The shared device-location fetch used by BOTH the "Use current location"
   * chip and the location arrow, AFTER consent. Requests the browser position
   * (native prompt may appear), then:
   *  - granted + in NCR → set the device origin (normalized) + 3D preview,
   *  - granted + outside NCR → reject cleanly with the coverage message,
   *  - denied → subtle denied status (no re-prompt),
   *  - unavailable/timeout → subtle unavailable status.
   * Route planning stays usable in every branch. Coordinates are never
   * persisted or logged.
   */
  const fetchDeviceOrigin = (): void => {
    setLocationStatus('requesting');
    void requestLocation()
      .then((result) => {
        if (result.status === 'denied') {
          setLocationStatus('denied');
          return;
        }
        if (result.status !== 'granted') {
          setLocationStatus('unavailable');
          return;
        }
        // A successful grant is remembered for the session so the arrow can
        // reuse it without re-showing the consent dialog.
        sessionLocationGrantedRef.current = true;
        if (!isWithinNCR(result.lng, result.lat)) {
          setLocationStatus('allowed');
          setTripNotice(UNSUPPORTED_AREA_MESSAGE);
          return;
        }
        setLocationStatus('allowed');
        applyOrigin({
          label: 'Current location',
          coord: [result.lng, result.lat],
          source: 'device',
        });
      })
      .catch(() => {
        setLocationStatus('unavailable');
      });
  };

  /**
   * "Use current location" (search panel chip). PRIVACY-FIRST: opens the
   * BahaRoute consent dialog first; geolocation is only requested after Allow.
   * If the user already granted this session, it skips straight to the fetch.
   */
  const handleUseCurrentLocation = (): void => {
    setTripNotice(null);
    if (sessionLocationGrantedRef.current) {
      fetchDeviceOrigin();
      return;
    }
    setConsentOpen(true);
  };

  /**
   * Location arrow (map control). Same consent-first contract:
   *  - never requested this session → show consent, then fetch on Allow;
   *  - already granted this session + origin already set → recenter to it;
   *  - already granted this session + no origin yet → fetch + set origin.
   * Never resets destination, layers, or route.
   */
  const handleLocationArrow = (): void => {
    setTripNotice(null);
    if (!sessionLocationGrantedRef.current) {
      setConsentOpen(true);
      return;
    }
    if (tripOrigin && tripOrigin.source === 'device') {
      // Reuse the known device origin: recenter immediately (cheap, no fetch).
      recenterOrigin();
      return;
    }
    // Granted but no device origin yet (or origin came from search/map): fetch
    // the current position and set/recenter to it.
    fetchDeviceOrigin();
  };

  /** The user declined the consent dialog: no geolocation request occurs. */
  const handleConsentDismiss = (): void => {
    setConsentOpen(false);
  };

  /** The user consented: proceed to the (shared) geolocation fetch. */
  const handleConsentAllow = (): void => {
    setConsentOpen(false);
    fetchDeviceOrigin();
  };

  /**
   * Enters Driver Mode for the chosen route option — the ONLY entry into Driver
   * Mode. Captures the route's aggregate risk as a cached snapshot so GPS ticks
   * don't re-query the environment, then starts the simulator on the route.
   */
  const handleStartRoute = (option: RouteOption): void => {
    const manager = managerRef.current;
    const candidate = option.candidate;
    // Preserve the reroute demo ONLY for the flagship PITX→MOA primary route.
    const isDemoRoute = candidate.id === 'pitx-moa-primary';
    activeHazardsRef.current = candidate.hazards;
    activeReroutesRef.current = isDemoRoute ? PITX_TO_MOA_REROUTES : [];
    activeBaseRouteRef.current = measureRoute(candidate.route);
    activeBaseManeuversRef.current = candidate.maneuvers;
    dismissedRef.current = new Set();
    setDriveRisk(option);
    setTripStage('navigating');
    // Remove the flat route-preview overlays before the Driver Mode 3D camera.
    manager?.clearRoutePreview?.();

    if (!manager?.startDriveView || !manager.updateDrive) {
      // No real map (tests): still enter navigating so the HUD renders once nav
      // is computed; the simulator needs a manager to drive the camera.
      return;
    }
    // Drive starts in the Driver camera with the tight 250 m 3D radius.
    setDriveCameraState('driver');
    setDriveRadiusState(250);
    manager.setDriveCamera?.('driver');
    manager.setDriveRadius?.(250);
    const markers = isDemoRoute ? DRIVE_HAZARD_MARKERS : [];
    manager.startDriveView(candidate.route, markers);
    runSimulator(manager, candidate.route, candidate.maneuvers);
  };

  /** Returns to the search step, clearing the comparison; reframes the trip. */
  const handleTripBack = (): void => {
    setRouteOptions([]);
    setSelectedRouteId(null);
    setPickTarget(null);
    pickTargetRef.current = null;
    setTripStage('search');
    managerRef.current?.clearRoutePreview?.();
    // Reframe to the current planning context: both points if present, else the
    // origin preview, else the NCR overview. Tokened to beat stale moves.
    const manager = managerRef.current;
    const token = manager?.nextCameraToken?.();
    if (tripOrigin && tripDestination) {
      manager?.framePoints?.(
        [tripOrigin.coord[0], tripOrigin.coord[1]],
        [tripDestination.coord[0], tripDestination.coord[1]],
        token,
      );
    } else if (tripOrigin) {
      manager?.focusOrigin?.([tripOrigin.coord[0], tripOrigin.coord[1]], token);
    } else {
      manager?.frameOverview?.();
    }
  };

  /**
   * Re-opens the Route Compare panel from the recoverable "Route ready" chip,
   * restoring it as the primary left panel. Closes any open barangay Insights
   * (which otherwise outranks the route panel) so exactly one panel shows.
   */
  const handleViewRoute = (): void => {
    setPopup(null);
    setTripStage('comparing');
  };

  /**
   * The SINGLE primary left panel. Exactly one of these ever occupies the left
   * rail, by priority, so two full panels can never stack on top of each other
   * (the overlap bug). A barangay selection (Flood Insights) wins; then an
   * active route comparison; then the Historical explore panel; then the trip
   * search panel. Secondary state is never destroyed — e.g. a ready route stays
   * in memory and is reachable via the compact "Route ready" chip.
   */
  const primaryLeftPanel: PrimaryLeftPanel = resolvePrimaryLeftPanel({
    isError: phase === 'error',
    driving,
    barangaySelected: popup?.kind === 'barangay',
    comparing: tripStage === 'comparing',
    searching: tripStage === 'search',
    historicalVisible,
  });

  /**
   * A ready route exists but the Route Compare panel is NOT the primary panel
   * (Insights or Explore took the rail). Surface a compact, recoverable chip so
   * the route is never lost — tapping it swaps Compare back in.
   */
  const selectedRouteOption =
    routeOptions.find((o) => o.candidate.id === selectedRouteId) ?? routeOptions[0] ?? null;
  const showRouteReadyChip =
    !driving &&
    phase !== 'error' &&
    tripStage === 'comparing' &&
    primaryLeftPanel !== 'compare' &&
    selectedRouteOption != null;

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
    const next = stitchReroute(
      activeBaseRouteRef.current,
      activeBaseManeuversRef.current,
      fresh.reroute,
      frame.traveledM,
    );
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

  const handleLayerToggle = (id: LayerId, visible: boolean): void => {
    const registry = registryRef.current;
    const map = managerRef.current?.getMap?.() ?? null;
    // Reflect user intent in state FIRST (legends/warnings + click-priority),
    // regardless of whether a real integrable map/registry exists yet. This
    // keeps the UI consistent and testable even before real integration.
    layerVisibilityRef.current = {
      ...layerVisibilityRef.current,
      [id]: visible,
    };
    if (
      id === 'barangayFloodRisk' ||
      id === 'communityReports' ||
      id === 'officialClosures' ||
      id === 'floodSusceptibility'
    ) {
      setLayerVisible((prev) => ({ ...prev, [id]: visible }));
    }
    // Below this point we mutate the actual map layers; skip if not integrable.
    if (!registry) return;
    // The registry manages app-managed canvas layers. Some UI toggles map to
    // more than one canvas layer (a fill + its companion outline, or the two
    // baseline susceptibility surfaces), so fan out accordingly.
    const setLayout = (layerId: string): void => setLayoutVisibility(map, layerId, visible);
    const safeSet = (appId: LayerId): void => {
      try {
        registry.setVisibility(appId as never, visible);
      } catch {
        // Non-app layer ids are not registry-managed; ignore safely.
      }
    };

    switch (id) {
      case 'barangayFloodRisk':
        safeSet('barangayFloodRisk');
        setLayout('barangayFloodRisk-outline');
        break;
      case 'floodSusceptibility':
        // "Historical Flood Risk" now primarily renders the DERIVED per-barangay
        // Project NOAH / Phil-LiDAR susceptibility layer, plus the legacy
        // modeled hazard polygons + city summary as supporting context.
        safeSet('floodSusceptibility');
        safeSet('cityFloodSummary');
        setLayout(HISTORICAL_RISK_FILL_LAYER_ID);
        setLayout(HISTORICAL_RISK_OUTLINE_LAYER_ID);
        setLayout(HISTORICAL_SELECTED_LAYER_ID);
        setLayout(HISTORICAL_LABEL_LAYER_ID);
        setLayout(HISTORICAL_LABEL_SELECTED_LAYER_ID);
        setLayout(CITY_BOUNDARY_LAYER_ID);
        setLayout(CITY_BOUNDARY_SELECTED_LAYER_ID);
        if (visible) {
          // Reapply the current filter when the layer is (re)shown.
          applyHistoricalFilter(
            map as unknown as HistoricalFeatureStateMap,
            historicalFilter,
          );
          applyCityFocus(
            map as unknown as CityBoundaryFeatureStateMap,
            historicalFilter.view === 'ncr' ? null : historicalFilter.cityPsgc,
          );
          // Scope barangay labels to the selected city (none at NCR overview)
          // AND the active risk filter, consistent with the panel + emphasis.
          applyBarangayLabelScope(
            map,
            historicalFilter.view === 'ncr' ? null : historicalFilter.cityPsgc,
            historicalFilter.risk,
          );
        }
        break;
      case 'communityReports':
        safeSet('communityReports');
        break;
      case 'officialClosures':
        safeSet('officialClosures');
        break;
      default:
        safeSet(id);
    }
  };

  // Derive the open barangay panel's props at render time from the controller,
  // the selected timeline step, and the latest risk revision. This keeps a
  // clicked barangay live: poll ticks and timeline changes re-derive the panel.
  const barangayPanelProps =
    popup?.kind === 'barangay'
      ? (riskControllerRef.current?.infoFor(popup.psgc, timelineStep) ?? null)
      : null;
  // `riskRevision` is intentionally read so the panel re-derives on repaint.
  void riskRevision;

  /** Timeline changes update the open panel + map coloring for the step. */
  const handleTimelineStep = (step: TimelineStep): void => {
    setTimelineStep(step);
    riskControllerRef.current?.setTimelineStep?.(step);
  };

  /**
   * Reapply the historical filter to the map whenever it changes. Writing the
   * `histShown` feature-state per barangay drives which polygons render; the
   * class colors themselves are static and set once on install. Runs only when
   * a real (integrable) map is present.
   */
  useEffect(() => {
    const map = managerRef.current?.getMap?.() ?? null;
    if (!map || typeof (map as { setFeatureState?: unknown }).setFeatureState !== 'function') {
      return;
    }
    const fsMap = map as unknown as HistoricalFeatureStateMap;
    // 1) Dim-not-hide 3-tier emphasis for every barangay under the active
    //    filter (selected barangay > in-scope > out-of-scope).
    applyHistoricalFilter(fsMap, historicalFilter);
    // 1b) City-focus boundaries: emphasize the selected city, mute the rest.
    //     NCR view clears focus (all boundaries subtle + equal).
    const focusCity =
      historicalFilter.view === 'ncr' ? null : historicalFilter.cityPsgc;
    applyCityFocus(map as unknown as CityBoundaryFeatureStateMap, focusCity);

    // 1c) Scope the zoom-aware barangay name labels to the selected city (none
    //     at NCR overview) AND the active risk filter, so the visible labels
    //     stay consistent with the panel count + fill emphasis.
    applyBarangayLabelScope(map, focusCity, historicalFilter.risk);

    // 2) Camera framing: zoom to the selected city / barangay, or back to the
    //    NCR overview for the NCR view. Bounded padding + maxZoom keeps tiny
    //    barangays from over-zooming and large ones from under-zooming.
    const fit = (map as unknown as {
      fitBounds?: (b: unknown, o?: unknown) => void;
    }).fitBounds;
    if (typeof fit !== 'function') return;
    try {
      if (historicalFilter.view === 'barangay' && historicalFilter.barangayPsgc) {
        const b = barangayBounds(historicalFilter.barangayPsgc);
        if (b) fit.call(map, b, { padding: 96, maxZoom: 15.5, duration: 700 });
      } else if (historicalFilter.view === 'city' && historicalFilter.cityPsgc) {
        const b = cityBounds(historicalFilter.cityPsgc);
        if (b) fit.call(map, b, { padding: 64, maxZoom: 14, duration: 700 });
      } else if (historicalFilter.view === 'ncr') {
        managerRef.current?.frameOverview?.();
      }
    } catch {
      // Camera framing is best-effort; emphasis already applied.
    }
  }, [historicalFilter]);

  /**
   * Keep the historical layer's SELECTED (strong-outline) barangay in sync with
   * the panel. The selection is the clicked barangay (Flood Insights open) or,
   * failing that, the Barangay-view filter selection — so map and panel always
   * agree on which barangay is highlighted. Single writer for the selection
   * feature-state (avoids conflicting updates).
   */
  useEffect(() => {
    const map = managerRef.current?.getMap?.() ?? null;
    if (!map || typeof (map as { setFeatureState?: unknown }).setFeatureState !== 'function') {
      return;
    }
    const clicked = popup?.kind === 'barangay' ? popup.psgc : null;
    const next =
      clicked ??
      (historicalFilter.view === 'barangay' ? historicalFilter.barangayPsgc : null);
    setSelectedHistoricalBarangay(
      map as unknown as HistoricalFeatureStateMap,
      next,
      historicalSelectedRef.current,
    );
    historicalSelectedRef.current = next;
    // Always-visible selected-barangay label follows the same selection, so the
    // chosen polygon's name + class stay readable at every zoom (even the city
    // overview). Scoped to the single selected psgc (nothing when none).
    const sf = (map as { setFilter?: (id: string, f: unknown) => void }).setFilter;
    if (typeof sf === 'function') {
      try {
        sf.call(map, HISTORICAL_LABEL_SELECTED_LAYER_ID, selectedLabelFilter(next));
      } catch {
        // Best-effort; the polygon highlight already conveys selection.
      }
    }
  }, [popup, historicalFilter]);

  /**
   * Scopes the zoom-aware barangay NAME labels to a single city (or none).
   * Uses Mapbox `setFilter` on the label layer with {@link cityLabelFilter}, so
   * only the selected city's barangays are label candidates — never all 1,710
   * NCR barangays, and nothing at the NCR overview. Best-effort / no-op on a
   * fake map (tests) or before the layer exists.
   */
  const applyBarangayLabelScope = (
    map: unknown,
    cityPsgc: string | null,
    risk: HistoricalFilterState['risk'] = 'all',
  ): void => {
    const m = map as { setFilter?: (id: string, filter: unknown) => void };
    if (typeof m.setFilter !== 'function') return;
    try {
      m.setFilter(HISTORICAL_LABEL_LAYER_ID, cityLabelFilter(cityPsgc, risk));
    } catch {
      // Label scoping is best-effort; the fill/hover/click still work.
    }
  };

  /**
   * Clicking a city boundary on the map selects that city: switch to City view,
   * set the city, and clear any barangay selection. Kept in a ref so the
   * once-bound map click always uses the current setter. Only meaningful while
   * the Historical layer is visible + the user is in a city-capable view.
   */
  const handleCityMapSelect = (cityPsgc: string): void => {
    setHistoricalFilter((prev) => ({
      ...prev,
      view: 'city',
      cityPsgc,
      barangayPsgc: null,
    }));
  };
  cityClickHandlerRef.current = handleCityMapSelect;

  /**
   * Visual co-existence when BOTH flood layers are enabled: the historical fill
   * recedes to a faint overlay while the user's focus is Current (a barangay is
   * open on the Current tab), so the indigo/violet historical fill and the
   * green→red current fill never stack into a muddy double-fill. When only
   * Historical is on — or the Historical tab is active — it returns to its full
   * fill. Paint-only; no data/feature-state/classification is touched.
   */
  useEffect(() => {
    const map = managerRef.current?.getMap?.() ?? null;
    if (!map || typeof (map as { setPaintProperty?: unknown }).setPaintProperty !== 'function') {
      return;
    }
    const bothOn = floodRiskVisible && historicalVisible;
    const barangayOpen = popup?.kind === 'barangay';
    // When both layers are on, exactly ONE is the primary fill; the other
    // recedes so the two color families never stack into muddy colors:
    //   focus Current (default / Current tab) → historical dimmed
    //   focus Historical (Historical tab open) → current dimmed
    const historicalIsFocus = bothOn && barangayOpen && insightsTab === 'historical';
    const dimHistorical = bothOn && !historicalIsFocus;
    const dimCurrent = historicalIsFocus;

    setPaint(
      map,
      HISTORICAL_RISK_FILL_LAYER_ID,
      'fill-opacity',
      dimHistorical ? historicalFillOpacityDimmedExpression() : historicalFillOpacityExpression(),
    );
    setPaint(
      map,
      BARANGAY_RISK_FILL_LAYER_ID,
      'fill-opacity',
      dimCurrent ? barangayRiskFillOpacityDimmedExpression() : barangayRiskFillOpacityExpression(),
    );
  }, [floodRiskVisible, historicalVisible, insightsTab, popup]);

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

      {/* Coverage scope: BahaRoute is NCR-only. Subtle, always visible when the
          map is up (hidden while driving to keep the HUD clean). */}
      {phase !== 'error' && !driving && <CoverageBadge />}

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
          {offer && nav.hazard ? (
            <RerouteOfferCard
              offer={offer}
              hazard={nav.hazard}
              toHazardM={nav.toHazardM}
              onReroute={handleReroute}
              onKeep={handleKeepRoute}
            />
          ) : (
            driveRisk && <DriveRiskBanner option={driveRisk} status={riskStatus} />
          )}
        </DrivingHud>
      )}

      <div
        className="baharoute-controls"
        data-testid="map-controls"
        data-sheet-open={primaryLeftPanel !== null ? 'true' : undefined}
        data-mobile-open={mobileControlsOpen ? 'true' : undefined}
        hidden={driving}
        style={driving ? { display: 'none' } : undefined}
      >
        <button
          type="button"
          className="baharoute-mobile-menu-button baharoute-round-button baharoute-focus-ring"
          aria-label={mobileControlsOpen ? 'Close map controls' : 'Open map controls'}
          aria-expanded={mobileControlsOpen}
          aria-controls="map-control-items"
          onClick={() => setMobileControlsOpen((open) => !open)}
        >
          <span aria-hidden="true" className="baharoute-hamburger-icon">
            <span />
            <span />
            <span />
          </span>
        </button>
        <div className="baharoute-control-card baharoute-control-card--single baharoute-recenter-card">
          <RecenterControl onRecenter={handleRecenter} />
        </div>
        <div id="map-control-items" className="baharoute-control-items">
          <ZoomControls onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} />
          <div className="baharoute-control-card baharoute-control-card--single"><ViewModeControl is3D={is3D || driving} onToggle={handleViewModeToggle} /></div>
          <div className="baharoute-control-card baharoute-control-card--rotate"><RotateControl bearing={bearing} onRotate={handleRotateBy} onResetNorth={handleResetNorth} /></div>
          <div className="baharoute-control-card baharoute-control-card--single"><LocationControl onActivate={handleLocationArrow} /></div>
          <div className="baharoute-control-card baharoute-control-card--single">
            <button type="button" className="baharoute-report-flood baharoute-focus-ring" aria-pressed={reportPickActive} title="Report flooding (adds an unverified community report)" aria-label="Report flooding — adds an unverified community report at a point you tap" onClick={handleReportFloodingToggle}>
              <span aria-hidden="true">⚠</span>
            </button>
          </div>
          <LayersButton>
          <LayerControl
            layers={layers}
            groups={layerGroups}
            onToggle={handleLayerToggle}
            statusById={
              floodRiskVisible && riskStatus?.dataUnavailable
                ? { barangayFloodRisk: '⚠ unavailable' }
                : undefined
            }
            hint={
              !floodRiskVisible &&
              !historicalVisible &&
              !layerVisible.communityReports &&
              !layerVisible.officialClosures
                ? 'Select a layer to explore flood conditions.'
                : undefined
            }
          />
          <MapContextControl value={mapContext} onChange={handleMapContextChange} />
          </LayersButton>
        </div>
      </div>

      {/* Legends appear ONLY for enabled layers (Phase 4 cleanup). The legend
          is hidden entirely when neither Flood Risk nor Historical is on, and
          each section is gated by its own layer. Still yields to an open
          details panel and is hidden while driving/error. */}
      {phase !== 'error' &&
        !driving &&
        !popupOpen &&
        /* Suppress the bottom-left legend only when a TALL left-column panel
           (Historical Explore / Flood Insights) is ACTUALLY rendered in that
           column — which is what caused the "orphan card under Historical
           Explore" overlap. Those hosts render only in the ready phase; the
           compact Search/Compare trip panels sit at the top and never reach the
           legend, so the legend stays visible with them. */
        !(
          phase === 'ready' &&
          (primaryLeftPanel === 'explore' || primaryLeftPanel === 'insights')
        ) &&
        (floodRiskVisible || historicalVisible) && (
          <MapLegend
            showCurrent={floodRiskVisible}
            showHistorical={historicalVisible}
          />
        )}

      {/* Select-on-map mode banner: explains the temporary selection state and
          offers Cancel. While active, the next NCR map tap sets the point and
          selection takes click priority over barangay/flood clicks. */}
      {phase !== 'error' && !driving && pickTarget && (
        <div
          className="baharoute-select-banner"
          role="status"
          data-testid="select-mode-banner"
        >
          <span>
            {pickTarget === 'origin'
              ? 'Tap the map to choose your starting point'
              : 'Tap the map to choose your destination'}
          </span>
          <button
            type="button"
            className="baharoute-select-banner__cancel baharoute-focus-ring"
            onClick={() => handlePickOnMap(null)}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Report-flooding pick mode: the next NCR tap drops an UNVERIFIED
          community report. Clearly labeled unverified so it never reads as
          official/confirmed. */}
      {phase !== 'error' && !driving && reportPickActive && (
        <div
          className="baharoute-select-banner"
          role="status"
          data-testid="report-mode-banner"
        >
          <span>Tap the map to add an unverified flood report</span>
          <button
            type="button"
            className="baharoute-select-banner__cancel baharoute-focus-ring"
            onClick={handleReportFloodingToggle}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Trip flow panels: SEARCH then COMPARE. The first interaction is
          planning a trip — never Driver Mode. Hidden while driving/error.
          When a barangay's Flood Insights is open, it temporarily REPLACES the
          resumable search panel so two large left-side panels never stack
          (they restore when Insights closes). */}
      {primaryLeftPanel === 'search' && (
        <div className="baharoute-trip-host" data-testid="trip-host">
          <RouteSearchPanel
            origin={tripOrigin}
            destination={tripDestination}
            onOriginChange={handleOriginChange}
            onDestinationChange={handleDestinationChange}
            onUseCurrentLocation={handleUseCurrentLocation}
            onPickOnMap={handlePickOnMap}
            pickTarget={pickTarget}
            onFindRoutes={handleFindRoutes}
            busy={findingRoutes}
            locationStatus={locationStatus}
          />
          {tripNotice && (
            <p className="baharoute-trip-panel__notice" role="status" data-testid="trip-notice">
              {tripNotice}
            </p>
          )}
        </div>
      )}

      {/* Privacy-first location consent. Rendered only while open; the browser
          geolocation prompt is reached only after the user presses Allow. */}
      <LocationConsentDialog
        open={consentOpen}
        onAllow={handleConsentAllow}
        onDismiss={handleConsentDismiss}
      />
      {primaryLeftPanel === 'compare' && (
        <div className="baharoute-trip-host" data-testid="trip-host">
          <RouteComparePanel
            options={routeOptions}
            selectedId={selectedRouteId}
            onSelect={handleSelectRoute}
            onStart={handleStartRoute}
            onBack={handleTripBack}
            mode={travelMode}
            onModeChange={handleModeChange}
            preference={routePreference}
            onPreferenceChange={handlePreferenceChange}
            finding={findingRoutes}
            freshnessLabel={
              riskStatus ? formatRelativeTime(riskStatus.lastUpdated) : null
            }
          />
        </div>
      )}

      {/* Compact live-data status pill. Shown ONLY when the Flood Risk layer is
          enabled — the pill reports the live rainfall source the user is
          actually viewing. Suppressed when Flood Risk is OFF (Phase 4 cleanup).
          Hidden while driving/error. */}
      {phase === 'ready' &&
        !driving &&
        floodRiskVisible &&
        riskStatus &&
        popup?.kind !== 'barangay' && (
          <LiveStatusPill
            freshness={riskStatus.freshness}
            lastUpdated={riskStatus.lastUpdated}
          />
        )}

      {/* Historical "explore" panel (filters + NCR/city summaries). Shown only
          when the Historical layer is enabled and no barangay is selected —
          per-barangay detail lives in Flood Insights. Independent of current
          risk. */}
      {phase === 'ready' && primaryLeftPanel === 'explore' && (
        <div className="baharoute-explore-host" data-testid="explore-host">
          <HistoricalExplorePanel
            filter={historicalFilter}
            onFilterChange={setHistoricalFilter}
            onOpenBarangay={(psgc) => {
              setInsightsTab('historical');
              setInsightsSheet('half');
              setPopup({ kind: 'barangay', psgc, lngLat: undefined });
            }}
          />
        </div>
      )}

      {/* Historical hover tooltip: barangay name / city / historical class.
          Shown only while the Historical layer is visible and a barangay is
          hovered; follows the cursor. Non-interactive. */}
      {phase === 'ready' && !driving && historicalVisible && historicalHover && (
        <div
          className="baharoute-hist-tooltip"
          data-testid="historical-hover-tooltip"
          role="tooltip"
          style={{
            left: historicalHover.point.x,
            top: historicalHover.point.y,
          }}
        >
          <span className="baharoute-hist-tooltip__name">{historicalHover.name}</span>
          <span className="baharoute-hist-tooltip__city">{historicalHover.city}</span>
          <span
            className="baharoute-hist-tooltip__class"
            style={{ color: HISTORICAL_RISK_COLORS[historicalHover.cls].hex }}
          >
            Historical Flood Susceptibility: {historicalHover.cls}
          </span>
        </div>
      )}

      {/* City hover tooltip (city name + barangay count). Lightweight; shown
          only in City view while the Historical layer is visible. */}
      {phase === 'ready' &&
        !driving &&
        historicalVisible &&
        historicalFilter.view === 'city' &&
        cityHover &&
        !historicalHover && (
          <div
            className="baharoute-hist-tooltip"
            data-testid="city-hover-tooltip"
            role="tooltip"
            style={{ left: cityHover.point.x, top: cityHover.point.y }}
          >
            <span className="baharoute-hist-tooltip__name">{cityHover.cityName}</span>
            <span className="baharoute-hist-tooltip__city">
              {cityHover.barangayCount} barangays
            </span>
          </div>
        )}

      {/* When BOTH Flood Risk and Historical are on and live current-risk data
          is unavailable, clarify the historical colors are NOT current. Not
          shown when Flood Risk is OFF (no current-risk warnings in that mode). */}
      {phase === 'ready' &&
        !driving &&
        floodRiskVisible &&
        historicalVisible &&
        riskStatus?.dataUnavailable && (
          <div
            className="baharoute-history-context"
            data-testid="history-context-message"
            role="status"
          >
            Current risk unavailable — historical susceptibility shown for
            reference.
          </div>
        )}

      {/* Barangay selection opens the unified Flood Insights panel (its own
          header/close/tabs/mobile bottom-sheet). Current + Historical are
          grouped here but the datasets stay separate. */}
      {primaryLeftPanel === 'insights' && popup?.kind === 'barangay' && (
        <div className="baharoute-insights-host" data-testid="insights-host">
          <FloodInsights
            barangayName={
              barangayPanelProps?.barangayName ??
              historicalRiskByBarangay.get(popup.psgc)?.name ??
              'Barangay'
            }
            cityName={
              barangayPanelProps?.cityName ??
              historicalRiskByBarangay.get(popup.psgc)?.city ??
              ''
            }
            tab={insightsTab}
            onTabChange={setInsightsTab}
            current={barangayPanelProps}
            historical={historicalRiskByBarangay.get(popup.psgc) ?? null}
            timelineStep={timelineStep}
            onTimelineStep={handleTimelineStep}
            onClose={() => setPopup(null)}
            sheetState={insightsSheet}
            onSheetStateChange={setInsightsSheet}
          />
        </div>
      )}

      {/* Recoverable "Route ready" chip: shown when a route comparison exists
          but another panel (Insights / Explore) is the primary left panel, so
          the route is never lost or stacked underneath. Tapping it swaps the
          Route Compare panel back in. Never calls a route "safe". */}
      {showRouteReadyChip && selectedRouteOption && (
        <button
          type="button"
          className="baharoute-route-chip baharoute-focus-ring"
          data-testid="route-ready-chip"
          onClick={handleViewRoute}
        >
          <span className="baharoute-route-chip__title">Route ready</span>
          <span className="baharoute-route-chip__meta">
            {formatDuration(selectedRouteOption.candidate.durationS)} ·{' '}
            {formatDistance(selectedRouteOption.candidate.distanceM)}
          </span>
          <span className="baharoute-route-chip__cta" aria-hidden="true">
            View route
          </span>
        </button>
      )}

      {/* Report / susceptibility popups keep the compact floating card host. */}
      {popup && popup.kind !== 'barangay' && (
        <div className="baharoute-popup-host" data-testid="map-popup-host">
          <button
            type="button"
            className="baharoute-popup-close baharoute-icon-button baharoute-focus-ring"
            aria-label="Close popup"
            onClick={() => setPopup(null)}
          >
            <CloseIcon />
          </button>
          {popup.kind === 'report' ? (
            <ReportPopup {...popup.props} />
          ) : (
            <FloodPopup {...popup.props} />
          )}
        </div>
      )}
    </div>
  );
}

export default MapView;
