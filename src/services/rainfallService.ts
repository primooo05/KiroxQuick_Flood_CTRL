// src/services/rainfallService.ts
//
// Fetches ESTIMATED (model-based) rainfall for barangay centroids from
// Open-Meteo. This is a hackathon weather source: values are labeled
// "Estimated rainfall / model-based weather data" everywhere in the UI and are
// NEVER presented as official PAGASA observations.
//
// Strategy (Req 3 & 11):
//   - Sample at each barangay's PRECOMPUTED centroid (no per-barangay geometry
//     work, no uncontrolled per-barangay requests).
//   - BATCH many coordinates per request (Open-Meteo accepts comma-separated
//     lat/lon lists, up to 1000 locations). NCR's 1,710 barangays are split
//     into a few batches.
//   - CACHE the last successful result in memory; expose its timestamp so the
//     UI can show "Last updated X ago" and detect staleness.
//   - POLL ~every 5 minutes.
//   - FAIL SAFE: on any error the previous cache is retained and marked stale;
//     the service NEVER fabricates rainfall or substitutes demo data as real.

import type { RainfallSample } from '../types/risk';

/** Open-Meteo forecast endpoint (no API key required). */
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

/** Human-facing source label — clearly model-based, not official. */
export const RAINFALL_SOURCE_LABEL =
  'Estimated rainfall — Open-Meteo (model-based, not official PAGASA)';

/** Default poll interval (~5 min, per the MVP target). */
export const RAINFALL_POLL_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Max coordinates per Open-Meteo request. Conservative (50) so the request URL
 * stays far under the server's ~limit (a 500-coord URL returned HTTP 414
 * "Request-URI Too Large" in testing; 50 coords ≈ 1.3 KB URL). Combined with
 * COARSE-GRID sampling upstream (see rainfallGrid.ts), a full NCR refresh is
 * 1–2 requests, which avoids Open-Meteo's hourly rate limit (HTTP 429) that was
 * the root cause of persistent "Live rainfall unavailable".
 */
export const RAINFALL_BATCH_SIZE = 50;

/** Delay between sequential batches (ms) to stay clear of burst rate limits. */
export const RAINFALL_BATCH_THROTTLE_MS = 250;

/** Base backoff (ms) for the single retry of a failed/rate-limited batch. */
export const RAINFALL_RETRY_BACKOFF_MS = 800;

/**
 * Dev-only diagnostics toggle. Vite sets `import.meta.env.DEV` in dev; we also
 * suppress under test (`MODE === 'test'`) to keep test output clean.
 */
function devDiagnosticsEnabled(): boolean {
  try {
    const env = (import.meta as { env?: { DEV?: boolean; MODE?: string } }).env;
    return Boolean(env?.DEV) && env?.MODE !== 'test';
  } catch {
    return false;
  }
}

/** A coordinate to sample, tagged with the barangay PSGC it belongs to. */
export interface SampleCoord {
  readonly psgc: string;
  readonly lng: number;
  readonly lat: number;
}

/** The overall status of the rainfall cache. */
export type RainfallStatus = 'idle' | 'ok' | 'stale' | 'unavailable';

/** A snapshot of the rainfall service state, safe to render. */
export interface RainfallSnapshot {
  readonly status: RainfallStatus;
  /** PSGC → latest sample. Empty until the first successful fetch. */
  readonly byBarangay: ReadonlyMap<string, RainfallSample>;
  /** Epoch seconds of the last SUCCESSFUL fetch, or null if none yet. */
  readonly lastUpdated: number | null;
}

/** Minimal shape of one Open-Meteo location result we consume. */
interface OpenMeteoResult {
  current?: { time?: number; interval?: number; precipitation?: number };
  minutely_15?: { time?: number[]; precipitation?: number[] };
  hourly?: { time?: number[]; precipitation?: number[] };
}

/** Injectable fetch so tests need no network. Defaults to global fetch. */
export type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Converts a precipitation amount over an interval (seconds) into a mm/hr rate.
 * `current.precipitation` is mm accumulated over `current.interval` seconds
 * (typically 900s = 15 min), so the rate is amount * 3600 / interval.
 */
function toMmPerHour(amountMm: number, intervalSeconds: number): number {
  if (!Number.isFinite(amountMm) || amountMm <= 0) return 0;
  const interval = intervalSeconds > 0 ? intervalSeconds : 3600;
  return (amountMm * 3600) / interval;
}

/** Normalizes one Open-Meteo result into a {@link RainfallSample}. */
export function normalizeResult(
  result: OpenMeteoResult,
  sampledAt: number,
): RainfallSample {
  // NOW: current precipitation over its interval → mm/hr.
  const cur = result.current;
  const nowMmHr =
    cur && typeof cur.precipitation === 'number'
      ? toMmPerHour(cur.precipitation, cur.interval ?? 900)
      : null;

  const hourly = result.hourly?.precipitation;

  // +30 MIN: prefer the 2nd minutely_15 bucket (≈15–30 min ahead); each bucket
  // is mm/15min → mm/hr. Falls back to the next hourly bucket if 15-min data is
  // absent (interpolated/estimated — the UI labels forecast as estimated).
  let next30MmHr: number | null = null;
  const m15 = result.minutely_15?.precipitation;
  if (Array.isArray(m15) && m15.length >= 2 && typeof m15[1] === 'number') {
    next30MmHr = toMmPerHour(m15[1], 900);
  } else if (Array.isArray(hourly) && typeof hourly[1] === 'number') {
    next30MmHr = toMmPerHour(hourly[1], 3600);
  }

  // +1 HR: the next full hourly bucket (mm/hr already; hourly precip is mm/hour).
  let next60MmHr: number | null = null;
  if (Array.isArray(hourly) && typeof hourly[1] === 'number') {
    next60MmHr = toMmPerHour(hourly[1], 3600);
  }

  // RECENT ACCUMULATION: sum of available hourly precipitation over the window
  // returned (past hours), in mm. Left null when no hourly data.
  let recentAccumMm: number | null = null;
  if (Array.isArray(hourly) && hourly.length > 0) {
    recentAccumMm = hourly.reduce(
      (sum, v) => sum + (typeof v === 'number' && v > 0 ? v : 0),
      0,
    );
  }

  return { nowMmHr, next30MmHr, next60MmHr, recentAccumMm, sampledAt };
}

/** Splits an array into fixed-size chunks. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Keeps only coordinates with finite, in-range lat/lng. Invalid/NaN/null
 * coordinates are dropped BEFORE building any request, so a bad centroid can
 * never desync the latitude/longitude arrays or poison a whole batch.
 */
export function validCoords(coords: readonly SampleCoord[]): SampleCoord[] {
  return coords.filter(
    (c) =>
      c != null &&
      typeof c.lat === 'number' &&
      typeof c.lng === 'number' &&
      Number.isFinite(c.lat) &&
      Number.isFinite(c.lng) &&
      c.lat >= -90 &&
      c.lat <= 90 &&
      c.lng >= -180 &&
      c.lng <= 180,
  );
}

/**
 * Builds the Open-Meteo URL for one batch of coordinates. The batch MUST be
 * pre-validated; this asserts the latitude/longitude arrays are the same length
 * (a mismatch would misalign every result) and throws loudly otherwise.
 */
function buildUrl(batch: readonly SampleCoord[]): string {
  const lats = batch.map((c) => c.lat.toFixed(4));
  const lngs = batch.map((c) => c.lng.toFixed(4));
  if (lats.length !== lngs.length) {
    throw new Error(
      `rainfall: latitude/longitude length mismatch (${lats.length} vs ${lngs.length})`,
    );
  }
  const params = new URLSearchParams({
    latitude: lats.join(','),
    longitude: lngs.join(','),
    current: 'precipitation',
    minutely_15: 'precipitation',
    hourly: 'precipitation',
    forecast_minutely_15: '2',
    forecast_hours: '2',
    past_hours: '3',
    timezone: 'UTC',
    timeformat: 'unixtime',
  });
  return `${OPEN_METEO_URL}?${params.toString()}`;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Result of one batch attempt, for partial-failure accounting + diagnostics. */
interface BatchOutcome {
  readonly ok: boolean;
  readonly samples: Map<string, RainfallSample>;
}

/**
 * Fetches ONE batch with a single retry on rate-limit (429) / network failure,
 * using linear backoff. Returns a partial-safe outcome: `ok=false` never
 * throws, so one failed batch does not abort the others. Emits dev diagnostics.
 */
async function fetchBatch(
  batch: readonly SampleCoord[],
  batchIndex: number,
  fetchImpl: FetchLike,
  sampledAt: number,
  signal?: AbortSignal,
): Promise<BatchOutcome> {
  const url = buildUrl(batch);
  const diagnostics = devDiagnosticsEnabled();
  const maxAttempts = 2; // initial + one retry

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const started = Date.now();
    try {
      const res = await fetchImpl(url, { signal });
      const durationMs = Date.now() - started;

      if (res.status === 429 || res.status === 503) {
        // Rate-limited / temporarily unavailable: back off then retry once.
        if (diagnostics) {
          logBatch(batchIndex, batch.length, url.length, res.status, durationMs, 0, 'rate-limited');
        }
        if (attempt < maxAttempts - 1) {
          await sleep(RAINFALL_RETRY_BACKOFF_MS * (attempt + 1));
          continue;
        }
        return { ok: false, samples: new Map() };
      }

      if (!res.ok) {
        if (diagnostics) {
          logBatch(batchIndex, batch.length, url.length, res.status, durationMs, 0, `http ${res.status}`);
        }
        return { ok: false, samples: new Map() };
      }

      const body = (await res.json()) as OpenMeteoResult | OpenMeteoResult[];
      // A single-location response is an object; multi-location is an ARRAY in
      // the same order as the input coordinates.
      const results = Array.isArray(body) ? body : [body];
      const samples = new Map<string, RainfallSample>();
      batch.forEach((coord, i) => {
        const result = results[i];
        if (result) samples.set(coord.psgc, normalizeResult(result, sampledAt));
      });
      if (diagnostics) {
        logBatch(batchIndex, batch.length, url.length, res.status, durationMs, samples.size, '');
      }
      return { ok: samples.size > 0, samples };
    } catch (error) {
      const durationMs = Date.now() - started;
      const message = error instanceof Error ? error.message : String(error);
      if (diagnostics) {
        logBatch(batchIndex, batch.length, url.length, 'ERR', durationMs, 0, message);
      }
      // Aborted request: do not retry, propagate nothing (caller handles).
      if (signal?.aborted) return { ok: false, samples: new Map() };
      if (attempt < maxAttempts - 1) {
        await sleep(RAINFALL_RETRY_BACKOFF_MS * (attempt + 1));
        continue;
      }
      return { ok: false, samples: new Map() };
    }
  }
  return { ok: false, samples: new Map() };
}

/** Dev-only structured batch diagnostic line. */
function logBatch(
  batchIndex: number,
  locations: number,
  urlLength: number,
  status: number | string,
  durationMs: number,
  resultCount: number,
  error: string,
): void {
  // eslint-disable-next-line no-console
  console.debug(
    `[rainfall] batch#${batchIndex} locations=${locations} urlLen=${urlLength} ` +
      `status=${status} dur=${durationMs}ms results=${resultCount}` +
      (error ? ` error="${error}"` : ''),
  );
}

/** The outcome of a full multi-batch fetch, including partial-failure counts. */
export interface FetchRainfallResult {
  readonly byBarangay: Map<string, RainfallSample>;
  readonly batchesOk: number;
  readonly batchesFailed: number;
}

/**
 * Fetches rainfall for all coordinates in small batches, tolerating PARTIAL
 * failure: each batch is fetched independently (with one backoff retry), and a
 * failed batch does NOT abort the others. Returns whatever succeeded plus the
 * ok/failed batch counts. NEVER throws — the caller decides staleness from the
 * result size, and preserves cached values for keys that failed this round.
 *
 * Invalid/NaN coordinates are filtered up front so they can never desync the
 * latitude/longitude arrays. Batches are throttled to avoid burst rate limits.
 */
export async function fetchRainfall(
  coords: readonly SampleCoord[],
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<FetchRainfallResult> {
  const sampledAt = Math.floor(Date.now() / 1000);
  const byBarangay = new Map<string, RainfallSample>();
  const batches = chunk(validCoords(coords), RAINFALL_BATCH_SIZE);

  let batchesOk = 0;
  let batchesFailed = 0;

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    if (batch.length === 0) continue;
    if (signal?.aborted) break;

    const outcome = await fetchBatch(batch, i, fetchImpl, sampledAt, signal);
    if (outcome.ok) {
      batchesOk += 1;
      for (const [psgc, sample] of outcome.samples) byBarangay.set(psgc, sample);
    } else {
      batchesFailed += 1;
    }

    // Throttle between batches (skip after the last one).
    if (i < batches.length - 1 && !signal?.aborted) {
      await sleep(RAINFALL_BATCH_THROTTLE_MS);
    }
  }

  return { byBarangay, batchesOk, batchesFailed };
}

/**
 * A stateful rainfall service: keeps the last successful snapshot, refreshes on
 * demand or on a poll timer, and never throws to callers. Subscribers are
 * notified on every snapshot change (including transitions to `stale`).
 */
export class RainfallService {
  private status: RainfallStatus = 'idle';
  private byBarangay: ReadonlyMap<string, RainfallSample> = new Map();
  private lastUpdated: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private controller: AbortController | null = null;
  private readonly listeners = new Set<(s: RainfallSnapshot) => void>();

  constructor(
    private readonly coords: readonly SampleCoord[],
    private readonly fetchImpl: FetchLike = globalThis.fetch?.bind(globalThis) as FetchLike,
    private readonly intervalMs: number = RAINFALL_POLL_INTERVAL_MS,
  ) {}

  /** Current immutable snapshot. */
  snapshot(): RainfallSnapshot {
    return {
      status: this.status,
      byBarangay: this.byBarangay,
      lastUpdated: this.lastUpdated,
    };
  }

  /** Subscribes to snapshot changes; returns an unsubscribe function. */
  subscribe(listener: (snapshot: RainfallSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }

  /**
   * Fetches once. On success updates the cache to `ok`. On failure, retains the
   * previous data and marks it `stale` (or `unavailable` if nothing cached
   * yet). NEVER throws and NEVER fabricates data.
   */
  async refresh(): Promise<void> {
    if (!this.fetchImpl || this.coords.length === 0) {
      this.status = this.lastUpdated ? 'stale' : 'unavailable';
      this.emit();
      return;
    }
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    try {
      const { byBarangay: next, batchesOk, batchesFailed } = await fetchRainfall(
        this.coords,
        this.fetchImpl,
        controller.signal,
      );

      if (next.size === 0) {
        // Nothing succeeded this round: retain any cached values and mark
        // stale (or unavailable if we never had data). NEVER fabricated.
        this.status = this.lastUpdated ? 'stale' : 'unavailable';
      } else {
        // Partial or full success. MERGE onto the previous cache so barangays
        // whose batch failed this round keep their last good value rather than
        // disappearing (they will read stale via age, never flipped to LOW).
        const merged = new Map(this.byBarangay);
        for (const [psgc, sample] of next) merged.set(psgc, sample);
        this.byBarangay = merged;
        this.lastUpdated = Math.floor(Date.now() / 1000);
        // Any successful data → ok. A partial failure does not blank the NCR.
        this.status = 'ok';
        if (devDiagnosticsEnabled() && batchesFailed > 0) {
          // eslint-disable-next-line no-console
          console.debug(
            `[rainfall] refresh partial: ${batchesOk} ok / ${batchesFailed} failed batches; ` +
              `merged ${next.size} updated samples (cache size ${merged.size})`,
          );
        }
      }
    } catch {
      // Defensive: fetchRainfall does not throw, but keep the last good data
      // and mark stale if something unexpected propagates.
      this.status = this.lastUpdated ? 'stale' : 'unavailable';
    } finally {
      this.emit();
    }
  }

  /** Starts polling (immediate refresh, then every `intervalMs`). */
  start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
  }

  /** Stops polling and aborts any in-flight request. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.controller?.abort();
    this.controller = null;
  }
}
