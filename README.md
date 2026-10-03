# BahaRoute

Flood-aware route decision support for Metro Manila / NCR.

BahaRoute is a React + TypeScript + Vite single-page application built on Mapbox GL JS. It combines barangay-level current flood-risk estimates, historical flood susceptibility, community reports, confirmed closures, and flood-aware route comparison in one map-first experience.

> **Hackathon / prototype status.** BahaRoute is a decision-support prototype. Current rainfall is model-based, community reports are unverified, confirmed closures require an authoritative source, and Driver Mode is a simulation. BahaRoute never guarantees that a route is safe or passable.

## What BahaRoute does

BahaRoute helps users answer more than “How do I get there?”

It helps users compare route options together with flood context:

- current rainfall-driven flood-risk estimates
- historical flood susceptibility
- community flood reports
- confirmed closures
- higher-risk route segments
- route alternatives with ETA and distance
- a Driver Mode preview
- optional handoff to external navigation apps

The product is scoped to **Metro Manila / NCR**.

## Coverage

BahaRoute covers all 17 NCR LGUs:

1. Caloocan
2. Las Piñas
3. Makati
4. Malabon
5. Mandaluyong
6. Manila
7. Marikina
8. Muntinlupa
9. Navotas
10. Parañaque
11. Pasay
12. Pasig
13. Pateros
14. Quezon City
15. San Juan
16. Taguig
17. Valenzuela

The NCR barangay dataset contains **1,710 barangays**.

## Map experience

### NCR → City/LGU → Barangay drill-down

Historical Flood Risk supports three visual scopes:

- **NCR overview** — all NCR barangays are shown with historical susceptibility colors.
- **City/LGU focus** — the selected city boundary is emphasized while its barangays remain individually color-coded.
- **Barangay focus** — the selected barangay polygon is highlighted while its parent city remains visible as context.

City boundaries are kept separate from barangay risk polygons:

- city polygon = geographic focus/context
- barangay polygon = fine-grained historical flood-risk visualization

### Barangay identity and filtering

Historical city views support:

- barangay hover identification
- click-to-select behavior
- dropdown ↔ map synchronization
- selected-barangay emphasis
- zoom-aware barangay labels
- label collision handling
- active-risk filtering for **All / High / Moderate / Low / Unknown**

Risk-filter counts and map emphasis use the same filtering logic, so the map visually reflects the active result set instead of only changing the number shown in the panel.

Official barangay names from the dataset are preserved exactly. Numeric official names are not replaced with invented aliases.

### Responsive layout

BahaRoute is map-first across breakpoints:

- desktop: one primary left rail + map + right-side layer controls
- tablet: compact responsive layout
- mobile: one bottom-sheet surface at a time so the map remains visible

Historical Explore, Flood Insights, Route Compare, Map Layers, and map legends are coordinated so they do not stack over one another.

## Current Flood Risk

Current Flood Risk is a **near-real-time model-based estimate**. It is not an official sensor feed and is not the same thing as Historical Flood Susceptibility.

The internal risk states are:

- LOW
- ELEVATED
- HIGH
- LIKELY_FLOODING
- REPORTED_FLOODING
- CONFIRMED_CLOSURE
- UNKNOWN
- STALE

Important semantics:

- **Historical Flood Susceptibility ≠ Current Flood Risk**
- **UNKNOWN / STALE must never become LOW**
- community reports are unverified
- confirmed closures require authoritative confirmation
- BahaRoute never labels a route “safe”

## Historical Flood Risk

Historical susceptibility is based on Project NOAH / Phil-LiDAR reference data and is kept separate from current conditions.

The historical layer includes:

- NCR-wide barangay visualization
- city/LGU isolation
- barangay focus
- High / Moderate / Low / Unknown filtering
- city summary counts
- flood-exposed area summaries
- zoom-aware barangay labels
- clean dissolved city boundaries

Historical susceptibility indicates modeled or historical exposure only. It does not confirm current flooding.

## Rainfall architecture

BahaRoute uses **Open-Meteo** as a model-based rainfall source.

To avoid unnecessary API usage, BahaRoute does not query all 1,710 barangays individually.

Instead:

- a coarse NCR rainfall grid is sampled
- barangays reuse nearby grid-cell rainfall
- requests are batched
- one shared rainfall service owns polling
- in-flight requests are deduplicated
- fresh cached snapshots are reused
- failed refreshes preserve the last good snapshot
- stale data is marked STALE instead of being converted to LOW
- hidden-tab polling is reduced
- manual refreshes are throttled
- repeated failures use capped backoff

Route alternatives and Driver Mode reuse the same current environmental snapshot instead of triggering separate rainfall requests.

## Community Reports

Community Reports are dynamic, unverified observations.

The current architecture supports:

- runtime report records
- map markers
- timestamps
- relative freshness
- TTL / aging behavior
- aggregation by barangay
- route-context report counts

A community report does **not** automatically become a confirmed closure.

## Confirmed Closures

Confirmed Closures remain authority-only.

The code keeps an official-confirmation provider seam so a future MMDA, LGU, DPWH, or other authoritative feed can be integrated without rewriting the map UI.

Confirmed closures have stronger routing consequences than community reports.

## Route planning

The route flow is:

**Search → Compare → Start → Navigate**

Route comparison includes:

- ETA
- distance
- arrival estimate
- aggregate flood-risk level
- rainfall trend
- higher-risk segment count
- community-report count
- confirmed-closure count
- “Why this route?” explanation
- concise segment-risk explanation

BahaRoute samples route geometry in short segments and evaluates the route against current flood context.

Route recommendation balances travel time and flood exposure. It does not claim to find the “safest” route.

## Navigation

### BahaRoute Driver Mode

Driver Mode provides a simulated route-following experience with:

- next-maneuver guidance
- remaining distance
- remaining time
- ETA
- route-risk status
- follow camera
- reroute behavior for supported demo scenarios

### External navigation handoff

A selected route can also be opened in external navigation apps such as:

- Google Maps
- Waze
- Apple Maps

External navigation apps do not receive or apply BahaRoute’s flood-risk model; the handoff is only for navigation convenience.

## Location privacy

BahaRoute is privacy-first about device location:

- no automatic geolocation request on page load
- location is “not shared” by default
- explicit BahaRoute consent before browser geolocation
- manual search and map selection remain available without GPS
- precise location is not intentionally persisted as user profile data

## Kiro engineering environment

The repository includes a lightweight Kiro engineering environment to keep long-running coding sessions consistent.

```text
.kiro/
├── agents/
│   ├── planner.md
│   ├── implementer.md
│   └── reviewer.md
├── hooks/
│   ├── dangerous-command-guard.json
│   └── secret-leakage-guard.json
├── memory/
│   ├── current-state.md
│   ├── decisions-log.md
│   ├── known-issues.md
│   └── learnings.md
├── specs/
└── steering/
    ├── architecture-overview.md
    ├── engineering-rules.md
    ├── flood-data-rules.md
    └── product-constitution.md
```

The setup is intentionally lightweight:

- persistent project rules in steering
- planner / implementer / reviewer roles
- manual memory files to avoid context bloat
- dangerous-command and secret-leakage guards
- no large multi-agent framework
- no automatic memory growth on every edit

## Tech stack

- React 18
- TypeScript
- Vite
- Mapbox GL JS 3
- Open-Meteo
- Vitest
- React Testing Library
- fast-check
- ESLint
- Prettier
- Kiro specs / steering / agents

## Local setup

Prerequisites: Node.js and npm.

```bash
npm install
cp .env.example ..env.local
# add a real Mapbox token to ..env.local
npm run dev
```

Environment variable:

```env
VITE_MAPBOX_ACCESS_TOKEN=your_mapbox_access_token_here
```

`.env.local` is gitignored and must never be committed.

## Testing and quality checks

```bash
npm run typecheck
npm run test
npm run lint
npm run build
npm run format
```

Latest pre-push QA reported:

- Typecheck: PASS
- Tests: **712 passed / 73 files**
- Lint: **0 errors** (1 pre-existing Fast Refresh warning)
- Build: PASS
- Secrets check: PASS
- Unexpected files: NO

## Project structure

```text
.
├── .kiro/
│   ├── agents/
│   ├── hooks/
│   ├── memory/
│   ├── specs/
│   └── steering/
├── data-processing/
├── docs/
├── src/
│   ├── camera/
│   ├── components/
│   ├── data/
│   ├── layers/
│   ├── map/
│   ├── services/
│   ├── simulation/
│   ├── styles/
│   ├── test/
│   └── types/
├── package.json
├── vite.config.ts
└── README.md
```

## Limitations

- NCR-only operational coverage
- rainfall is model-based, not a physical sensor in every barangay
- third-party map/weather services can be unavailable or rate-limited
- historical susceptibility is not current flooding
- community reports are unverified
- official closures depend on authoritative data
- Driver Mode is still a simulation
- external navigation apps do not use BahaRoute flood intelligence
- production bundle currently emits a Mapbox-related chunk-size advisory

## Data provenance

- **Historical flood susceptibility:** Project NOAH / Phil-LiDAR reference data
- **Rainfall:** Open-Meteo model-based estimate
- **Map / routing:** Mapbox
- **NCR city and barangay boundaries:** local GeoJSON assets in the repository
- **Community reports / closure demo data:** prototype/runtime or fixture-backed data depending on the flow

## Disclaimer

BahaRoute provides informational flood-risk estimates and decision support. Conditions can change rapidly. Users should follow official advisories, road signs, barricades, and emergency instructions.

BahaRoute does not guarantee that any route is safe or passable.
