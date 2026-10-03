# Data Model

## Flood types (`src/types/flood.ts`)

- **`FloodState`**: `RED | ORANGE | YELLOW | GREEN | GRAY` — a closed set of exactly five values. `GRAY` = Unknown.
- **`VerificationStatus`**: `VERIFIED | UNCONFIRMED`.
- **`FloodDataType`**: `SUSCEPTIBILITY | REPORT | COMMUNITY_REPORT`.
- **`SusceptibilityLevel`**: `HIGH | MODERATE | LOW`.
- **`FloodItemMetadata`** (required on every item): `location` (`{ lng, lat }`), `source`, `dataType`, `updatedAt` (epoch seconds), `verificationStatus`; optional `severity`, `depth`, `description`, `sourceUrl`.
- **`FloodSusceptibility`**: modeled/historical exposure with hazard-shaped `Polygon | MultiPolygon` geometry — never a city-boundary proxy.
- **`FloodReport`**: current/recent reported condition; `passable` is present only when known and is required for `GREEN`.

Classification logic in `src/layers/floodClassification.ts` is pure and validated with property-based tests. Items missing required metadata are rejected, never projected. Times are epoch seconds throughout.

## NCR boundary data (`src/data/geojson/`)

- `metroManilaCityBoundaries.geojson` — `FeatureCollection`, 17 features (15 `Polygon`, 2 `MultiPolygon`: Caloocan and Las Piñas). Real administrative boundaries.
- `metroManilaCityBoundaries.ts` — loads and types the GeoJSON asset.
- `cityNameNormalization.ts` — explicit `city_norm → { id, name }` table for all 17 LGUs. Deliberately handles source variants: `QUEZON → Quezon City`, `LAS PINAS → Las Piñas`, `PARANAQUE → Parañaque`. Unknown/missing `city_norm` fails loudly.

## Traffic cameras (`src/types/camera.ts`)

- `TrafficCamera` is provider-neutral metadata: source ID/name, display name, WGS84 `[longitude, latitude]`, image/video kind, authorized HTTPS media URL, optional source observation time, optional refresh interval, attribution, and original area label.
- `CameraSnapshot` carries records and fetch time. Provider records are validated by `cameraProvider.ts`; source-specific parsing belongs in a `CameraProvider` adapter.
- `filterMetroManilaCameras` assigns each camera to exactly one of the 17 local administrative boundaries. Outside, ambiguous, and invalid-coordinate records are omitted; source city labels do not override geometry.
- Camera metadata is separate from current and historical flood-risk models. It must not create flood reports, confirmed closures, or route risk evidence by itself.
- Windy Webcams API v3 records are normalized by `windyCameraService.ts`. A same-origin Node proxy reads `WINDY_WEBCAMS_API_KEY` server-side; the app filters every returned coordinate against exact NCR city boundaries.
- Camera records preserve Windy's `active`/`inactive` status. The marker popup shows Manila local time/date, camera coordinates, a current Open-Meteo weather estimate, temperature in Celsius, and a heat index derived from temperature and relative humidity using the NWS formula.

## Per-city susceptibility summary (`src/data/fixtures/cityFloodSusceptibility.ts`)

A per-city modeled susceptibility summary drawn on the real administrative silhouette. Each of the 17 cities is assigned a single `HIGH`/`MODERATE`/`LOW` class (`NO GREEN`), paired with the real boundary geometry matched by normalized `city_norm`, and carries `dataType: 'SUSCEPTIBILITY'`, `UNCONFIRMED`, and a demo source label. The administrative geometry does not represent flood conditions — only the labeled summary value does.

## Fixtures (`src/data/fixtures/`)

All demo/non-authoritative: `floodSusceptibility`, `floodReports`, `communityReports`, `routes`, `routeFloodSegments`, `evacuationCenters`, `boundaries`, `cityFloodSusceptibility`. Served via `FixtureDataSource`.
