# Architecture

BahaRoute is a React + TypeScript single-page app built with Vite and rendered on Mapbox GL JS.

## Rendering engine

The app uses `mapbox-gl` directly (not a React wrapper) so the `MapManager` abstraction retains full control of the map lifecycle. The basemap is the stock Mapbox style `mapbox://styles/mapbox/light-v11`, chosen for a quiet, low-clutter base that lets the saturated flood overlays dominate.

## MapManager

`src/map/MapManager.ts` wraps a minimal, structurally-typed map interface (`MinimalMap`). This keeps map-dependent logic unit-testable without WebGL: tests inject a fake map recording calls, and the real `mapboxgl.Map` satisfies the same interface. `MapManager` owns:

- Map construction (applying the access token at build time — never hardcoded).
- Lifecycle, a readiness watchdog, resize handling, and zoom clamping.
- Additive camera pass-throughs (`flyTo`, `easeTo`, `setPitch`, `setBearing`, overview `fitBounds`) added in Milestone A, guarded so a map lacking a method is a safe no-op.

## Layer system

`src/layers/LayerRegistry.ts` owns a fixed top→bottom render order for app-managed canvas layers and inserts each at a known position relative to the basemap using `addLayer(layer, beforeId)` semantics. Visibility toggles use `setLayoutProperty('visibility', ...)` so toggling never reorders the stack.

Order (top renders on top):

```
flood reports > route highlights > road flood-condition segments >
flood susceptibility polygons > city flood summary > (basemap)
```

UI markers are DOM `Marker` overlays and sit above the canvas naturally; the registry does not manage them.

## Camera framing

`src/camera/overviewFraming.ts` is pure and engine-free. It describes what to fit and how much padding/duration to apply, and decides between two framing modes per viewport:

- **fitBounds** (narrow/portrait/mobile): frames all 17 NCR cities.
- **centerZoom** (wide desktop): tuned product framing at center `[120.9842, 14.5995]`, zoom `11`, so the NCR reads large and dominant.

No `maxBounds`/clip is emitted, so the basemap keeps rendering beyond the NCR and users can pan freely.

## Configuration & environment

`src/services/env.ts` reads `VITE_MAPBOX_ACCESS_TOKEN` and returns a typed `AppConfig`. It never throws when the token is missing, so the shell can render a config-incomplete message and gate tile requests on `hasTileKey`.

## Camera data integration seam

`src/services/windyCameraService.ts` consumes the same-origin `/api/cameras` endpoint, normalizes Windy Webcams API v3 records, and filters them through `src/services/metroManilaCameras.ts` against the local 17-LGU boundaries. `server/windyProxy.mjs` keeps the Windy key server-side, fetches webcam metadata for the current viewport, caches each bounded result for at most five minutes, and supports fresh per-webcam image URL requests. `CameraMarkerManager` updates visible map markers, renews the open popup image in place, and loads a camera-location weather summary from Open-Meteo on popup open. This pipeline is isolated from rainfall and flood-risk services.

## Testing seams

Structural interfaces (map, markers, layer adapter, data sources, geolocation) are injected in tests. This is why several source comments describe "MapLibre-compatible" structural shapes — the shapes are engine-agnostic and were preserved across the Mapbox migration; the runtime engine is Mapbox GL JS.
