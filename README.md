# BahaRoute

Flood-aware route decision support for Metro Manila / NCR.

BahaRoute is a React + TypeScript + Vite single-page app built on Mapbox GL JS. It frames the National Capital Region, overlays barangay-level current flood risk (estimated from live/model-based rainfall), historical susceptibility, community reports, and confirmed closures, and adds a flood-aware trip planner: search an origin and destination, compare route alternatives with their flood context, then start a driver-mode route-following preview — all without ever claiming a route is "safe."

> **Prototype / hackathon status.** BahaRoute is a demo prototype. Rainfall is model-based (Open-Meteo), demo hazards/reports/closures are fixture data, and the driver mode is a simulation. Nothing here should be relied on for real-world flood or evacuation decisions. Follow official advisories.

## Problem

Ordinary navigation mainly optimizes for reaching a destination quickly and treats flooding as an afterthought. During heavy rain, Metro Manila commuters need flood context — which areas are historically flood-prone, where rainfall is rising, which roads are reported flooded or officially closed — to make an informed choice. That context is normally scattered, unlabeled, or presented with misleading confidence. BahaRoute adds flood-related context to route decisions for the NCR specifically. It does **not** guarantee that any route is safe or passable; it surfaces what is known, marks what is unknown as unknown, and leaves the decision to the user.

## Coverage

**Current coverage: Metro Manila / NCR only.** BahaRoute is scoped to the 17 jurisdictions of the National Capital Region. Flood-risk coverage is NCR-only; the map may optionally show nearby geographic context for orientation, but thematic flood data remains NCR-only regardless of the map view.

The 17 NCR local government units (LGUs):

1. Caloocan  2. Las Piñas  3. Makati  4. Malabon  5. Mandaluyong  6. Manila
7. Marikina  8. Muntinlupa  9. Navotas  10. Parañaque  11. Pasay  12. Pasig
13. Pateros  14. Quezon City  15. San Juan  16. Taguig  17. Valenzuela

## Current map experience

Implemented map behavior:

- **NCR-focused framing.** The map opens framed on the Metro Manila extent (aspect-ratio-aware: `fitBounds` on narrow/portrait/mobile, a tuned center+zoom on wide desktop).
- **NCR City/LGU context.** Dedicated administrative boundaries and city-name labels for the 17 LGUs render as always-on base context (independent of thematic layers).
- **Map Context selector — "NCR only" vs "Show nearby areas."** NCR-only masks the surrounding provinces and suppresses external place/POI/transit labels; nearby mode reveals surrounding areas for orientation. Default is "Show nearby areas." This is presentation only — thematic flood data stays NCR-only in both modes.
- **Coverage badge** — a persistent "Metro Manila / NCR" badge communicates the operational scope.
- **360° rotation + 2D/3D view** via on-screen controls (compass/rotate, view-mode toggle) built on the Mapbox Standard 3D style.
- **On-demand layer drawer** with these flood-related layers, all **off by default** until the user opts in:
  - **Current Flood Risk** — barangay-level current risk (see below).
  - **Community Reports** — recent, unconfirmed community flood reports.
  - **Confirmed Closures** — officially confirmed not-passable areas.
  - **Historical Flood Risk** — modeled susceptibility, shown as reference/baseline context (not current flooding).

## Barangay coverage

The NCR dataset contains **1,710 barangays** (region PSGC `PH13`). Barangay polygons carry stable geographic identifiers (PSGC codes) where implemented, so risk state, reports, and closures resolve to a specific barangay rather than a loose coordinate.

## Rainfall architecture

BahaRoute uses **Open-Meteo** as its live, model-based rainfall source. It is model output, **not** a per-barangay physical sensor measurement.

To stay within rate limits and remain reliable, the implementation does **not** request rainfall separately for each of the 1,710 barangays. Instead:

- A **coarse NCR rainfall sampling grid** (~66 grid cells covering the region) is sampled per poll.
- Each barangay is mapped back to its containing grid cell, so barangay rainfall is an **estimate derived from spatial sampling / model data**.
- Requests are **batched**, and **partial failures are tolerated** — a cell that fails this round simply has no sample rather than failing the whole update.
- **Unavailable or stale values remain `UNKNOWN` / `STALE`.** Missing data is **never** silently converted to `LOW`.

## Flood-risk semantics

Barangay current-risk states (`src/types/risk.ts`), in increasing order of concern, plus two data-quality states:

- `LOW` · `ELEVATED` · `HIGH` · `LIKELY FLOODING` · `REPORTED FLOODING` · `CONFIRMED CLOSURE`
- `UNKNOWN` — current data has never loaded (shown as "unavailable"; never treated as LOW).
- `STALE` — previously loaded data is older than the freshness window.

Clarifications enforced across the model and UI:

- **Historical susceptibility is reference/baseline context** — it describes historical/modeled exposure, not that an area is currently flooded. It is kept distinct from current risk and never merged with it.
- **Community reports are evidence, not official confirmation** — they are marked unconfirmed and, on their own, escalate risk only to `REPORTED FLOODING`.
- **`CONFIRMED CLOSURE` requires authoritative/official confirmation** in the current model. Rainfall and community reports never produce it automatically.
- No route or area is ever labeled "safe," "clear," or "no risk," and no arbitrary numeric safety score is assigned.

## Route planning / navigation

The implemented flow is **Search → Compare → Start → Navigate**:

- **Origin selection** via three normalized inputs — current device location (after explicit consent, see below), NCR place search, or "Select on map."
- **Destination selection** via place search or "Select on map."
- **NCR validation** — origins/destinations outside the NCR are rejected with an "outside coverage" message rather than silently accepted.
- **Automatic route preview** — once both points are set, route alternatives are calculated automatically (no manual "find routes" click). Route lines are drawn on the map: the selected/recommended route emphasized, alternatives faded, with origin/destination markers, framed at a moderate planning pitch.
- **Route comparison cards** — each route shows ETA, distance, aggregate current flood-risk summary, rainfall trend, higher-risk segment count, community-report count, and confirmed-closure count, plus a concise "Why this route?" explanation. The recommendation balances travel time against flood exposure (not merely the fastest route).
- **Start → Driver Mode** — a single Start button is the only entry into a driver-mode preview: a route-following simulation with a next-maneuver banner, a compact route-risk status banner, remaining distance/time/ETA, and a follow camera. A controlled demo hazard/closure scenario can offer a flood-avoiding reroute.

Route geometry is real road geometry: the flagship PITX → SM Mall of Asia demo pair ships a bundled offline route (with a bundled flood-avoiding alternative); other NCR pairs are routed via the Mapbox Directions API, so the simulated vehicle follows roads rather than a straight line. This is a demo simulation, not production-grade turn-by-turn navigation, and it does not perform automatic live rerouting beyond the scripted demo scenario.

## Location privacy

BahaRoute is privacy-first about device location:

- It does **not** request device location automatically on page load.
- The user's location is **unknown / "not shared" by default**.
- Location is requested **only after an explicit user action** (pressing "Use current location" or the location arrow) and an in-app BahaRoute consent dialog; the browser permission prompt is reached only after the user chooses "Allow location."
- Users can **search or select an origin manually** without ever sharing GPS location.
- A granted permission is reused for the session (no repeated prompts); precise coordinates are kept as runtime state only — not persisted or logged.

## Live-data degradation

If Open-Meteo is unavailable or rate-limited, the app keeps working:

- Route search, origin/destination preview, and route geometry continue to function.
- The last successful rainfall snapshot is retained and marked **stale** rather than discarded.
- Current risk becomes `UNKNOWN` / `STALE`, and route cards show "current flood information unavailable" — never a fabricated `LOW`.
- Historical susceptibility remains available as reference data.

## Tech stack

- **React 18** + **TypeScript** (Vite build).
- **Vite 5** dev server / bundler.
- **Mapbox GL JS 3** (direct `mapbox-gl`, not a React wrapper) on the Mapbox **Standard** style (3D).
- Rainfall data from **Open-Meteo** (model-based; no key required).
- Testing: **Vitest** + **React Testing Library** + **fast-check** (property-based tests); **ESLint** + **Prettier**.

## Local setup

Prerequisites: Node.js and npm.

```bash
npm install
cp .env.example .env.local        # then set a real Mapbox token in .env.local
npm run dev                       # Vite dev server on http://localhost:5173
```

Environment configuration — the app reads a Mapbox access token at runtime via `import.meta.env.VITE_MAPBOX_ACCESS_TOKEN` (applied to the map at construction, never hardcoded):

```
VITE_MAPBOX_ACCESS_TOKEN=your_token_here
```

`.env.local` is gitignored and must never be committed (`.env`, `.env.local`, and `.env.*.local` are all ignored). Without a token the app shell still renders with a config-incomplete message and no map tiles load.

## Testing & quality checks

Actual scripts from `package.json`:

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # eslint .
npm run test          # vitest --run  (unit + property + component tests)
npm run build         # tsc project checks + vite build
npm run format        # prettier --write .
```

## Project structure

```
.
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json / tsconfig.node.json
├── .env.example                 # template; copy to .env.local (gitignored)
├── .kiro/specs/                 # Kiro spec documents (requirements/design/tasks)
├── docs/                        # extended documentation
└── src/
    ├── App.tsx / main.tsx
    ├── camera/                  # overviewFraming (pure framing logic)
    ├── components/              # MapView, controls/, driving/, markers/, overlays/, trip/
    ├── data/
    │   ├── fixtures/            # demo flood/route/report/closure/reroute data
    │   └── geojson/             # NCR city + barangay boundaries, normalization
    ├── layers/                  # LayerRegistry, barangay risk, susceptibility,
    │                            #   city context, reports, risk labels, visual mapping
    ├── map/                     # MapManager, metroManilaExtent, ncrOutsideMask, basemap/
    ├── services/                # env, geolocation, rainfall grid + service,
    │                            #   barangay risk model/controller, directions,
    │                            #   ncrPlaces, routePlanning, reportResolution
    ├── simulation/              # DriveSimulator, navigation, reroute, route geometry
    ├── styles/                  # layout.css
    ├── types/                   # flood, risk, route, report, layer, config
    └── test/                    # test setup
```

## Limitations

- **NCR-only operational scope** — no nationwide coverage.
- **Model-based / estimated rainfall** (Open-Meteo, coarse grid) rather than physical sensors in every barangay.
- **Dependency on third-party availability** — weather (Open-Meteo) and map/directions (Mapbox) APIs.
- **Historical susceptibility is not current flooding** — it is reference/baseline context only.
- **Community reports may be unverified**; only official confirmation yields a confirmed closure.
- **Demo/hackathon functionality** — hazards, reports, closures, and the driver-mode route-following are demo/fixture/simulated and do not represent production-grade navigation or live rerouting.
- The production bundle emits a chunk-size advisory driven by the Mapbox GL JS vendor chunk.
- Mapbox GL JS is proprietary and subject to Mapbox pricing/billing and terms.

## Disclaimer

BahaRoute provides informational flood-risk estimates and decision support. Conditions may change rapidly. Users should follow official advisories, road signs, barricades, and emergency instructions. BahaRoute does not guarantee that a route is safe or passable.

## Documentation

Extended docs live in `docs/` (`ARCHITECTURE.md`, `DATA_MODEL.md`, `FLOOD_SEMANTICS.md`, `SETUP.md`, `PROJECT_STATUS.md`). Kiro spec documents live under `.kiro/specs/`.

## Data provenance & attribution

- **NCR city boundaries** and **barangay boundaries** are stored locally under `src/data/geojson/`. Administrative boundaries only — not flood-risk geometry.
- **Rainfall:** Open-Meteo (model-based forecast/estimate; not official PAGASA observations).
- **Demo hazards, community reports, confirmed closures, routes, evacuation centers:** fixture data under `src/data/fixtures/`, clearly labeled non-authoritative.
- **Mapbox GL JS** and Mapbox styles/tiles are proprietary and subject to Mapbox's terms and pricing; a valid access token is required.
- No open-source license is currently declared; all rights reserved by the project owner unless a `LICENSE` file is added.
- Built with React, TypeScript, Vite, Mapbox GL JS, Vitest, and fast-check.
