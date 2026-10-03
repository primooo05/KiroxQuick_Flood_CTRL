import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = resolve(ROOT, 'dist');
const PORT = Number(process.env.CAMERA_PROXY_PORT || 8787);
const HOST = process.env.CAMERA_PROXY_HOST || '127.0.0.1';
// Windy's free-tier image URL tokens expire after 10 minutes. Keep cached
// viewport results short-lived so reused URLs retain a safe expiry margin.
const CACHE_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;
const PAGE_SIZE = 50;
const MAX_OFFSET = 1000;
const WINDY_URL = 'https://api.windy.com/webcams/api/v3/webcams';
const INCLUDE = 'images,location,urls';
const NCR_BOUNDS = { west: 120.9, south: 14.34, east: 121.15, north: 14.8 };
const viewportCache = new Map();
const pendingViewports = new Map();

function getApiKey() {
  const apiKey = process.env.WINDY_WEBCAMS_API_KEY?.trim();
  if (!apiKey) throw Object.assign(new Error('Windy API key is not configured'), { status: 503 });
  return apiKey;
}

async function fetchWindyJson(url, apiKey = getApiKey()) {
  const response = await fetch(url, {
    headers: { 'x-windy-api-key': apiKey, accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw Object.assign(new Error(`Windy returned ${response.status}`), { status: 502 });
  }
  return response.json();
}

function clampBbox(value) {
  if (!value) return { ...NCR_BOUNDS };
  const values = value.split(',').map(Number);
  if (values.length !== 4 || !values.every(Number.isFinite)) {
    throw Object.assign(new Error('Invalid camera viewport'), { status: 400 });
  }
  const [north, east, south, west] = values;
  if (north < south || east < west || north > 90 || south < -90 || east > 180 || west < -180) {
    throw Object.assign(new Error('Invalid camera viewport'), { status: 400 });
  }
  const bounds = {
    west: Math.max(west, NCR_BOUNDS.west),
    south: Math.max(south, NCR_BOUNDS.south),
    east: Math.min(east, NCR_BOUNDS.east),
    north: Math.min(north, NCR_BOUNDS.north),
  };
  if (bounds.west >= bounds.east || bounds.south >= bounds.north) return null;
  return bounds;
}

function bboxKey(bounds) {
  return [bounds.north, bounds.east, bounds.south, bounds.west].map((value) => value.toFixed(5)).join(',');
}

async function fetchWindyViewport(bounds) {
  const apiKey = getApiKey();
  const records = [];
  let total = Infinity;
  for (let offset = 0; offset < total && offset <= MAX_OFFSET; offset += PAGE_SIZE) {
    const url = new URL(WINDY_URL);
    url.searchParams.set('bbox', bboxKey(bounds));
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('include', INCLUDE);
    url.searchParams.set('lang', 'en');

    const page = await fetchWindyJson(url, apiKey);
    const webcams = Array.isArray(page) ? page : page?.webcams;
    if (!Array.isArray(webcams)) throw Object.assign(new Error('Invalid Windy response'), { status: 502 });
    records.push(...webcams);
    total = Number.isFinite(page?.total) ? page.total : offset + webcams.length;
    if (webcams.length === 0) break;
  }
  return { cameras: records, fetchedAt: Math.floor(Date.now() / 1000), stale: false };
}

async function getViewportSnapshot(bounds, forceFresh = false) {
  const key = bboxKey(bounds);
  const cached = viewportCache.get(key);
  if (!forceFresh && cached && Date.now() - cached.cachedAt < CACHE_MS) return cached.value;
  const pending = pendingViewports.get(key);
  if (pending) return pending;

  const refresh = fetchWindyViewport(bounds)
    .then((value) => {
      viewportCache.delete(key);
      viewportCache.set(key, { value, cachedAt: Date.now() });
      for (const [cacheKey, entry] of viewportCache) {
        if (Date.now() - entry.cachedAt >= CACHE_MS) viewportCache.delete(cacheKey);
      }
      while (viewportCache.size > MAX_CACHE_ENTRIES) viewportCache.delete(viewportCache.keys().next().value);
      return value;
    })
    .finally(() => { pendingViewports.delete(key); });
  pendingViewports.set(key, refresh);
  return refresh;
}

async function fetchWindyCamera(webcamId) {
  const url = new URL(`${WINDY_URL}/${webcamId}`);
  url.searchParams.set('include', INCLUDE);
  url.searchParams.set('lang', 'en');
  const camera = await fetchWindyJson(url);
  return { camera, fetchedAt: Math.floor(Date.now() / 1000) };
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}

const MIME = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp',
};

async function serveStatic(pathname, res) {
  const decoded = decodeURIComponent(pathname);
  const candidate = resolve(DIST, `.${decoded === '/' ? '/index.html' : decoded}`);
  if (candidate !== DIST && !candidate.startsWith(`${DIST}${sep}`)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const file = await stat(candidate).then((info) => info.isFile() ? candidate : resolve(candidate, 'index.html'));
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'x-content-type-options': 'nosniff' });
    res.end(body);
  } catch {
    try {
      const body = await readFile(resolve(DIST, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'], 'x-content-type-options': 'nosniff' });
      res.end(body);
    } catch {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }).end('Build the app with npm run build first.');
    }
  }
}

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = requestUrl.pathname;
  if (pathname === '/health') return sendJson(res, 200, { ok: true });
  if (pathname === '/api/cameras') {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' });
    try {
      const bounds = clampBbox(requestUrl.searchParams.get('bbox'));
      if (!bounds) return sendJson(res, 200, { cameras: [], fetchedAt: Math.floor(Date.now() / 1000), stale: false });
      return sendJson(res, 200, await getViewportSnapshot(bounds, requestUrl.searchParams.get('fresh') === '1'));
    }
    catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 502;
      const code = status === 503 ? 'provider_not_configured' : status === 400 ? 'invalid_viewport' : 'provider_unavailable';
      return sendJson(res, status, { error: code });
    }
  }
  const cameraMatch = pathname.match(/^\/api\/cameras\/(\d+)$/);
  if (cameraMatch) {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' });
    try { return sendJson(res, 200, await fetchWindyCamera(cameraMatch[1])); }
    catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 502;
      return sendJson(res, status, { error: status === 503 ? 'provider_not_configured' : 'provider_unavailable' });
    }
  }
  if (process.env.CAMERA_PROXY_API_ONLY === '1') return sendJson(res, 404, { error: 'not_found' });
  return serveStatic(pathname, res);
});

server.listen(PORT, HOST, () => {
  // Deliberately never log provider credentials.
  process.stdout.write(`BahaRoute camera proxy listening on http://${HOST}:${PORT}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
