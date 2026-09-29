// src/layers/LayerRegistry.ts
//
// LayerRegistry owns the FIXED top→bottom render order of BahaRoute's
// app-managed Mapbox GL JS layers (design → "Map layer ordering & z-index
// strategy", Req 9.1, 9.4). It inserts each app data layer at the correct
// position relative to the basemap using `map.addLayer(layer, beforeId)` so
// future flood/route layers slot into known positions predictably.
//
// The full design order (top → bottom, top renders last / on top) is:
//
//   UI markers                          <- DOM overlays (handled elsewhere)
//   flood reports (symbols)             \
//   route highlights (route lines)       |  app-managed CANVAS layers this
//   road flood-condition segments        |  registry inserts, in this order
//   flood susceptibility polygons       /
//   ── basemap below (from the style) ──
//   boundaries
//   labels
//   roads
//   buildings
//   parks
//   water
//   background
//
// UI markers are Mapbox GL JS HTML `Marker` overlays (DOM) that naturally sit above
// the canvas, so the registry does NOT manage them. Its job is to place the
// app's data layers ABOVE the basemap's boundaries/labels/roads/etc. and in the
// correct order relative to EACH OTHER: flood reports above route highlights
// above road flood-condition segments above susceptibility, and susceptibility
// above the basemap boundary/label/road layers.
//
// The registry depends only on a small structural {@link MapLayerAdapter}
// interface (a subset of the Mapbox GL JS `Map` API), so it is fully unit-testable
// with a fake adapter that records addLayer/removeLayer/setLayoutProperty calls
// — no real WebGL map required (the test env is jsdom).

/**
 * The minimal Mapbox GL JS `Map` surface the registry needs. Kept structural so
 * tests can inject a fake that records calls (see LayerRegistry.test.ts). The
 * real `mapboxgl.Map` satisfies this shape.
 */
export interface MapLayerAdapter {
  /**
   * Adds a layer. When `beforeId` is provided, the layer is inserted BELOW the
   * layer with that id (i.e. `beforeId` renders on top of the new layer),
   * matching Mapbox GL JS's `addLayer(layer, beforeId)` semantics. When omitted the
   * layer is appended on top of the stack.
   */
  addLayer(layer: MapLayerSpec, beforeId?: string): void;
  /** Removes the layer with the given id. */
  removeLayer(id: string): void;
  /** Sets a layout property (used here to toggle `visibility`). */
  setLayoutProperty(id: string, name: string, value: unknown): void;
  /** Returns the layer with the given id, or undefined when absent. */
  getLayer(id: string): unknown;
}

/**
 * A structural Mapbox GL JS layer definition. Kept generic (`id` + arbitrary extra
 * fields) so the registry stays independent of any specific layer's paint/type
 * — concrete layer paint (e.g. the susceptibility fill in Task 10.1) is defined
 * elsewhere and passed through unchanged.
 */
export interface MapLayerSpec {
  id: string;
  [key: string]: unknown;
}

/**
 * Mapbox Standard slot for app data layers: above roads, BEHIND 3D buildings,
 * so flood fills/outlines drape on the ground instead of painting over
 * buildings in the 3D view. Layers without a slot render above everything.
 */
export const APP_LAYER_SLOT = 'middle';

/** Mapbox GL JS `visibility` layout values. */
type Visibility = 'visible' | 'none';

/**
 * The app-managed layer ids, in FIXED top→bottom render order (index 0 renders
 * ON TOP of the rest). This is the canvas subset of the design order; UI
 * markers are DOM overlays and are intentionally excluded.
 *
 * Higher-priority (earlier) entries must render above lower ones:
 *   floodReports > routeHighlights > roadFloodConditionSegments >
 *   floodSusceptibility > cityFloodSummary
 *
 * Task 10.1 defines the concrete `floodSusceptibility` fill layer; other ids
 * are anchors reserved for later route/report layers. The registry treats them
 * generically.
 *
 * `cityFloodSummary` is the ADMINISTRATIVE, per-city modeled-susceptibility
 * SUMMARY fill (reproduces the NCR overview composition). It is intentionally
 * the LOWEST app layer — just above the basemap and BELOW the hazard-shaped
 * `floodSusceptibility` polygons and all reports/routes — so hazard polygons
 * and current-condition reports always read on top of the city summary.
 */
export const APP_LAYER_ORDER = [
  'officialClosures',
  'floodReports',
  'communityReports',
  'routeHighlights',
  'roadFloodConditionSegments',
  'barangayFloodRisk',
  'floodSusceptibility',
  'cityFloodSummary',
] as const;

/** An app-managed layer id in {@link APP_LAYER_ORDER}. */
export type AppLayerId = (typeof APP_LAYER_ORDER)[number];

/** True when `id` is one of the app-managed layer ids. */
export function isAppLayerId(id: string): id is AppLayerId {
  return (APP_LAYER_ORDER as readonly string[]).includes(id);
}

/**
 * Inserts and manages BahaRoute's app-managed Mapbox GL JS layers in a fixed
 * z-order. One registry wraps one map adapter.
 */
export class LayerRegistry {
  /** Tracks which app layers have been added, so toggles/removes are safe. */
  private readonly added = new Set<AppLayerId>();

  /**
   * @param map - The map adapter (real `mapboxgl.Map` or a test fake).
   */
  constructor(private readonly map: MapLayerAdapter) {}

  /**
   * Adds every app data layer in the correct top→bottom order.
   *
   * Insertion strategy: we add from the TOP of the app stack downward. The top
   * app layer (floodReports) has no higher app layer, so it is appended ON TOP
   * of the whole basemap (`beforeId` undefined) — the entire basemap therefore
   * sits beneath it. Each lower app layer is then anchored BEFORE the app layer
   * directly above it via `addLayer(layer, beforeId)`, so Mapbox GL JS inserts it
   * underneath that neighbour. This guarantees the fixed relative order
   * (floodReports > routeHighlights > roadFloodConditionSegments >
   * floodSusceptibility) and keeps every app layer above the basemap.
   *
   * `defs` maps an {@link AppLayerId} to its concrete Mapbox GL JS layer spec.
   * Only ids present in `defs` are added; unknown/basemap ids are ignored so
   * the registry stays generic (the susceptibility paint is supplied by
   * Task 10.1, not hardcoded here).
   */
  addAppLayers(defs: Partial<Record<AppLayerId, MapLayerSpec>>): void {
    // Top → bottom so each layer can anchor before the one above it.
    for (const id of APP_LAYER_ORDER) {
      const def = defs[id];
      if (def) {
        this.addAppLayer(def);
      }
    }
  }

  /**
   * Adds a single app layer at its fixed position in the order. The `beforeId`
   * anchor is the nearest HIGHER app layer that is already present; Mapbox GL JS
   * inserts the new layer beneath that neighbour so the fixed order holds. When
   * no higher app layer is present (or the anchor is somehow absent from the
   * style), the layer is appended ON TOP of the whole stack — still above the
   * basemap, which sits entirely beneath the app layers.
   *
   * @param layer - A Mapbox GL JS layer spec whose `id` is one of
   *   {@link APP_LAYER_ORDER}.
   * @throws If `layer.id` is not an app-managed layer id.
   */
  addAppLayer(layer: MapLayerSpec): void {
    if (!isAppLayerId(layer.id)) {
      throw new Error(
        `LayerRegistry.addAppLayer: "${layer.id}" is not an app-managed layer id. ` +
          `Expected one of: ${APP_LAYER_ORDER.join(', ')}.`,
      );
    }

    const beforeId = this.resolveBeforeId(layer.id);
    // When there is no higher app layer (or it is missing from the style),
    // addLayer(layer, undefined) appends on top — safe because the basemap sits
    // entirely beneath the app layers.
    const anchorExists =
      beforeId !== undefined && this.map.getLayer(beforeId) !== undefined;

    this.map.addLayer(layer, anchorExists ? beforeId : undefined);
    this.added.add(layer.id);
  }

  /**
   * Toggles a layer's visibility via `setLayoutProperty('visibility', ...)`.
   * This changes ONLY the layout property; it never removes/re-adds the layer,
   * so toggling can NOT reorder the stack (Req 9.2, 9.4). No-op when the layer
   * has not been added.
   *
   * @param id - The app layer to toggle.
   * @param visible - `true` → `'visible'`, `false` → `'none'`.
   */
  setVisibility(id: AppLayerId, visible: boolean): void {
    if (!this.added.has(id)) {
      return;
    }
    const value: Visibility = visible ? 'visible' : 'none';
    this.map.setLayoutProperty(id, 'visibility', value);
  }

  /**
   * Removes an app layer from the map. No-op when the layer is not present.
   *
   * @param id - The app layer to remove.
   */
  removeAppLayer(id: AppLayerId): void {
    if (!this.added.has(id)) {
      return;
    }
    this.map.removeLayer(id);
    this.added.delete(id);
  }

  /** True when the given app layer has been added and not since removed. */
  has(id: AppLayerId): boolean {
    return this.added.has(id);
  }

  /**
   * Resolves the `beforeId` anchor for an app layer: the nearest HIGHER app
   * layer (earlier in {@link APP_LAYER_ORDER}) that is already present. The new
   * layer is inserted beneath that neighbour so it lands at its fixed position.
   * Returns `undefined` when no higher app layer is present, meaning the layer
   * is appended on top of the whole stack (above the basemap).
   */
  private resolveBeforeId(id: AppLayerId): string | undefined {
    const index = APP_LAYER_ORDER.indexOf(id);
    for (let i = index - 1; i >= 0; i -= 1) {
      const higher = APP_LAYER_ORDER[i];
      if (this.added.has(higher)) {
        return higher;
      }
    }
    return undefined;
  }
}
