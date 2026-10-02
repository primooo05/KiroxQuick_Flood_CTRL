---
inclusion: manual
---

# Decisions Log

Record only architectural / product decisions. Do not log trivial edits.

Format:

```
## <short title>
- Date:
- Decision:
- Context:
- Reason:
- Affected areas:
```

---

## Example (delete when real entries exist)
- Date: 2026-01-01
- Decision: Keep current and historical flood risk as separate pipelines/types.
- Context: Conflating them would misrepresent modelled data as live conditions.
- Reason: Product-constitution requires the two never be merged.
- Affected areas: src/types/risk.ts, src/data/historical/, flood layers/popups.
