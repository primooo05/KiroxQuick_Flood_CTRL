// src/services/cameraWeatherService.ts
//
// Fetches model-based weather (temperature, humidity, weather code, heat index)
// from Open-Meteo for traffic webcams and Metro Manila's 17 LGUs.
//
// Optimizations:
//   1. Multi-coordinate batching: Comma-separated coordinates in 1 HTTP request
//      for up to 50 coordinates, eliminating 17 separate round-trips down to 1.
//   2. Stripped variables & restricted horizon: Only requests current temperature,
//      humidity, and weather_code with forecast_days=1 (cuts 80%+ payload size).
//   3. Stale-While-Revalidate (SWR) cache with 15-minute TTL: Instant UI render
//      from stale cache while revalidating in background; in-flight deduplication
//      prevents concurrent duplicate requests.

import { ncrCityInfos } from '../data/geojson/ncrCityContext';

/** Cache TTL: 15 minutes (ms). */
export const WEATHER_CACHE_TTL_MS = 15 * 60 * 1000;

/** Max coordinates per Open-Meteo multi-coordinate request. */
export const WEATHER_BATCH_SIZE = 50;

export interface CameraWeatherSnapshot {
  readonly weatherStatus: string;
  readonly temperatureC: number;
  readonly heatIndexC: number;
  readonly fetchedAt: number;
}

interface CacheEntry {
  readonly snapshot: CameraWeatherSnapshot;
  cachedAtMs: number;
}

/** In-memory SWR cache: key → CacheEntry. */
const weatherCache = new Map<string, CacheEntry>();

/** In-flight request deduplication: key → Promise. */
const inFlightRequests = new Map<string, Promise<CameraWeatherSnapshot>>();

/** Quantizes coordinates (~110m resolution) for stable cache keys. */
export function coordCacheKey(longitude: number, latitude: number): string {
  return `coord:${latitude.toFixed(3)},${longitude.toFixed(3)}`;
}

/** City ID cache key for LGU-level weather. */
export function lguCacheKey(cityId: string): string {
  return `lgu:${cityId}`;
}

/** Clears all cached weather data and in-flight promises (for testing/cleanup). */
export function clearWeatherCache(): void {
  weatherCache.clear();
  inFlightRequests.clear();
}

/** Returns the count of entries in the weather cache. */
export function getWeatherCacheSize(): number {
  return weatherCache.size;
}

/** Gets a cached snapshot if present, regardless of staleness. */
export function getCachedWeather(
  coordinates: readonly [longitude: number, latitude: number],
): CameraWeatherSnapshot | undefined {
  const [lng, lat] = coordinates;
  return weatherCache.get(coordCacheKey(lng, lat))?.snapshot;
}

/** Directly stores a snapshot into the SWR cache. */
export function setCachedWeather(
  coordinates: readonly [longitude: number, latitude: number],
  snapshot: CameraWeatherSnapshot,
  cachedAtMs = Date.now(),
): void {
  const [lng, lat] = coordinates;
  weatherCache.set(coordCacheKey(lng, lat), { snapshot, cachedAtMs });
}

interface OpenMeteoCurrentRecord {
  temperature_2m?: number;
  relative_humidity_2m?: number;
  weather_code?: number;
}

function parseWeatherRecord(
  payload: unknown,
  fetchedAt: number,
): CameraWeatherSnapshot {
  if (!isRecord(payload) || !isRecord(payload.current)) {
    throw new TypeError('Invalid weather service response');
  }

  const temperatureC = payload.current.temperature_2m;
  const humidity = payload.current.relative_humidity_2m;
  const weatherCode = payload.current.weather_code;
  if (
    typeof temperatureC !== 'number' ||
    !Number.isFinite(temperatureC) ||
    typeof humidity !== 'number' ||
    !Number.isFinite(humidity) ||
    humidity < 0 ||
    humidity > 100 ||
    typeof weatherCode !== 'number' ||
    !Number.isInteger(weatherCode)
  ) {
    throw new TypeError('Invalid current weather values');
  }

  return {
    weatherStatus: weatherCodeLabel(weatherCode),
    temperatureC,
    heatIndexC: calculateHeatIndexC(temperatureC, humidity),
    fetchedAt,
  };
}

/**
 * Builds an Open-Meteo URL stripping unused variables (surface_pressure, wind,
 * etc.) and restricting forecast horizon to 1 day.
 */
function buildOpenMeteoUrl(
  lats: readonly number[],
  lngs: readonly number[],
): URL {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', lats.map((lat) => lat.toFixed(4)).join(','));
  url.searchParams.set('longitude', lngs.map((lng) => lng.toFixed(4)).join(','));
  url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,weather_code');
  url.searchParams.set('forecast_days', '1');
  url.searchParams.set('temperature_unit', 'celsius');
  url.searchParams.set('timezone', 'Asia/Manila');
  return url;
}

/**
 * Fetches weather for multiple coordinates using Open-Meteo's native
 * comma-separated coordinate batching. Splits into batches of up to 50
 * coordinates. Updates SWR cache for all coordinates.
 */
export async function fetchMultiCoordinateWeather(
  coordinates: readonly (readonly [longitude: number, latitude: number])[],
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<CameraWeatherSnapshot[]> {
  if (coordinates.length === 0) return [];

  const results: CameraWeatherSnapshot[] = new Array(coordinates.length);
  const now = Date.now();
  const fetchedAt = Math.floor(now / 1000);

  // Split into chunks of WEATHER_BATCH_SIZE (all 17 LGUs fit in 1 batch).
  for (let i = 0; i < coordinates.length; i += WEATHER_BATCH_SIZE) {
    const chunk = coordinates.slice(i, i + WEATHER_BATCH_SIZE);
    const lats = chunk.map((c) => c[1]);
    const lngs = chunk.map((c) => c[0]);

    const url = buildOpenMeteoUrl(lats, lngs);
    const response = await fetcher(url, { signal });
    if (!response.ok) {
      throw new Error(`Weather service returned ${response.status}`);
    }

    const body: unknown = await response.json();
    const items: unknown[] = Array.isArray(body) ? body : [body];

    chunk.forEach((coord, idx) => {
      const item = items[idx];
      const snapshot = parseWeatherRecord(item, fetchedAt);
      results[i + idx] = snapshot;
      setCachedWeather(coord, snapshot, now);
    });
  }

  return results;
}

/**
 * Batches weather requests for all 17 Metro Manila LGUs in a SINGLE HTTP
 * request, eliminating 17 separate round-trips. Caches results by LGU id and
 * coordinate.
 */
export async function fetchLguWeatherBatch(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<Map<string, CameraWeatherSnapshot>> {
  const coords = ncrCityInfos.map((city) => city.labelPoint);
  const snapshots = await fetchMultiCoordinateWeather(coords, fetcher, signal);

  const lguMap = new Map<string, CameraWeatherSnapshot>();
  const now = Date.now();

  ncrCityInfos.forEach((city, index) => {
    const snapshot = snapshots[index];
    if (snapshot) {
      lguMap.set(city.id, snapshot);
      weatherCache.set(lguCacheKey(city.id), { snapshot, cachedAtMs: now });
    }
  });

  return lguMap;
}

/**
 * Triggers asynchronous background revalidation for a stale cache entry
 * without blocking the consumer (Stale-While-Revalidate pattern).
 */
async function revalidateWeather(
  coordinates: readonly [longitude: number, latitude: number],
  key: string,
  fetcher: typeof fetch,
): Promise<void> {
  if (inFlightRequests.has(key)) return;

  const fetchPromise = (async () => {
    const [longitude, latitude] = coordinates;
    const url = buildOpenMeteoUrl([latitude], [longitude]);
    const response = await fetcher(url);
    if (!response.ok) return;

    const payload: unknown = await response.json();
    const fetchedAt = Math.floor(Date.now() / 1000);
    const snapshot = parseWeatherRecord(payload, fetchedAt);
    weatherCache.set(key, { snapshot, cachedAtMs: Date.now() });
  })().catch(() => {
    // Fail safe: network error on revalidation retains stale cache.
  }).finally(() => {
    inFlightRequests.delete(key);
  });

  inFlightRequests.set(key, fetchPromise as Promise<CameraWeatherSnapshot>);
}

/**
 * Fetches current model-based conditions with SWR (15-min TTL) and throttling.
 *
 * SWR behavior:
 *   - Fresh cache (< 15 min): returns immediately with 0 network calls.
 *   - Stale cache (>= 15 min): returns stale data immediately and triggers
 *     background revalidation.
 *   - Cache miss: in-flight deduplicated fetch, caches on success.
 */
export async function fetchCameraWeather(
  coordinates: readonly [longitude: number, latitude: number],
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<CameraWeatherSnapshot> {
  const [longitude, latitude] = coordinates;
  const key = coordCacheKey(longitude, latitude);

  const cached = weatherCache.get(key);
  if (cached) {
    const ageMs = Date.now() - cached.cachedAtMs;
    if (ageMs < WEATHER_CACHE_TTL_MS) {
      // Fresh hit: zero network request.
      return cached.snapshot;
    }
    // Stale hit: return immediately, revalidate in background.
    void revalidateWeather(coordinates, key, fetcher);
    return cached.snapshot;
  }

  // Cache miss: deduplicate concurrent in-flight requests for the same key.
  const existingInFlight = inFlightRequests.get(key);
  if (existingInFlight) {
    return existingInFlight;
  }

  const fetchPromise = (async () => {
    const url = buildOpenMeteoUrl([latitude], [longitude]);
    const response = await fetcher(url, { signal });
    if (!response.ok) {
      throw new Error(`Weather service returned ${response.status}`);
    }

    const payload: unknown = await response.json();
    const fetchedAt = Math.floor(Date.now() / 1000);
    const snapshot = parseWeatherRecord(payload, fetchedAt);
    weatherCache.set(key, { snapshot, cachedAtMs: Date.now() });
    return snapshot;
  })().finally(() => {
    inFlightRequests.delete(key);
  });

  inFlightRequests.set(key, fetchPromise);
  return fetchPromise;
}

/** NWS heat-index algorithm (Fahrenheit inputs internally; Celsius output). */
export function calculateHeatIndexC(
  temperatureC: number,
  relativeHumidity: number,
): number {
  const temperatureF = (temperatureC * 9) / 5 + 32;
  const simpleF =
    0.5 *
    (temperatureF + 61 + (temperatureF - 68) * 1.2 + relativeHumidity * 0.094);
  let heatIndexF = (simpleF + temperatureF) / 2;

  if (heatIndexF >= 80) {
    heatIndexF =
      -42.379 +
      2.04901523 * temperatureF +
      10.14333127 * relativeHumidity -
      0.22475541 * temperatureF * relativeHumidity -
      0.00683783 * temperatureF ** 2 -
      0.05481717 * relativeHumidity ** 2 +
      0.00122874 * temperatureF ** 2 * relativeHumidity +
      0.00085282 * temperatureF * relativeHumidity ** 2 -
      0.00000199 * temperatureF ** 2 * relativeHumidity ** 2;

    if (relativeHumidity < 13 && temperatureF >= 80 && temperatureF <= 112) {
      heatIndexF -=
        ((13 - relativeHumidity) / 4) *
        Math.sqrt((17 - Math.abs(temperatureF - 95)) / 17);
    } else if (
      relativeHumidity > 85 &&
      temperatureF >= 80 &&
      temperatureF <= 87
    ) {
      heatIndexF +=
        ((relativeHumidity - 85) / 10) * ((87 - temperatureF) / 5);
    }
  }

  return ((heatIndexF - 32) * 5) / 9;
}

export function weatherCodeLabel(code: number): string {
  if (code === 0) return 'Clear sky';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if ([51, 53, 55].includes(code)) return 'Drizzle';
  if ([56, 57].includes(code)) return 'Freezing drizzle';
  if ([61, 63, 65].includes(code)) return 'Rain';
  if ([66, 67].includes(code)) return 'Freezing rain';
  if ([71, 73, 75, 77].includes(code)) return 'Snow';
  if ([80, 81, 82].includes(code)) return 'Rain showers';
  if ([85, 86].includes(code)) return 'Snow showers';
  if (code === 95) return 'Thunderstorm';
  if (code === 96 || code === 99) return 'Thunderstorm with hail';
  return 'Unknown conditions';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
