import type { MetroManilaTrafficCamera } from '../types/camera';
import { CITY_LABEL_ZOOM } from './cityContextLayer';
import { metroManilaCityBoundaries } from '../data/geojson/metroManilaCityBoundaries';
import { CITY_NORM_TO_CITY } from '../data/geojson/cityNameNormalization';
import { pointInGeometry, bboxOf } from '../services/pointInPolygon';

export const WEBCAM_SOURCE_ID = 'webcamCameras';
export const WEBCAM_LAYER_ID = 'webcamMarkers' as const;

/** Zoom threshold below which webcam markers should NOT appear (country/regional overview). */
export const WEBCAM_MIN_ZOOM = CITY_LABEL_ZOOM.min; // 8.5
/** Zoom threshold at which city labels are fully active. */
export const WEBCAM_MAX_ZOOM = 22;

export interface WebcamPointProperties {
  sourceId: string;
  source: string;
  name: string;
  cityId: string;
  cityName: string;
  mediaKind: 'image' | 'video';
  mediaUrl: string;
  detailUrl?: string;
  observedAt?: number;
  areaLabel?: string;
}

export function webcamsToGeoJSON(
  cameras: readonly MetroManilaTrafficCamera[],
): GeoJSON.FeatureCollection<GeoJSON.Point, WebcamPointProperties> {
  return {
    type: 'FeatureCollection',
    features: cameras.map((c) => ({
      type: 'Feature',
      id: `${c.source}:${c.sourceId}`,
      geometry: {
        type: 'Point',
        coordinates: [c.coordinates[0], c.coordinates[1]],
      },
      properties: {
        sourceId: c.sourceId,
        source: c.source,
        name: c.name,
        cityId: c.city.id,
        cityName: c.city.name,
        mediaKind: c.mediaKind,
        mediaUrl: c.mediaUrl,
        ...(c.detailUrl ? { detailUrl: c.detailUrl } : {}),
        ...(c.observedAt !== undefined ? { observedAt: c.observedAt } : {}),
        ...(c.areaLabel ? { areaLabel: c.areaLabel } : {}),
      },
    })),
  };
}

export interface WebcamMapboxLayerSpec {
  id: string;
  type: 'circle';
  source: string;
  minzoom?: number;
  maxzoom?: number;
  paint: Record<string, unknown>;
  layout?: Record<string, unknown>;
}

export function buildWebcamLayer(): WebcamMapboxLayerSpec {
  return {
    id: WEBCAM_LAYER_ID,
    type: 'circle',
    source: WEBCAM_SOURCE_ID,
    minzoom: WEBCAM_MIN_ZOOM,
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        WEBCAM_MIN_ZOOM,
        4,
        CITY_LABEL_ZOOM.full,
        6,
        15,
        9,
      ],
      'circle-color': '#126b83',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
      'circle-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        WEBCAM_MIN_ZOOM,
        0,
        CITY_LABEL_ZOOM.full,
        1,
      ],
      'circle-stroke-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        WEBCAM_MIN_ZOOM,
        0,
        CITY_LABEL_ZOOM.full,
        1,
      ],
    },
  };
}

export interface WebcamLayerMapAdapter {
  addSource(id: string, source: { type: 'geojson'; data: GeoJSON.FeatureCollection }): void;
  addLayer(layer: unknown, beforeId?: string): void;
  getSource?(id: string): { setData(data: GeoJSON.FeatureCollection): void } | undefined;
  getLayer?(id: string): unknown;
}

export function installWebcamLayer(
  map: WebcamLayerMapAdapter,
  cameras: readonly MetroManilaTrafficCamera[],
  beforeId?: string,
): void {
  map.addSource(WEBCAM_SOURCE_ID, {
    type: 'geojson',
    data: webcamsToGeoJSON(cameras),
  });

  const layer = buildWebcamLayer();
  const anchor = beforeId && map.getLayer?.(beforeId) !== undefined ? beforeId : undefined;
  map.addLayer(layer, anchor);
}

export function updateWebcamSource(
  map: { getSource(id: string): { setData(data: GeoJSON.FeatureCollection): void } | undefined },
  cameras: readonly MetroManilaTrafficCamera[],
): void {
  const source = map.getSource(WEBCAM_SOURCE_ID);
  if (!source) return;
  source.setData(webcamsToGeoJSON(cameras));
}

/** Precomputed bounding boxes and geometry for each city. */
const CITY_BOUNDARIES_INFO = metroManilaCityBoundaries.features.map((feature) => ({
  cityId: CITY_NORM_TO_CITY[feature.properties.city_norm]?.id,
  cityName: CITY_NORM_TO_CITY[feature.properties.city_norm]?.name,
  geometry: feature.geometry,
  bbox: bboxOf(feature.geometry),
}));

export interface MapViewportInfo {
  zoom: number;
  center?: [number, number];
  bounds?: [number, number, number, number]; // [west, south, east, north]
}

/**
 * Checks if the city where the camera is located is active and its label is seen.
 * Rules:
 * 1. Zoom must be >= CITY_LABEL_ZOOM.min (8.5) and < CITY_LABEL_ZOOM.hide (15.5) so city label is visible.
 * 2. If center or bounds is provided, the camera's city boundary must intersect or contain the current view.
 */
export function isCameraCityVisible(
  camera: MetroManilaTrafficCamera,
  viewport: MapViewportInfo,
): boolean {
  const { zoom, center, bounds } = viewport;
  // 1. Zoom check: must not be zoomed out to whole country / low zoom (< 8.5)
  if (zoom < CITY_LABEL_ZOOM.min) {
    return false;
  }

  // 2. Location check against city geometry
  const cityInfo = CITY_BOUNDARIES_INFO.find((c) => c.cityId === camera.city.id);
  if (!cityInfo) return false;

  // If viewport bounds provided, check intersection
  if (bounds) {
    const [w, s, e, n] = bounds;
    const [minX, minY, maxX, maxY] = cityInfo.bbox;
    const intersects = !(e < minX || w > maxX || n < minY || s > maxY);
    if (!intersects) return false;

    // Camera coordinate must also be inside the viewport bounds
    const [camLng, camLat] = camera.coordinates;
    const inViewport = camLng >= w && camLng <= e && camLat >= s && camLat <= n;
    return inViewport;
  }

  // If map center is provided, check if center falls in city
  if (center) {
    const [cLng, cLat] = center;
    if (pointInGeometry(cLng, cLat, cityInfo.geometry)) {
      return true;
    }
  }

  // If only zoom is provided, return true if within city label range
  return true;
}

export function cameraFromFeature(
  properties: Record<string, unknown> | WebcamPointProperties | null | undefined,
  coordinates?: [number, number],
): MetroManilaTrafficCamera | null {
  if (!properties) return null;
  const sourceId = String(properties.sourceId ?? '');
  const source = String(properties.source ?? 'Windy');
  const name = String(properties.name ?? '');
  const cityId = String(properties.cityId ?? '');
  const cityName = String(properties.cityName ?? '');
  const mediaKind = properties.mediaKind === 'video' ? 'video' : 'image';
  const mediaUrl = String(properties.mediaUrl ?? '');
  const detailUrl = properties.detailUrl ? String(properties.detailUrl) : undefined;
  const areaLabel = properties.areaLabel ? String(properties.areaLabel) : undefined;
  const observedAt = typeof properties.observedAt === 'number' ? properties.observedAt : undefined;

  if (!sourceId || !name || !mediaUrl || !cityId || !cityName) return null;

  return {
    sourceId,
    source,
    name,
    coordinates: coordinates ?? [0, 0],
    mediaKind,
    mediaUrl,
    city: { id: cityId, name: cityName },
    ...(detailUrl ? { detailUrl } : {}),
    ...(areaLabel ? { areaLabel } : {}),
    ...(observedAt !== undefined ? { observedAt } : {}),
  };
}

export interface WebcamClickEvent {
  features?: Array<{
    properties?: Record<string, unknown> | null;
    geometry?: { coordinates?: [number, number] };
  }>;
  lngLat: { lng: number; lat: number };
}

export interface WebcamPopupMap {
  on(
    event: 'click' | 'mouseenter' | 'mouseleave',
    layerId: string,
    handler: (event: WebcamClickEvent) => void,
  ): void;
  off(
    event: 'click' | 'mouseenter' | 'mouseleave',
    layerId: string,
    handler: (event: WebcamClickEvent) => void,
  ): void;
  getZoom?(): number;
  getCenter?(): { lng: number; lat: number } | [number, number];
  getBounds?(): { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number };
  getCanvas?: () => { style: { cursor: string } };
}

export function installWebcamPopups(
  map: WebcamPopupMap,
  onOpenWebcam: (camera: MetroManilaTrafficCamera, lngLat: { lng: number; lat: number }) => void,
): () => void {
  const onClick = (e: {
    features?: Array<{ properties?: Record<string, unknown> | null; geometry?: { coordinates?: [number, number] } }>;
    lngLat: { lng: number; lat: number };
  }): void => {
    const feature = e.features?.[0];
    if (!feature?.properties) return;
    const coords = (feature.geometry?.coordinates as [number, number] | undefined) ?? [
      e.lngLat.lng,
      e.lngLat.lat,
    ];
    const cam = cameraFromFeature(feature.properties, coords);
    if (!cam) return;

    // Check visibility conditions:
    const zoom = map.getZoom?.() ?? 12;
    const rawCenter = map.getCenter?.();
    const center: [number, number] | undefined = Array.isArray(rawCenter)
      ? rawCenter
      : rawCenter
        ? [rawCenter.lng, rawCenter.lat]
        : undefined;

    const rawBounds = map.getBounds?.();
    const bounds: [number, number, number, number] | undefined = rawBounds
      ? [rawBounds.getWest(), rawBounds.getSouth(), rawBounds.getEast(), rawBounds.getNorth()]
      : undefined;

    if (!isCameraCityVisible(cam, { zoom, center, bounds })) {
      return;
    }

    onOpenWebcam(cam, e.lngLat);
  };

  const setCursor = (c: string): void => {
    const canvas = map.getCanvas?.();
    if (canvas) canvas.style.cursor = c;
  };
  const enter = (): void => setCursor('pointer');
  const leave = (): void => setCursor('');

  map.on('click', WEBCAM_LAYER_ID, onClick);
  map.on('mouseenter', WEBCAM_LAYER_ID, enter);
  map.on('mouseleave', WEBCAM_LAYER_ID, leave);

  return () => {
    map.off('click', WEBCAM_LAYER_ID, onClick);
    map.off('mouseenter', WEBCAM_LAYER_ID, enter);
    map.off('mouseleave', WEBCAM_LAYER_ID, leave);
  };
}
