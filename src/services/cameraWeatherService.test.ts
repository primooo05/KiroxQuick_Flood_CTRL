// src/services/cameraWeatherService.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  fetchCameraWeather,
  fetchMultiCoordinateWeather,
  fetchLguWeatherBatch,
  clearWeatherCache,
  getCachedWeather,
  setCachedWeather,
  coordCacheKey,
  WEATHER_CACHE_TTL_MS,
  calculateHeatIndexC,
  weatherCodeLabel,
  type CameraWeatherSnapshot,
} from './cameraWeatherService';
import { ncrCityInfos } from '../data/geojson/ncrCityContext';

function mockWeatherResponse(
  temp = 28.5,
  humidity = 80,
  code = 1,
) {
  return {
    current: {
      temperature_2m: temp,
      relative_humidity_2m: humidity,
      weather_code: code,
    },
  };
}

describe('cameraWeatherService', () => {
  beforeEach(() => {
    clearWeatherCache();
    vi.restoreAllMocks();
  });

  describe('1. Multi-coordinate batching (1 HTTP request for all LGUs)', () => {
    it('batches multiple coordinates into comma-separated Open-Meteo URL parameters', async () => {
      const capturedUrls: string[] = [];
      const fakeFetcher = vi.fn(async (url: URL | RequestInfo) => {
        capturedUrls.push(url.toString());
        return {
          ok: true,
          status: 200,
          json: async () => [
            mockWeatherResponse(29.0, 75, 0),
            mockWeatherResponse(30.0, 70, 1),
            mockWeatherResponse(28.0, 85, 2),
          ],
        } as Response;
      });

      const coords: readonly (readonly [number, number])[] = [
        [120.9842, 14.5995], // Manila
        [121.0244, 14.5547], // Makati
        [121.0437, 14.6760], // Quezon City
      ];

      const results = await fetchMultiCoordinateWeather(coords, fakeFetcher as unknown as typeof fetch);

      expect(fakeFetcher).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(3);
      expect(results[0].weatherStatus).toBe('Clear sky');
      expect(results[1].weatherStatus).toBe('Mainly clear');
      expect(results[2].weatherStatus).toBe('Partly cloudy');

      // Check the URL query parameters
      const url = new URL(capturedUrls[0]);
      expect(url.searchParams.get('latitude')).toBe('14.5995,14.5547,14.6760');
      expect(url.searchParams.get('longitude')).toBe('120.9842,121.0244,121.0437');
    });

    it('fetches all 17 Metro Manila LGUs in exactly 1 single HTTP request', async () => {
      let callCount = 0;
      let requestedLats = '';
      let requestedLngs = '';

      const fakeFetcher = vi.fn(async (url: URL | RequestInfo) => {
        callCount += 1;
        const parsed = new URL(url.toString());
        requestedLats = parsed.searchParams.get('latitude') ?? '';
        requestedLngs = parsed.searchParams.get('longitude') ?? '';

        // Return an array of 17 results
        const items = ncrCityInfos.map((_, i) =>
          mockWeatherResponse(28 + i * 0.1, 75, 1),
        );
        return {
          ok: true,
          status: 200,
          json: async () => items,
        } as Response;
      });

      const lguMap = await fetchLguWeatherBatch(fakeFetcher as unknown as typeof fetch);

      // Exactly 1 round-trip for all 17 LGUs
      expect(callCount).toBe(1);
      expect(lguMap.size).toBe(17);

      // Verify all 17 coordinates were joined in order
      const latList = requestedLats.split(',');
      const lngList = requestedLngs.split(',');
      expect(latList).toHaveLength(17);
      expect(lngList).toHaveLength(17);

      // Verify all 17 LGU city IDs are present in the returned Map
      expect(lguMap.has('manila')).toBe(true);
      expect(lguMap.has('makati')).toBe(true);
      expect(lguMap.has('quezon-city')).toBe(true);
      expect(lguMap.has('pateros')).toBe(true);
    });
  });

  describe('2. Strip unused hourly/daily variables', () => {
    it('restricts query to minimal current variables and horizon', async () => {
      let requestedUrl = '';
      const fakeFetcher = vi.fn(async (url: URL | RequestInfo) => {
        requestedUrl = url.toString();
        return {
          ok: true,
          status: 200,
          json: async () => mockWeatherResponse(),
        } as Response;
      });

      await fetchCameraWeather([120.9842, 14.5995], fakeFetcher as unknown as typeof fetch);

      const parsed = new URL(requestedUrl);
      expect(parsed.searchParams.get('current')).toBe(
        'temperature_2m,relative_humidity_2m,weather_code',
      );
      expect(parsed.searchParams.get('forecast_days')).toBe('1');
      // No extra variables like surface_pressure, hourly, daily, etc.
      expect(parsed.searchParams.get('hourly')).toBeNull();
      expect(parsed.searchParams.get('daily')).toBeNull();
      expect(parsed.searchParams.get('surface_pressure')).toBeNull();
    });
  });

  describe('4. Cache & throttle (SWR / 15-minute TTL)', () => {
    it('fresh cache hit (< 15 min TTL) returns cached snapshot with zero network requests', async () => {
      const coords = [120.9842, 14.5995] as const;
      const fakeFetcher = vi.fn();

      // Seed cache 5 minutes ago (well within 15 min TTL)
      const seeded: CameraWeatherSnapshot = {
        weatherStatus: 'Partly cloudy',
        temperatureC: 31.0,
        heatIndexC: 36.5,
        fetchedAt: Math.floor(Date.now() / 1000) - 300,
      };
      setCachedWeather(coords, seeded, Date.now() - 5 * 60 * 1000);

      const result = await fetchCameraWeather(coords, fakeFetcher as unknown as typeof fetch);

      expect(result).toBe(seeded);
      expect(fakeFetcher).not.toHaveBeenCalled();
    });

    it('stale cache hit (>= 15 min TTL) returns stale data immediately and triggers background revalidation', async () => {
      const coords = [120.9842, 14.5995] as const;
      let revalidationResolved: () => void = () => {};
      const revalidationWait = new Promise<void>((resolve) => {
        revalidationResolved = resolve;
      });

      const fakeFetcher = vi.fn(async () => {
        revalidationResolved();
        return {
          ok: true,
          status: 200,
          json: async () => mockWeatherResponse(33.0, 70, 0),
        } as Response;
      });

      // Seed cache 20 minutes ago (expired beyond 15-min TTL)
      const staleSnapshot: CameraWeatherSnapshot = {
        weatherStatus: 'Overcast',
        temperatureC: 27.0,
        heatIndexC: 30.0,
        fetchedAt: Math.floor(Date.now() / 1000) - 1200,
      };
      setCachedWeather(coords, staleSnapshot, Date.now() - 20 * 60 * 1000);

      // Caller receives stale result immediately without waiting
      const result = await fetchCameraWeather(coords, fakeFetcher as unknown as typeof fetch);
      expect(result.temperatureC).toBe(27.0);
      expect(result.weatherStatus).toBe('Overcast');

      // Wait for background revalidation
      await revalidationWait;
      expect(fakeFetcher).toHaveBeenCalledTimes(1);

      // After revalidation finishes, cache now holds the fresh data
      const updated = getCachedWeather(coords);
      expect(updated?.temperatureC).toBe(33.0);
      expect(updated?.weatherStatus).toBe('Clear sky');
    });

    it('deduplicates concurrent in-flight requests for the same coordinates', async () => {
      const coords = [120.9842, 14.5995] as const;
      let networkCalls = 0;

      const fakeFetcher = vi.fn(async () => {
        networkCalls += 1;
        await new Promise((r) => setTimeout(r, 50));
        return {
          ok: true,
          status: 200,
          json: async () => mockWeatherResponse(29.5, 78, 1),
        } as Response;
      });

      // Fire 3 simultaneous requests
      const [r1, r2, r3] = await Promise.all([
        fetchCameraWeather(coords, fakeFetcher as unknown as typeof fetch),
        fetchCameraWeather(coords, fakeFetcher as unknown as typeof fetch),
        fetchCameraWeather(coords, fakeFetcher as unknown as typeof fetch),
      ]);

      expect(networkCalls).toBe(1);
      expect(r1.temperatureC).toBe(29.5);
      expect(r2.temperatureC).toBe(29.5);
      expect(r3.temperatureC).toBe(29.5);
    });

    it('retains stale cache if background revalidation network call fails', async () => {
      const coords = [120.9842, 14.5995] as const;
      const fakeFetcher = vi.fn(async () => {
        throw new Error('Network timeout');
      });

      const staleSnapshot: CameraWeatherSnapshot = {
        weatherStatus: 'Rain',
        temperatureC: 25.0,
        heatIndexC: 26.0,
        fetchedAt: Math.floor(Date.now() / 1000) - 1500,
      };
      setCachedWeather(coords, staleSnapshot, Date.now() - 25 * 60 * 1000);

      const result = await fetchCameraWeather(coords, fakeFetcher as unknown as typeof fetch);
      expect(result.weatherStatus).toBe('Rain');

      // Allow background rejection to settle
      await new Promise((r) => setTimeout(r, 20));

      // Cache still retains the stale snapshot rather than wiping it
      expect(getCachedWeather(coords)?.weatherStatus).toBe('Rain');
    });
  });

  describe('heat index & weather calculations', () => {
    it('calculates heat index correctly under high temperature and humidity', () => {
      const hi = calculateHeatIndexC(32, 80);
      expect(hi).toBeGreaterThan(40); // dangerous heat index
    });

    it('maps weather codes to descriptive labels', () => {
      expect(weatherCodeLabel(0)).toBe('Clear sky');
      expect(weatherCodeLabel(3)).toBe('Overcast');
      expect(weatherCodeLabel(61)).toBe('Rain');
      expect(weatherCodeLabel(95)).toBe('Thunderstorm');
      expect(weatherCodeLabel(999)).toBe('Unknown conditions');
    });
  });
});
