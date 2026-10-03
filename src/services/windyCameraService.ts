import { filterMetroManilaCameras } from './metroManilaCameras';
import type { CameraStatus, MetroManilaTrafficCamera, TrafficCamera } from '../types/camera';

export interface CameraViewportBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

const NCR_BOUNDS: CameraViewportBounds = { west: 120.9, south: 14.34, east: 121.15, north: 14.8 };

export interface WindyCameraSnapshot {
  readonly cameras: readonly MetroManilaTrafficCamera[];
  readonly fetchedAt: number;
  readonly stale: boolean;
}

/** Fetches from BahaRoute's same-origin proxy; the Windy key never reaches the browser. */
export async function fetchWindyCameras(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
  bounds?: CameraViewportBounds,
  forceFresh = false,
): Promise<WindyCameraSnapshot> {
  const query = new URLSearchParams();
  if (bounds) query.set('bbox', [bounds.north, bounds.east, bounds.south, bounds.west].join(','));
  if (forceFresh) query.set('fresh', '1');
  const queryString = query.toString();
  const endpoint = `/api/cameras${queryString ? `?${queryString}` : ''}`;
  const response = await fetcher(endpoint, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`Camera service returned ${response.status}`);
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.cameras) || !isEpoch(payload.fetchedAt)) {
    throw new TypeError('Invalid camera service response');
  }

  const normalized = payload.cameras
    .map(normalizeWindyCamera)
    .filter((camera): camera is TrafficCamera => camera !== null);
  const ncrCameras = filterMetroManilaCameras(normalized);
  return {
    cameras: bounds
      ? ncrCameras.filter((camera) => isInsideBounds(camera, bounds))
      : ncrCameras,
    fetchedAt: payload.fetchedAt,
    stale: payload.stale === true,
  };
}

/** Fetches one current Windy image URL after a popup image error or timer tick. */
export async function fetchWindyCameraImageUrl(
  webcamId: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!/^\d+$/.test(webcamId)) return null;
  const response = await fetcher(`/api/cameras/${encodeURIComponent(webcamId)}`, {
    signal,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Camera service returned ${response.status}`);
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !isRecord(payload.camera)) {
    throw new TypeError('Invalid camera service response');
  }
  const camera = normalizeWindyCamera(payload.camera);
  return camera?.mediaKind === 'image' && camera.sourceId === webcamId ? camera.mediaUrl : null;
}

/** Restricts a map viewport to BahaRoute's Metro Manila camera coverage. */
export function clipCameraViewportToNcr(bounds: CameraViewportBounds): CameraViewportBounds | null {
  if (!Object.values(bounds).every(Number.isFinite)) return null;
  const clipped = {
    west: Math.max(bounds.west, NCR_BOUNDS.west),
    south: Math.max(bounds.south, NCR_BOUNDS.south),
    east: Math.min(bounds.east, NCR_BOUNDS.east),
    north: Math.min(bounds.north, NCR_BOUNDS.north),
  };
  if (clipped.west >= clipped.east || clipped.south >= clipped.north) return null;
  return clipped;
}

function isInsideBounds(camera: TrafficCamera, bounds: CameraViewportBounds): boolean {
  const [longitude, latitude] = camera.coordinates;
  return longitude >= bounds.west && longitude <= bounds.east &&
    latitude >= bounds.south && latitude <= bounds.north;
}

/** Converts a Windy Webcams API v3 record; malformed records are skipped. */
export function normalizeWindyCamera(value: unknown): TrafficCamera | null {
  if (!isRecord(value) || !isRecord(value.location)) return null;
  const id = value.webcamId;
  const sourceId = typeof id === 'number' && Number.isFinite(id) ? String(id) : id;
  const name = typeof value.title === 'string' ? value.title.trim() : '';
  const lng = value.location.longitude;
  const lat = value.location.latitude;
  if (
    typeof sourceId !== 'string' && typeof sourceId !== 'number' ||
    String(sourceId).trim() === '' || !name ||
    typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180 ||
    typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90
  ) return null;

  const images = isRecord(value.images) && isRecord(value.images.current)
    ? value.images.current : null;
  const imageUrl = images ? (safeHttps(images.preview) ?? safeHttps(images.icon)) : null;
  const player = isRecord(value.player) ? value.player : null;
  const liveEmbed = player ? safeWindyEmbed(player.live) : null;
  const mediaUrl = liveEmbed ?? imageUrl;
  if (!mediaUrl) return null;
  const status = value.status === 'active' || value.status === 'inactive'
    ? value.status as CameraStatus
    : undefined;

  const urls = isRecord(value.urls) ? value.urls : null;
  const locationCity = typeof value.location.city === 'string' ? value.location.city : undefined;
  const updateSeconds = typeof value.lastUpdatedOn === 'string'
    ? Math.floor(Date.parse(value.lastUpdatedOn) / 1000)
    : undefined;
  const observedAt = updateSeconds !== undefined && Number.isFinite(updateSeconds) && updateSeconds >= 0
    ? updateSeconds : undefined;

  return {
    sourceId: String(sourceId),
    source: 'Windy',
    name,
    coordinates: [lng, lat],
    mediaKind: liveEmbed ? 'video' : 'image',
    ...(status ? { status } : {}),
    mediaUrl,
    ...(safeWindyPage(urls?.detail) ? { detailUrl: safeWindyPage(urls?.detail)! } : {}),
    ...(observedAt !== undefined ? { observedAt } : {}),
    attribution: 'Webcams provided by Windy.com — add a webcam',
    ...(locationCity ? { areaLabel: locationCity } : {}),
  };
}

function safeHttps(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch { return null; }
}

function safeWindyEmbed(value: unknown): string | null {
  const candidate = typeof value === 'string' ? value : isRecord(value) ? value.embed : null;
  const url = safeHttps(candidate);
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'windy.com' || host.endsWith('.windy.com') ? url : null;
  } catch { return null; }
}

function safeWindyPage(value: unknown): string | null {
  const url = safeHttps(value);
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'windy.com' || host === 'www.windy.com' ? url : null;
  } catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isEpoch(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
