---
inclusion: fileMatch
fileMatchPattern: 'src/services/*|src/layers/*|src/data/**|src/simulation/*|src/types/risk.ts|src/types/flood.ts|src/components/insights/*|src/components/overlays/*|src/components/trip/*|src/components/driving/*'
---

# Flood & Data Semantics Rules

Loads when working on flood/risk/data/routing code. Preserve the EXISTING
implementation semantics — do not invent a new risk model. Source of truth:
`src/types/risk.ts`, `src/types/flood.ts`, and `docs/FLOOD_SEMANTICS.md`.

## Historical vs. current (separate pipelines)

- Historical susceptibility (`src/data/historical/`, `Low|Moderate|High|Unknown`)
  is modelled Project NOAH / Phil-LiDAR reference data. It never confirms current
  flooding and is supporting context only.
- Current risk (`CurrentRiskLevel` in `src/types/risk.ts`) is the near-real-time
  estimate. Keep the two separate in types, layers, popups, and copy.

## Current risk states (do not change the ladder)

`UNKNOWN | STALE | LOW | ELEVATED | HIGH | LIKELY_FLOODING | REPORTED_FLOODING
| CONFIRMED_NOT_PASSABLE`.

- `UNKNOWN` / `STALE` are DATA-QUALITY states (severity rank -1), never LOW.
- `REPORTED_FLOODING` is escalated by valid community reports, not rainfall alone.
- `CONFIRMED_NOT_PASSABLE` is set ONLY via official/admin confirmation
  (`OfficialStatus`). Rainfall and community reports must never produce it.
- Historical susceptibility is a MODIFIER only — on its own it never yields
  HIGH or above.

## Open-Meteo data freshness

- Rainfall is ESTIMATED / model-based, labeled via `RAINFALL_SOURCE_LABEL`,
  never presented as official PAGASA observation.
- Poll ~5 min; batch coordinates (coarse-grid sampling) to respect rate limits.

## UNKNOWN / STALE / failure handling

- On fetch error: retain the last successful cache, mark it stale, and surface
  "last updated X ago". Never fabricate rainfall or substitute demo data as real.
- Partial API failure: keep last-good data for unaffected areas; do not downgrade
  missing areas to LOW.
- No data ever loaded → `UNKNOWN` (data unavailable), never LOW.

## Report & closure semantics

- Community reports are `UNCONFIRMED` unless `VERIFIED`; show source + timestamp.
- Only RED/ORANGE active-flooding reports escalate to `REPORTED_FLOODING`.
- Confirmed closures require authorized confirmation.

## Flood states

`RED | ORANGE | YELLOW | GREEN | GRAY` — exactly five. `GRAY` = Unknown, never
rendered or described as safe/clear/passable. `GREEN` requires present, recent
passability data.
