---
inclusion: manual
---

# Known Issues

Track unresolved bugs, limitations, technical debt, and provider limitations.
Remove resolved issues — this is not a permanent history.

Format:

```
## <short title>
- Type: bug | limitation | tech-debt | provider
- Impact:
- Notes / workaround:
```

---

## No runtime Directions backend (MVP)
- Type: limitation
- Impact: Only the PITX → MOA flagship pair has real routes + reroute; other NCR
  pairs return a single straight-line candidate.
- Notes / workaround: Intentional for the hackathon MVP (see routePlanning.ts).

## Mapbox vendor chunk-size advisory on build
- Type: tech-debt
- Impact: `vite build` emits a chunk-size warning for the Mapbox vendor bundle.
- Notes / workaround: Advisory only; build passes.
