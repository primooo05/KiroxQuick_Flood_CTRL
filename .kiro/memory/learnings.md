---
inclusion: manual
---

# Learnings

Record only reusable discoveries — lessons that will save time next time. Not a
task log. Prune entries that stop being relevant.

Format:

```
## <short title>
- Context:
- Problem:
- Root cause:
- Fix:
- Reuse when:
```

Worth storing (examples): source-ready race conditions, provider limitations,
map layer ordering issues, route geometry mistakes, Open-Meteo quota/rate-limit
behavior.

---

## Example (delete when real entries exist)
- Context: Full NCR rainfall refresh via Open-Meteo.
- Problem: Persistent "Live rainfall unavailable".
- Root cause: Oversized request URLs (HTTP 414) and hourly rate limit (HTTP 429).
- Fix: Coarse-grid sampling + batch size 50 + throttle/backoff (rainfallService.ts).
- Reuse when: Touching rainfall batching or adding new sampled coordinates.
