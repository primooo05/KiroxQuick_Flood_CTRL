---
inclusion: manual
---

# Current State

Compact snapshot of where BahaRoute is right now. Keep it short — overwrite
stale entries instead of appending history.

## Current architecture state

- React + TS + Vite + Mapbox GL JS. Current + historical flood-risk pipelines
  are separate and working. Verified gate (per docs): typecheck, lint, test, build.

## Current active feature work

- _none recorded_

## Current known limitations

- No runtime Directions backend for the MVP; flagship demo pair (PITX → MOA)
  uses bundled real route + flood-avoiding reroute. Other NCR pairs get a single
  straight-line candidate.
- App state machine (Overview/Search/RoutePreview/Navigation) is planned, not built.

## Recent major changes

- _none recorded_

## Next likely work

- Navigation-experience spec Milestones B–L.
