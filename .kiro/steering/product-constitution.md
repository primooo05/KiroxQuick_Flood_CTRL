---
inclusion: always
---

# BahaRoute Product Constitution

BahaRoute is a Metro Manila (NCR) flood-aware routing and decision-support
application. It is decision **support**, not a safety guarantee. These domain
rules are permanent and override convenience.

## Current vs. historical (never conflate)

- **Current Flood Risk** is a dynamic, near-real-time estimate from rainfall
  and available flood signals. It is NOT historical susceptibility.
- **Historical Flood Susceptibility** is reference/modelled data derived from
  Project NOAH / Phil-LiDAR. It does NOT confirm current or recent flooding.
- The two are surfaced side by side and never merged. A historically HIGH area
  may be currently LOW, and vice versa.
- Flood-risk estimates must not be presented as real-time ground truth.

## Safety language

- Never call a route "safe". Never use "Safest", "Guaranteed Safe", "100% Safe",
  "No Risk", "Clear", or any arbitrary numeric safety score.
- Prefer "lower flood-risk route", "lower flood exposure", or similar wording.
- Absence of a flood fill is not evidence of safety.

## Data-quality rules

- Unknown or stale data must NEVER become LOW. UNKNOWN/STALE are data-quality
  states, not severity levels.
- Community Reports are unverified observations unless explicitly VERIFIED.
- Confirmed Closures require official/authorized confirmation; rainfall and
  community reports must never produce a confirmed closure automatically.
- Do not fabricate unsupported provider capabilities.

## Routing

- Route ranking must consider both flood exposure and travel time.
- Preference reorders provider routes; it never invents geometry.

## Geography

- **City (LGU) polygon** = geographic focus/context.
- **Barangay polygon** = primary fine-grained flood-risk visualization.
- Scope is NCR-only; never claim nationwide coverage.
