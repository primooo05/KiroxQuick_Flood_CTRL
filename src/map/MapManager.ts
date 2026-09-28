// src/map/MapManager.ts
//
// MapManager owns the imperative Mapbox GL JS `Map` instance lifecycle behind a
// small typed API (design → "Map rendering architecture → Mapbox instance
// lifecycle"). React (MapView, Task 11) never touches the raw map object; it
// mounts a container and delegates to this class.
//
// Group 2 engine swap: the underlying renderer is now `mapbox-gl` (direct, not
// react-map-gl), constructed with a STOCK MAPBOX STYLE URL and the Mapbox access
// token applied at construction. The imperative MapManager abstraction and the
// engine-agnostic MinimalMap interface are preserved unchanged — mapbox-gl's
// `Map` satisfies the same on/off/remove/resize/fitBounds/getZoom/setZoom/
// flyTo/easeTo/setPitch/setBearing/getContainer surface.
//
// Non-rendering logic (extent framing, the 15s tile watchdog, resize handling,
// zoom clamping, and destroy/cleanup) is written so it is unit-testable WITHOUT
// a real WebGL map: the mapboxgl.Map constructor is dependency-injected via
// `mapFactory`, so tests can pass a fake Map with mocked methods (see
// MapManager.test.ts).

import mapboxgl from 'mapbox-gl';
import type { AppConfig } from '../types/config';
import {
  BAHAROUTE_STANDARD_CONFIG,
  bahaRouteStyleUrl,
  STANDARD_BASEMAP_IMPORT_ID,
  STYLE_MAX_ZOOM,
  STYLE_MIN_ZOOM,
} from './basemap/BahaRouteStyle';
import { METRO_MANILA_EXTENT } from './metroManilaExtent';
import { metroManilaCityBoundaries } from '../data/geojson/metroManilaCityBoundaries';
import {
  buildMetroManilaClipMask,
  NCR_CLIP_LAYER_ID,
  NCR_CLIP_SOURCE_ID,
} from './metroManilaClipMask';
import {
  OVERVIEW_BOUNDS,
  OVERVIEW_DESKTOP_CENTER,
  overviewFitOptions,
  computeOverviewFraming,
} from '../camera/overviewFraming';

/** How long to wait for the base map to load before declaring failure (Req 1.6). */
export const TILE_WATCHDOG_MS = 15_000;

/**
 * Initial constructor center `[lng, lat]` for the map's first paint. Uses the
 * tuned Metro Manila overview center (inside the NCR extent) so startup is
 * already NCR-focused before {@link MapManager.frameOverview} refines the
 * framing on load (Req 1.2).
 */
const INITIAL_CENTER: [number, number] = OVERVIEW_DESKTOP_CENTER;

/**
 * Initial constructor zoom for the first paint. ~11 frames the NCR at a
 * recognizable scale; sits inside the style bounds `[STYLE_MIN_ZOOM,
 * STYLE_MAX_ZOOM]`. frameOverview() applies the responsive framing on load.
 */
const INITIAL_ZOOM = 11;

/** Camera pitch (degrees) used while the 3D view is on. */
export const VIEW_3D_PITCH = 60;

/** Duration (ms) of the 2D ↔ 3D camera tilt animation. */
const VIEW_MODE_TRANSITION_MS = 800;

/**
 * The minimal, ENGINE-AGNOSTIC subset of the map `Map` API that MapManager
 * uses. Kept intentionally small and structurally typed so tests can supply a
 * fake Map (with mocked functions) via {@link MapManagerInitOptions.mapFactory}
 * without instantiating a real WebGL map. The real `mapboxgl.Map` satisfies
 * this shape (as did the previous MapLibre map), so swapping the engine did not
 * require changing this interface.
 */
export interface MinimalMap {
  on(type: string, listener: (...args: unknown[]) => void): unknown;
  off(type: string, listener: (...args: unknown[]) => void): unknown;
  once?(type: string, listener: (...args: unknown[]) => void): unknown;
  remove(): void;
  resize(): unknown;
  fitBounds(bounds: unknown, options?: unknown): unknown;
  getZoom(): number;
  setZoom(zoom: number): unknown;
  getMinZoom?(): number;
  getMaxZoom?(): number;
  // Optional camera controls (Milestone A, Req 1.2, 10.5). Declared OPTIONAL so
  // existing fakes/minimal maps remain structurally valid without providing
  // them; MapManager guards each call so an absent method is a safe no-op.
  flyTo?(options: unknown): unknown;
  easeTo?(options: unknown): unknown;
  setPitch?(pitch: number): unknown;
  setBearing?(bearing: number): unknown;
  /**
   * Optional container accessor (the real Mapbox `Map` exposes `getContainer()`).
   * Used by {@link MapManager.frameOverview} to measure the viewport for the
   * aspect-ratio-aware framing. Declared OPTIONAL so minimal fakes stay valid;
   * when absent, MapManager falls back to the MapManager-held container ref, and
   * failing that to the plain fitBounds framing.
   */
  getContainer?(): HTMLElement;
  // Optional style APIs for the Standard 3D view. OPTIONAL so minimal fakes
  // stay valid; MapManager guards each call.
  setConfigProperty?(importId: string, name: string, value: unknown): unknown;
  addSource?(id: string, source: unknown): unknown;
  addLayer?(layer: unknown, beforeId?: string): unknown;
  getLayer?(id: string): unknown;
}

/**
 * Options accepted by the mapbox-gl `Map` constructor that MapManager sets.
 *
 * Group 2 shape change: `style` is now a stock Mapbox style URL string (was a
 * hand-authored style spec object), the map is framed via `center`/`zoom`
 * (a sensible Metro Manila starting view) rather than constructor `bounds`, and
 * the Mapbox `accessToken` is passed here so the map can resolve the
 * `mapbox://` style + tiles. The token flows from {@link AppConfig.tileKey}
 * (env) — never hardcoded (Req 17.1, 17.2).
 */
export interface MapConstructorOptions {
  container: HTMLElement | string;
  /** A stock Mapbox style URL, e.g. `mapbox://styles/mapbox/standard`. */
  style: string;
  /** Initial center `[lng, lat]` — a Metro Manila / NCR-focused first paint. */
  center: [number, number];
  /** Initial zoom for the first paint (frameOverview refines it on load). */
  zoom: number;
  minZoom: number;
  maxZoom: number;
  /** The Mapbox access token, applied so mapbox-gl can fetch the style/tiles. */
  accessToken: string;
  /** Mapbox Standard import config, keyed by import id (e.g. `basemap`). */
  config?: Record<string, Record<string, unknown>>;
}

/**
 * A factory that constructs a map instance from constructor options. Defaults
 * to the real `mapboxgl.Map`; tests inject a fake that returns a
 * {@link MinimalMap} of mocks.
 */
export type MapFactory = (options: MapConstructorOptions) => MinimalMap;

/** Options for {@link MapManager.init}. */
export interface MapManagerInitOptions {
  /** The DOM element the map renders into. */
  container: HTMLElement;
  /** App config carrying the Tile_Provider API key (used to build the style). */
  config: AppConfig;
  /** Called once when the base map has loaded; dismisses the loading UI (Req 1.5). */
  onReady?: () => void;
  /**
   * Called at most once when the base map fails to load — either an `error`
   * event or the 15s watchdog timeout (Req 1.6, 18.1).
   */
  onTileFailure?: (reason: 'timeout' | 'error') => void;
  /**
   * Optional injection point for the map constructor. Defaults to the real
   * `mapboxgl.Map`. Tests pass a fake so the non-rendering lifecycle logic
   * can be exercised without WebGL.
   */
  mapFactory?: MapFactory;
}

/**
 * Default factory: constructs a real mapbox-gl map from a stock style URL.
 *
 * The Mapbox access token is passed via the constructor's `accessToken` option
 * (preferred over mutating the global `mapboxgl.accessToken`) so the token is
 * scoped to this map instance and there is no shared global mutation — this
 * keeps concurrent maps and tests clean. The token is never hardcoded; it
 * originates from {@link AppConfig.tileKey} (env, Group 1) and is threaded in
 * via {@link MapConstructorOptions.accessToken}.
 */
const defaultMapFactory: MapFactory = (options) =>
  new mapboxgl.Map({
    container: options.container,
    style: options.style,
    center: options.center,
    zoom: options.zoom,
    minZoom: options.minZoom,
    maxZoom: options.maxZoom,
    accessToken: options.accessToken,
    config: options.config,
  }) as unknown as MinimalMap;

/**
 * Wraps a single mapbox-gl map instance and its lifecycle. Create one per mounted
 * map container, call {@link init} once, and {@link destroy} on unmount.
 */
export class MapManager {
  private map: MinimalMap | null = null;
  /**
   * The container element passed to {@link init}, retained (additively) so
   * {@link frameOverview} can measure the viewport for aspect-ratio-aware
   * framing when the map itself does not expose `getContainer()`.
   */
  private container: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private watchdogId: ReturnType<typeof setTimeout> | null = null;
  /** Guards {@link onReady}/{@link onTileFailure} so the outcome fires at most once. */
  private settled = false;

  private onReady?: () => void;
  private onTileFailure?: (reason: 'timeout' | 'error') => void;

  private readonly minZoom = STYLE_MIN_ZOOM;
  private readonly maxZoom = STYLE_MAX_ZOOM;

  // Bound listeners retained so they can be removed on destroy.
  /** Whether the 3D view (tilt + Standard 3D objects) is currently on. */
  private view3D = false;

  private readonly handleLoad = (): void => {
    this.installMetroManilaClip();
    this.settleReady();
  };
  private readonly handleError = (): void => this.settleFailure('error');

  /**
   * Initializes the map: constructs a mapbox-gl map pointed at the stock
   * BahaRoute style URL with the Mapbox access token from config, framed on a
   * sensible Metro Manila center + zoom so the FIRST paint is already
   * NCR-focused (Req 1.2, 1.3). The responsive OVERVIEW framing is then applied
   * by {@link frameOverview} on `load` (MapView calls it on ready). Starts the
   * 15s tile watchdog (Req 1.6) and attaches a ResizeObserver that keeps the
   * canvas sized to its container (Req 5.3).
   *
   * No `maxBounds`/hard clip is set, so the basemap keeps rendering beyond the
   * NCR and users can pan freely (Req 1.6).
   *
   * @returns The created map instance (also retained internally).
   */
  init(options: MapManagerInitOptions): MinimalMap {
    if (this.map) {
      throw new Error('MapManager.init called twice; create a new MapManager.');
    }

    this.onReady = options.onReady;
    this.onTileFailure = options.onTileFailure;

    const factory = options.mapFactory ?? defaultMapFactory;

    // The Mapbox access token flows from env → AppConfig.tileKey (Group 1) and
    // is applied at construction; it is never hardcoded (Req 17.1, 17.2).
    const accessToken = options.config.tileKey ?? '';

    const map = factory({
      container: options.container,
      style: bahaRouteStyleUrl(),
      // Start centered on Metro Manila so the first paint is NCR-focused; the
      // tuned overview center sits inside the NCR extent. frameOverview() then
      // applies the responsive framing on load.
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      minZoom: this.minZoom,
      maxZoom: this.maxZoom,
      accessToken,
      // Standard: faded theme, day light, 3D hidden until set3D(true).
      config: { [STANDARD_BASEMAP_IMPORT_ID]: { ...BAHAROUTE_STANDARD_CONFIG } },
    });
    this.map = map;
    this.container = options.container;

    // Map load success clears the watchdog; error or timeout reports failure.
    map.on('load', this.handleLoad);
    map.on('error', this.handleError);

    this.startWatchdog();
    this.attachResizeObserver(options.container);

    return map;
  }

  /**
   * Animates the view back to {@link METRO_MANILA_EXTENT} (used by
   * RecenterControl, Req 7.2). No-op safe if called before init.
   *
   * @param durationMs - Animation duration in ms (default 800; within the
   *   1000ms budget of Req 7.2).
   */
  recenter(durationMs = 800): void {
    // fitBounds resets pitch to 0 unless given one, so keep the 3D tilt.
    this.map?.fitBounds(
      METRO_MANILA_EXTENT,
      this.view3D ? { duration: durationMs, pitch: VIEW_3D_PITCH } : { duration: durationMs },
    );
  }

  /**
   * Switches between the flat 2D view and the 3D view. 3D tilts the camera to
   * {@link VIEW_3D_PITCH} and shows Mapbox Standard's 3D objects (clipped to
   * Metro Manila on load); 2D flattens the camera and hides them. Keeps the
   * current center/zoom. Safe no-op before init / on fakes lacking the APIs.
   */
  set3D(on: boolean): void {
    this.view3D = on;
    const map = this.map;
    if (!map) return;
    try {
      map.setConfigProperty?.(STANDARD_BASEMAP_IMPORT_ID, 'show3dObjects', on);
    } catch {
      // Style not ready or not Standard: the camera tilt below still applies.
    }
    map.easeTo?.({ pitch: on ? VIEW_3D_PITCH : 0, duration: VIEW_MODE_TRANSITION_MS });
  }

  /** True while the 3D view is on. */
  is3D(): boolean {
    return this.view3D;
  }

  // --- camera pass-throughs (Milestone A, Req 1.2, 10.5) -------------------
  //
  // Additive, no-op-safe delegates so a future CameraController (Milestone D)
  // can drive framing through MapManager without duplicating it. Each guards
  // with `this.map?.method?.(...)` exactly like recenter(): if the map is null
  // (before init / after destroy) OR the underlying map lacks the method (e.g.
  // a minimal fake), the call is a silent no-op and never throws.

  /** Delegates to the underlying map's `flyTo`. Safe no-op if unavailable. */
  flyTo(options: unknown): void {
    this.map?.flyTo?.(options);
  }

  /** Delegates to the underlying map's `easeTo`. Safe no-op if unavailable. */
  easeTo(options: unknown): void {
    this.map?.easeTo?.(options);
  }

  /** Delegates to the underlying map's `setPitch`. Safe no-op if unavailable. */
  setPitch(pitch: number): void {
    this.map?.setPitch?.(pitch);
  }

  /** Delegates to the underlying map's `setBearing`. Safe no-op if unavailable. */
  setBearing(bearing: number): void {
    this.map?.setBearing?.(bearing);
  }

  /**
   * Frames the tuned NCR overview (Req 1.2), aspect-ratio-aware.
   *
   * Measures the map container (via the map's `getContainer()` if present, else
   * the container ref held from {@link init}) and delegates the *decision* to
   * the pure {@link computeOverviewFraming}:
   *  - `fitBounds` (narrow / portrait / mobile, or when no usable size is
   *    measurable — e.g. jsdom fakes) → `fitBounds(OVERVIEW_BOUNDS,
   *    overviewFitOptions())`, exactly the prior behavior, so Milestone 1 tests
   *    and mobile keep working.
   *  - `centerZoom` (wide desktop) → `easeTo({ center, zoom, duration })` so the
   *    NCR width fills the screen and the NCR appears LARGER (not more padded).
   *    Falls back to a fitBounds framing when `easeTo` is unavailable.
   *
   * Distinct from {@link recenter} (which fits {@link METRO_MANILA_EXTENT}) and
   * from init's constructor center+zoom framing, both unchanged. Safe no-op before
   * init / after destroy. No maxBounds is ever set (no hard clip, Req 1.6).
   */
  frameOverview(): void {
    const map = this.map;
    if (!map) return;

    const size = this.measureViewport();
    // No usable size (e.g. an unlaid-out container or a minimal jsdom fake):
    // keep the proven fitBounds framing.
    if (!size) {
      map.fitBounds(OVERVIEW_BOUNDS, overviewFitOptions());
      return;
    }

    const framing = computeOverviewFraming(size);
    if (framing.mode === 'centerZoom') {
      if (typeof map.easeTo === 'function') {
        map.easeTo({
          center: framing.center,
          zoom: framing.zoom,
          duration: framing.duration,
        });
      } else {
        // No easeTo (e.g. a fake without it): fall back to fitBounds framing
        // rather than throwing.
        map.fitBounds(OVERVIEW_BOUNDS, overviewFitOptions());
      }
      return;
    }

    map.fitBounds(framing.bounds, {
      padding: framing.padding,
      duration: framing.duration,
    });
  }

  /**
   * Best-effort measurement of the current map container in CSS pixels. Prefers
   * the map's own `getContainer()` (the real Mapbox map has it), else the
   * container ref captured in {@link init}. Returns `null` when no positive
   * `{ width, height }` can be read (e.g. jsdom fakes with zero-size elements),
   * signaling {@link frameOverview} to use the fitBounds fallback.
   */
  private measureViewport(): { width: number; height: number } | null {
    const el =
      (typeof this.map?.getContainer === 'function'
        ? this.map.getContainer()
        : null) ?? this.container;
    if (!el) return null;
    const width = el.clientWidth;
    const height = el.clientHeight;
    if (!(width > 0) || !(height > 0)) return null;
    return { width, height };
  }

  /**
   * Sets the zoom, clamped to the style's `[minZoom, maxZoom]` bounds so zoom
   * controls never exceed the bounds or enter an error state (Req 5.2, 5.5).
   */
  setZoomClamped(zoom: number): void {
    if (!this.map) return;
    this.map.setZoom(this.clampZoom(zoom));
  }

  /** Zoom in by `delta` (default 1), clamped to the style max (Req 5.5). */
  zoomIn(delta = 1): void {
    if (!this.map) return;
    this.setZoomClamped(this.map.getZoom() + delta);
  }

  /** Zoom out by `delta` (default 1), clamped to the style min (Req 5.5). */
  zoomOut(delta = 1): void {
    if (!this.map) return;
    this.setZoomClamped(this.map.getZoom() - delta);
  }

  /** Clamps a zoom value into the style's `[minZoom, maxZoom]` range. */
  clampZoom(zoom: number): number {
    if (Number.isNaN(zoom)) return this.minZoom;
    return Math.min(this.maxZoom, Math.max(this.minZoom, zoom));
  }

  /** The underlying map instance, or null before init / after destroy. */
  getMap(): MinimalMap | null {
    return this.map;
  }

  /**
   * Releases all resources: removes the map (freeing WebGL context),
   * disconnects the ResizeObserver, clears the watchdog timer, and detaches
   * listeners. Always safe to call, and idempotent (design → lifecycle rules).
   */
  destroy(): void {
    this.clearWatchdog();

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.map) {
      this.map.off('load', this.handleLoad);
      this.map.off('error', this.handleError);
      this.map.remove();
      this.map = null;
    }

    this.container = null;
  }

  // --- internal ------------------------------------------------------------

  /**
   * Adds a Mapbox `clip` layer that removes 3D buildings and instanced models
   * (trees) everywhere OUTSIDE the 17 NCR cities, so the 3D view renders only
   * for Metro Manila. Best-effort: skipped on fakes without style APIs, and a
   * failure never blocks the map from becoming ready.
   */
  private installMetroManilaClip(): void {
    const map = this.map;
    if (!map || typeof map.addSource !== 'function' || typeof map.addLayer !== 'function') {
      return;
    }
    try {
      if (map.getLayer?.(NCR_CLIP_LAYER_ID)) return;
      map.addSource(NCR_CLIP_SOURCE_ID, {
        type: 'geojson',
        data: buildMetroManilaClipMask(metroManilaCityBoundaries),
      });
      map.addLayer({
        id: NCR_CLIP_LAYER_ID,
        type: 'clip',
        source: NCR_CLIP_SOURCE_ID,
        layout: { 'clip-layer-types': ['model'] },
      });
    } catch {
      // Clip is an enhancement; the base map stays usable without it.
    }
  }

  /** Starts the single 15s tile watchdog (Req 1.6). */
  private startWatchdog(): void {
    this.clearWatchdog();
    this.watchdogId = setTimeout(() => {
      this.watchdogId = null;
      this.settleFailure('timeout');
    }, TILE_WATCHDOG_MS);
  }

  /** Clears the watchdog timer if pending. Always called on settle/destroy. */
  private clearWatchdog(): void {
    if (this.watchdogId !== null) {
      clearTimeout(this.watchdogId);
      this.watchdogId = null;
    }
  }

  /** Marks a successful load exactly once and clears the watchdog. */
  private settleReady(): void {
    if (this.settled) return;
    this.settled = true;
    this.clearWatchdog();
    this.onReady?.();
  }

  /** Reports a load failure exactly once and clears the watchdog. */
  private settleFailure(reason: 'timeout' | 'error'): void {
    if (this.settled) return;
    this.settled = true;
    this.clearWatchdog();
    this.onTileFailure?.(reason);
  }

  /**
   * Attaches a ResizeObserver on the container that resizes the map so it fills
   * its container without distortion (Req 5.3). Guarded for environments (like
   * jsdom) that do not provide ResizeObserver.
   */
  private attachResizeObserver(container: HTMLElement): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    this.resizeObserver = new ResizeObserver(() => {
      this.map?.resize();
    });
    this.resizeObserver.observe(container);
  }
}
