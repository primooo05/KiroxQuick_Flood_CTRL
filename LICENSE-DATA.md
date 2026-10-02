# Data Licenses & Attribution

BahaRoute ships and derives from third-party open datasets. Their licenses and
required attribution are recorded here.

## Historical flood hazard — Project NOAH / Phil-LiDAR

- **Source:** [bettergovph / project-noah-hazard-maps](https://huggingface.co/datasets/bettergovph/project-noah-hazard-maps) (Hugging Face)
- **Upstream:** DOST Project NOAH / UP Phil-LiDAR 1 program (~10 m LiDAR-derived flood hazard, 2014–2017 vintage)
- **License:** **Open Database License (ODbL)**
- **Attribution (required):** *"Flood hazard data © Project NOAH and contributors, via the bettergovph archive (ODbL)."*
- **Use in BahaRoute:** downloaded offline, spatially intersected with barangay boundaries, and transformed into derived per-barangay susceptibility metrics (`src/data/historical/`). The derived database is made available under ODbL-compatible terms, as ODbL requires for derivative databases.

ODbL summary of obligations honored here:
- Attribution to Project NOAH and its contributors — shown in-app (historical panel provenance line + map legend) and in this file.
- Share-Alike — the derived barangay dataset is redistributable under ODbL-compatible terms.

## Barangay administrative boundaries

- **Source:** bendlikeabamboo / barangay-boundaries-repository (enriches NAMRIA boundaries with PSA PSGC codes), filtered to the 1,710 NCR barangays.
- **Upstream:** © Philippine Statistics Authority (PSGC) and NAMRIA.
- **Use:** administrative geometry only; carries no flood meaning on its own.

## Live rainfall (current risk — separate pipeline)

- **Source:** [Open-Meteo](https://open-meteo.com/) forecast API — estimated / model-based, **not** official PAGASA observations. Labeled as such throughout the UI.

## Notes & limitations

- The Phil-LiDAR terrain vintage (2014–2017) predates newer drainage
  infrastructure and urban development; modeled hazard may over- or
  under-state present-day conditions in changed areas.
- Barangays with no mapped hazard coverage are classified **Unknown**, never
  `Low`.
- Historical susceptibility is **not** a claim about current flooding; the two
  are surfaced as independent layers.
