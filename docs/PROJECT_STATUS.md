# Project Status

## Specs

- `baharoute-metro-manila-map-foundation` (Milestone 1)
- `baharoute-navigation-experience` (Milestones A–L)

Spec documents live under `.kiro/specs/<spec>/{requirements,design,tasks}.md`.

Windy camera integration is implemented: a server-side API proxy, viewport-bounded metadata requests, exact NCR boundary filter, five-minute per-viewport cache, per-image seven-minute URL renewal with error recovery, and marker popups with camera location/status plus weather, Celsius temperature, and heat index summaries. The API key remains deployment configuration (`WINDY_WEBCAMS_API_KEY`).

## Milestone 1 — complete

Foundation delivered and verified: React + TypeScript + Vite app, flood data model and types, demo fixtures, `LayerRegistry` with fixed z-ordering, susceptibility layer with zoom-faded translucent fills, map controls (zoom/recenter/location), overlays (disclaimer, demo badge, config-incomplete, error, loading, flood popup), responsive layout, and accessibility.

Two later evolutions on this foundation:
- Migrated the rendering engine from MapLibre GL JS + MapTiler to Mapbox GL JS (`mapbox://styles/mapbox/light-v11`), changing the env var to `VITE_MAPBOX_ACCESS_TOKEN`. Product logic, flood semantics, the `MapManager` abstraction, and default framing were preserved.
- Replaced placeholder rectangular city geometry with real NCR administrative boundaries (17 LGUs) plus explicit name normalization.

## baharoute-navigation-experience

### Milestone A — complete
Metro Manila default-framing correction:
- Tuned NCR overview framing constants (`overviewFraming.ts`), including responsive fitBounds vs. desktop centerZoom (center `[120.9842, 14.5995]`, zoom `11`).
- Additive, no-op-safe `MapManager` camera methods.
- Startup framing that places a location marker without auto-zooming to the user.

### Milestones B–L — not started (planned)
- **B:** Full-screen navigation shell; restrained product chrome; rounded floating controls.
- **C:** Consumer, on-demand layer control panel.
- **D:** Pure App state machine (Overview/Search/Route Preview/Navigation) + React provider + single CameraController.
- **E:** Search with NCR-first ranking and honest out-of-NCR messaging.
- **F:** Route preview with pure flood-context computation and fixture routing provider.
- **G–L and Task 33 (manual browser verification):** navigation framing, provider integration, and end-to-end verification — see `tasks.md`.

## Verified quality gate (current build)

- `npm run typecheck` — pass
- `npm run lint` — pass
- `npm run test` — 317 passed, 32 files
- `npm run build` — pass (Mapbox vendor chunk-size advisory only)
