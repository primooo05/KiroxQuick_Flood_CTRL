---
inclusion: always
---

# BahaRoute Architecture Overview

Read this before any substantial change. Paths below are real and discovered
from the repo — treat them as source-of-truth entry points, not a full map.

## Stack

React 18 + TypeScript 5.7 + Vite 5. Mapbox GL JS 3 (used directly, not via a
React wrapper). Vitest + fast-check for tests. Basemap: `mapbox/light-v11`.

## Map & layers

- `src/map/MapManager.ts` — wraps a structural `MinimalMap` interface; owns map
  lifecycle, readiness watchdog, resize, zoom clamp, and additive camera methods
  (`flyTo`/`easeTo`/`fitBounds`, no-op-safe). Testable without WebGL.
- `src/layers/LayerRegistry.ts` — fixed top→bottom render order, inserts via
  `addLayer(layer, beforeId)`; visibility toggles never reorder the stack.
- `src/camera/overviewFraming.ts` — pure framing. Desktop centerZoom
  `[120.9842, 14.5995]` @ zoom 11; mobile/portrait fitBounds over 17 NCR cities.

## Geographic data

- `src/data/geojson/ncrBarangays.ts` + `ncrBarangays.geojson` — 1,710 NCR
  barangays (PSGC `PH13`), local build-time asset, administrative geometry only
  (the canvas for feature-state painting, NOT flood data).
- `src/data/geojson/metroManilaCityBoundaries.*` — 17 LGU boundaries;
  `cityNameNormalization.ts` maps source variants and fails loudly on unknowns.

## Current flood-risk pipeline (near-real-time)

`src/services/rainfallService.ts` (Open-Meteo, batched, 5-min poll, fail-safe)
→ `rainfallGrid.ts` (coarse-grid sampling) → `barangayRiskModel.ts`
(`assessAllBarangays`) with `baselineSusceptibility.ts` + `reportResolution.ts`
→ `barangayRiskController.ts` (orchestrates poll → recompute → paint via Mapbox
feature-state). Types: `src/types/risk.ts`.

## Historical flood-risk assets (reference, separate pipeline)

- `src/data/historical/ncrHistoricalFloodRisk.ts` + JSON — derived per-barangay
  and per-city historical risk (`Low|Moderate|High|Unknown`) from Project NOAH /
  Phil-LiDAR, 100-year default, built offline by
  `data-processing/build_historical_flood_risk.py`. Never merged with current.

## Routing & route ranking

- `src/services/routePlanning.ts` — flood-aware route comparison; `RoutePreference`
  = `lowerFloodExposure | faster`; aggregates current risk, hazards, confirmed
  closures (strongest), and community reports (supporting). UNKNOWN/STALE never LOW.
- `src/services/directions.ts` — `fetchDirectionsRoutes`, `TravelMode`.

## Driver Mode

- `src/simulation/` — `DriveSimulator`, `navigation`, `reroute`, `routingPolicy`,
  `routeGeometry`.
- `src/components/driving/` — `DrivingHud`, `RerouteOffer`.

## UI surfaces

- `src/components/MapView.tsx` — composition root for the map experience.
- `src/components/trip/` — `RouteSearchPanel`, `RouteComparePanel`.
- `src/components/insights/` — `FloodInsights` (Current / Historical tabs).
- `src/components/overlays/` — `LiveStatusPill`, `BarangayInfoPanel`, `Disclaimer`,
  `DemoDataBadge`, `CoverageBadge`, `ConfigIncomplete`, popups.
- `src/components/controls/` — zoom, recenter, location, layers, timeline, etc.

## Config & responsiveness

- `src/services/env.ts` — reads `VITE_MAPBOX_ACCESS_TOKEN`; never throws when
  absent (shell renders config-incomplete, no tile request).
- Responsive desktop/mobile behavior is handled in framing + layout CSS
  (`src/styles/layout.css`) and the overlay/control components.

## Planned, not yet built

The pure App state machine (Overview / Search / Route Preview / Navigation,
spec Milestone D) is planned. Do not assume it exists in code.

## Reference docs

`docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/FLOOD_SEMANTICS.md`,
`docs/HISTORICAL_FLOOD_RISK.md`, `docs/PROJECT_STATUS.md`. Specs live in
`.kiro/specs/`.
