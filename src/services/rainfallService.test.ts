// src/services/rainfallService.test.ts
import { describe, expect, it, vi } from 'vitest';
import {
  RainfallService,
  fetchRainfall,
  normalizeResult,
  type FetchLike,
  type SampleCoord,
} from './rainfallService';

const NOW = 1_800_000_000;

/** Builds a fake fetch returning the given JSON body with ok=true. */
function okFetch(body: unknown): FetchLike {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  }));
}

describe('normalizeResult', () => {
  it('converts current mm/interval to mm/hr and reads forecast + accumulation', () => {
    const s = normalizeResult(
      {
        current: { interval: 900, precipitation: 3 }, // 3mm/15min → 12 mm/hr
        minutely_15: { precipitation: [3, 6] }, // 2nd bucket 6mm/15min → 24 mm/hr
        hourly: { precipitation: [1, 2, 0, 4] }, // accum = 7
      },
      NOW,
    );
    expect(s.nowMmHr).toBeCloseTo(12, 5);
    expect(s.next30MmHr).toBeCloseTo(24, 5);
    expect(s.recentAccumMm).toBeCloseTo(7, 5);
    expect(s.sampledAt).toBe(NOW);
  });

  it('yields nulls when fields are missing (never fabricates)', () => {
    const s = normalizeResult({}, NOW);
    expect(s.nowMmHr).toBeNull();
    expect(s.next30MmHr).toBeNull();
    expect(s.recentAccumMm).toBeNull();
  });
});

const COORDS: SampleCoord[] = [
  { psgc: 'A', lng: 121, lat: 14.6 },
  { psgc: 'B', lng: 121.1, lat: 14.7 },
];

describe('fetchRainfall', () => {
  it('maps an array response positionally back to PSGCs', async () => {
    const fetchImpl = okFetch([
      { current: { interval: 900, precipitation: 3 } },
      { current: { interval: 900, precipitation: 0 } },
    ]);
    const { byBarangay, batchesOk, batchesFailed } = await fetchRainfall(
      COORDS,
      fetchImpl,
    );
    expect(byBarangay.get('A')?.nowMmHr).toBeCloseTo(12, 5);
    expect(byBarangay.get('B')?.nowMmHr).toBe(0);
    expect(batchesOk).toBe(1);
    expect(batchesFailed).toBe(0);
  });

  it('handles a single-object response (one coordinate)', async () => {
    const fetchImpl = okFetch({ current: { interval: 900, precipitation: 1.5 } });
    const { byBarangay } = await fetchRainfall([COORDS[0]], fetchImpl);
    expect(byBarangay.get('A')?.nowMmHr).toBeCloseTo(6, 5);
  });

  it('does NOT throw on a persistent non-ok response; returns empty + failed count', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    const { byBarangay, batchesOk, batchesFailed } = await fetchRainfall(
      COORDS,
      fetchImpl,
    );
    expect(byBarangay.size).toBe(0);
    expect(batchesOk).toBe(0);
    expect(batchesFailed).toBe(1);
  });

  it('retries once with backoff on 429, then succeeds', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 429, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => [
          { current: { interval: 900, precipitation: 3 } },
          { current: { interval: 900, precipitation: 0 } },
        ],
      };
    });
    const { byBarangay, batchesOk } = await fetchRainfall(COORDS, fetchImpl);
    expect(calls).toBe(2); // initial 429 + one retry
    expect(batchesOk).toBe(1);
    expect(byBarangay.get('A')?.nowMmHr).toBeCloseTo(12, 5);
  });

  it('filters invalid/NaN coordinates before building requests', async () => {
    const fetchImpl: FetchLike = vi.fn(async (url: string) => {
      const n = new URL(url).searchParams.get('latitude')!.split(',').length;
      return {
        ok: true,
        status: 200,
        json: async () =>
          Array.from({ length: n }, () => ({
            current: { interval: 900, precipitation: 0 },
          })),
      };
    });
    const coords: SampleCoord[] = [
      { psgc: 'good', lng: 121, lat: 14.6 },
      { psgc: 'nan', lng: Number.NaN, lat: 14.6 },
      { psgc: 'oob', lng: 999, lat: 14.6 },
    ];
    const { byBarangay } = await fetchRainfall(coords, fetchImpl);
    // Only the valid coordinate is requested/returned.
    const url = (fetchImpl as unknown as { mock: { calls: string[][] } }).mock
      .calls[0][0];
    expect(new URL(url).searchParams.get('latitude')!.split(',')).toHaveLength(1);
    expect(byBarangay.has('good')).toBe(true);
    expect(byBarangay.has('nan')).toBe(false);
  });

  it('tolerates PARTIAL failure: keeps successful batches when one fails', async () => {
    // 60 coords / batch 50 → 2 batches. First ok, second fails persistently.
    const many: SampleCoord[] = Array.from({ length: 60 }, (_, i) => ({
      psgc: `P${i}`,
      lng: 121 + i * 0.001,
      lat: 14.5 + i * 0.001,
    }));
    let batch = 0;
    const fetchImpl: FetchLike = vi.fn(async (url: string) => {
      batch += 1;
      const n = new URL(url).searchParams.get('latitude')!.split(',').length;
      if (batch >= 2) return { ok: false, status: 500, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () =>
          Array.from({ length: n }, () => ({
            current: { interval: 900, precipitation: 0 },
          })),
      };
    });
    const { byBarangay, batchesOk, batchesFailed } = await fetchRainfall(
      many,
      fetchImpl,
    );
    // First batch (50) preserved; second (10) failed — NOT all-or-nothing.
    expect(batchesOk).toBe(1);
    expect(batchesFailed).toBe(1);
    expect(byBarangay.size).toBe(50);
  });

  it('splits into batches of the conservative batch size (50)', async () => {
    const many: SampleCoord[] = Array.from({ length: 120 }, (_, i) => ({
      psgc: `P${i}`,
      lng: 121 + i * 0.001,
      lat: 14.5 + i * 0.001,
    }));
    const fetchImpl: FetchLike = vi.fn(async (url: string) => {
      const n = new URL(url).searchParams.get('latitude')!.split(',').length;
      return {
        ok: true,
        status: 200,
        json: async () =>
          Array.from({ length: n }, () => ({
            current: { interval: 900, precipitation: 0 },
          })),
      };
    });
    const { byBarangay } = await fetchRainfall(many, fetchImpl);
    // 120 / 50 → 3 requests, all 120 mapped back.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(byBarangay.size).toBe(120);
  });
});

describe('RainfallService fail-safe + caching', () => {
  it('marks unavailable (not fabricated) when the first fetch fails', async () => {
    const fetchImpl: FetchLike = vi.fn(async () => {
      throw new Error('network down');
    });
    const svc = new RainfallService(COORDS, fetchImpl, 999999);
    await svc.refresh();
    const snap = svc.snapshot();
    expect(snap.status).toBe('unavailable');
    expect(snap.byBarangay.size).toBe(0);
    expect(snap.lastUpdated).toBeNull();
  });

  it('retains the last good data and marks stale on a later failure', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { current: { interval: 900, precipitation: 3 } },
            { current: { interval: 900, precipitation: 0 } },
          ],
        };
      }
      throw new Error('network down');
    });
    const svc = new RainfallService(COORDS, fetchImpl, 999999);

    await svc.refresh();
    expect(svc.snapshot().status).toBe('ok');
    const firstUpdated = svc.snapshot().lastUpdated;
    expect(firstUpdated).not.toBeNull();

    await svc.refresh();
    const snap = svc.snapshot();
    expect(snap.status).toBe('stale');
    // Data + timestamp preserved from the last success.
    expect(snap.byBarangay.get('A')?.nowMmHr).toBeCloseTo(12, 5);
    expect(snap.lastUpdated).toBe(firstUpdated);
  });

  it('notifies subscribers on refresh', async () => {
    const fetchImpl = okFetch([
      { current: { interval: 900, precipitation: 0 } },
      { current: { interval: 900, precipitation: 0 } },
    ]);
    const svc = new RainfallService(COORDS, fetchImpl, 999999);
    const listener = vi.fn();
    svc.subscribe(listener);
    await svc.refresh();
    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls[0][0].status).toBe('ok');
  });
});
