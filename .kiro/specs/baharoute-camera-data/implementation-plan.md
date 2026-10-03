# Implementation Plan: Metro Manila Camera Data

## Goal

Prepare BahaRoute to ingest authorized public traffic-camera metadata and expose only cameras inside Metro Manila's 17 LGUs. This phase covers the data contract, source adapter, NCR filtering, and validation. Camera controls, markers, popups, and video/image display are explicitly deferred to the later UI phase.

## Current findings and constraint

- BahaRoute is a Vite React/TypeScript SPA with local NCR city boundaries and explicit city-name normalization.
- Windy Webcams API v3 documents list and map-cluster endpoints, bounding-box filtering, API-key authentication, media metadata, and expiring image URLs. Windy is the selected source; no API key or server-side adapter is configured yet.
- Use only provider-returned media URLs and follow Windy's free-tier limits, image URL expiry, attribution, and advertising terms. Do not scrape Windy web pages or reconstruct media URLs.

## Proposed data contract

Create a camera record independent of any one provider, with at minimum:

- stable source camera ID and provider/source name;
- display name and optional road/address/city label;
- WGS84 longitude/latitude;
- media kind (`image` or `video`) and authorized media URL;
- optional image refresh interval or stream format, when supplied by the provider;
- source observation/update timestamp and fetch timestamp;
- attribution/license or terms reference required by the provider.

Normalize and validate records at the adapter boundary. Reject malformed coordinates, missing IDs, unsupported media kinds, and unsafe/non-HTTPS media URLs unless the provider explicitly documents another secure transport. Preserve source timestamps; do not label stale frames as live. Camera observations remain contextual evidence only and must not change flood-risk classifications, community-report verification, route scores, or closure status.

## Ordered implementation steps

### 1. Resolve the source contract before live calls

- Request/document the provider's supported endpoint or export, schema, authentication, refresh limits, coverage, CORS behavior, image/video URL lifetime, attribution, and redistribution/embedding permissions.
- Verify the returned locations cover the target NCR cities and decide whether the source supplies city names, coordinates, or both.
- If credentials are required, do not put secrets in `VITE_*` variables or browser code. Add a server-side proxy only after the hosting/runtime target is known; otherwise use a public, keyless source explicitly permitted for browser use.
- **Gate:** no provider calls or production camera data until access and reuse terms are confirmed.

### 2. Add provider-neutral camera types and normalization

- Add `src/types/camera.ts` for normalized camera records, media kind, source metadata, and source freshness.
- Add `src/services/cameraProvider.ts` for a narrow provider interface and runtime normalization/validation. Keep HTTP details out of UI components.
- Add provider-specific parsing only for the verified source schema. Keep provider IDs and raw records traceable for diagnosis.

### 3. Filter to Metro Manila

- Reuse `src/data/geojson/metroManilaCityBoundaries.ts` and `src/data/geojson/cityNameNormalization.ts` rather than introducing another boundary dataset.
- Implement a pure filter in `src/services/metroManilaCameras.ts`: use a trusted normalized city/LGU value when supplied and cross-check coordinates; otherwise assign/filter via point-in-polygon against the 17 administrative boundaries.
- Retain a camera only if its valid coordinate falls within an NCR city boundary. Derive the NCR city from the containing boundary and keep the original provider label separately. Exclude outside-NCR and boundary-ambiguous records rather than guessing.
- Handle duplicate provider records deterministically by source ID; do not merge distinct feeds solely because they share coordinates.

### 4. Integrate fetching, caching, and failure behavior

- Add an injected fetch/client seam so the service is testable and the provider can be replaced without changing consumers.
- Fetch camera metadata as a separate environmental data source; do not connect it to the rainfall polling pipeline or flood-risk controller.
- Use bounded refresh/caching based on provider guidance, deduplicate concurrent requests, preserve the last valid snapshot on transient failure, and report stale/error state explicitly.
- Add a fixture file only if clearly marked demo data; never present fixture cameras as live observations.

### 5. Document the data source and operational limits

- Update `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`, and `docs/SETUP.md` with the normalized schema, source attribution, required configuration/proxy setup, refresh behavior, coverage limitations, and licensing terms once confirmed.
- Add a project-status note that camera data is available to a future UI surface; do not add that UI in this phase.

### 6. Verification for the data phase

- Unit-test schema normalization, invalid/stale records, HTTPS/media validation, NCR inclusion/exclusion, all 17 city assignments, city-label disagreement, boundary points, duplicates, and fetch failure/cache behavior.
- Verify that camera data does not mutate flood state or route evaluation.
- Run `npm run typecheck`, focused Vitest tests, `npm run lint`, and `npm run build` after implementation.

## Likely files

- New: `src/types/camera.ts`, `src/services/cameraProvider.ts`, `src/services/metroManilaCameras.ts`, related tests, and optionally clearly labeled camera fixtures.
- Reuse: `src/data/geojson/metroManilaCityBoundaries.ts`, `src/data/geojson/cityNameNormalization.ts`, existing point-in-polygon helpers where their geometry contract fits.
- Update: `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`, `docs/SETUP.md`, `docs/PROJECT_STATUS.md`.
- Deferred to UI follow-up: camera layer/markers, layer toggle, selected-camera detail panel, image/video player, responsive layout, and user-facing stale/source attribution states.

## Risks and decisions

- **Primary dependency:** provision a Windy Webcams API key and a server-side runtime for the provider adapter; keep the key out of browser code.
- Camera coverage may be sparse and uneven across the 17 cities; the system must report source coverage and never imply uniform NCR coverage.
- Image snapshots and video streams have different browser/CORS, bandwidth, expiry, and licensing requirements. Support only media types and embed methods explicitly documented by the provider.
- Camera images can be delayed, frozen, or unavailable. Expose capture/fetch times and freshness in the data model; camera absence is not evidence of no flooding or clear roads.
- No flood-risk, closure, or route-recommendation semantics change in this work.
