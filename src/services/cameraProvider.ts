import type { CameraSnapshot, TrafficCamera } from '../types/camera';

/** Implemented only for a source with documented access and reuse terms. */
export interface CameraProvider {
  readonly source: string;
  fetchSnapshot(signal?: AbortSignal): Promise<CameraSnapshot>;
}

/** Validates provider-neutral camera metadata at the adapter boundary. */
export function validateCameraSnapshot(value: unknown): CameraSnapshot {
  if (!isRecord(value) || !Array.isArray(value.cameras) || !isEpoch(value.fetchedAt)) {
    throw new TypeError('Invalid camera snapshot');
  }
  const cameras = value.cameras.map(validateCamera);
  return { cameras, fetchedAt: value.fetchedAt };
}

function validateCamera(value: unknown, index: number): TrafficCamera {
  if (!isRecord(value)) throw new TypeError(`Invalid camera at index ${index}`);
  const { sourceId, source, name, coordinates, mediaKind, mediaUrl } = value;
  if (
    !isNonEmptyString(sourceId) || !isNonEmptyString(source) ||
    !isNonEmptyString(name) || !Array.isArray(coordinates) || coordinates.length !== 2 ||
    !isFiniteNumber(coordinates[0]) || coordinates[0] < -180 || coordinates[0] > 180 ||
    !isFiniteNumber(coordinates[1]) || coordinates[1] < -90 || coordinates[1] > 90 ||
    (mediaKind !== 'image' && mediaKind !== 'video') || !isHttpsUrl(mediaUrl)
  ) {
    throw new TypeError(`Invalid camera at index ${index}`);
  }
  if (value.observedAt !== undefined && !isEpoch(value.observedAt)) {
    throw new TypeError(`Invalid camera observation time at index ${index}`);
  }
  if (value.refreshIntervalSeconds !== undefined &&
      (!isFiniteNumber(value.refreshIntervalSeconds) || value.refreshIntervalSeconds <= 0)) {
    throw new TypeError(`Invalid camera refresh interval at index ${index}`);
  }
  for (const optionalText of ['attribution', 'areaLabel', 'detailUrl'] as const) {
    if (value[optionalText] !== undefined && typeof value[optionalText] !== 'string') {
      throw new TypeError(`Invalid camera ${optionalText} at index ${index}`);
    }
  }
  if (value.detailUrl !== undefined) {
    try {
      if (new URL(value.detailUrl as string).protocol !== 'https:') {
        throw new TypeError(`Invalid camera detailUrl at index ${index}`);
      }
    } catch {
      throw new TypeError(`Invalid camera detailUrl at index ${index}`);
    }
  }

  return {
    sourceId, source, name,
    coordinates: [coordinates[0], coordinates[1]] as const,
    mediaKind: mediaKind as TrafficCamera['mediaKind'], mediaUrl,
    ...(value.observedAt !== undefined ? { observedAt: value.observedAt } : {}),
    ...(value.refreshIntervalSeconds !== undefined
      ? { refreshIntervalSeconds: value.refreshIntervalSeconds } : {}),
    ...(value.attribution !== undefined ? { attribution: value.attribution as string } : {}),
    ...(value.areaLabel !== undefined ? { areaLabel: value.areaLabel as string } : {}),
    ...(value.detailUrl !== undefined ? { detailUrl: value.detailUrl as string } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function isEpoch(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}
function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}
