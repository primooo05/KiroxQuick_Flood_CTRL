# Historical Flood Risk (NCR)

BahaRoute ships a **derived, per-barangay historical flood-susceptibility**
dataset for all 1,710 NCR barangays and all 17 LGUs, alongside a distinct
**Historical Flood Risk** map layer and filter panel.

Historical susceptibility is **separate** from current flood risk. See
["Current vs historical"](#current-vs-historical) below and
`docs/FLOOD_SEMANTICS.md`.

## Source

- **Flood hazard:** [bettergovph / project-noah-hazard-maps](https://huggingface.co/datasets/bettergovph/project-noah-hazard-maps)
  (Hugging Face), `Flood/{5yr,25yr,100yr}/Metro Manila.zip`. ESRI Shapefile,
  attribute `Var ∈ {1,2,3}` = depth class Low (0–0.5 m) / Medium (0.5–1.5 m) /
  High (>1.5 m). Derived from the UP Phil-LiDAR 1 program (~10 m LiDAR DEM,
  2014–2017). **ODbL** licensed.
- **Barangay boundaries:** the existing app asset
  `src/data/geojson/ncrBarangays.geojson` (NAMRIA + PSA PSGC, 1,710 NCR
  barangays). The flood metrics join to app barangay features by stable PSGC.
- **Backup / validation option (not shipped):** JRC High-Resolution Flood Model
  (~90 m) can be used as an independent cross-check.

## Processing

The offline pipeline (`data-processing/build_historical_flood_risk.py`,
Python + GeoPandas + rasterio + rasterstats):

1. Reproject barangays and hazard polygons to EPSG:32651 (UTM 51N, metres).
2. Explode the (large, invalid) hazard MultiPolygons into parts.
3. Rasterize hazard parts to a **10 m** categorical grid (High wins overlaps),
   matching the source's own resolution.
4. Run categorical zonal statistics per barangay → per-class exposed area.
5. Compute percentage metrics, derived class, and per-city aggregates.
6. Export GeoJSON + CSV + city summary JSON + a compact runtime JSON.

Full method, run instructions, and validation table:
`data-processing/README.md`.

## Return periods

The pipeline retains **5-year, 25-year, and 100-year** metrics per barangay in
the GeoJSON/CSV outputs (`return_periods`). The shipped runtime asset defaults
to the **100-year** return period for the map display; the others are preserved
in the processing outputs for analysis.

## Derived classification (documented rule)

Original source depth classes (Low/Medium/High) are preserved separately. The
BahaRoute historical class is derived from the area-percentage metrics:

| Class | Rule |
| --- | --- |
| **High** | `pct_high > 25` or `pct_high + pct_medium > 50` |
| **Moderate** | `pct_medium > 25` or `total_exposed > 50` |
| **Low** | some exposure below the Moderate thresholds |
| **Unknown** | **no** mapped hazard coverage — never silently `Low` |

The full Low/Medium/High breakdown plus dominant and max hazard are kept so
max-only classification cannot exaggerate risk. These thresholds are a
**documented derived rule**, calibrated against known flood-prone areas — not
hidden truth, and never manually overridden to force a result.

## Runtime assets

- `src/data/historical/ncrBarangayHistoricalFloodRisk.json` — compact,
  PSGC-keyed metrics (no geometry; ~640 KB). Painted onto the existing barangay
  geometry via Mapbox feature-state.
- `src/data/historical/ncrCityHistoricalFloodSummary.json` — 17 LGU aggregates.
- Typed loader: `src/data/historical/ncrHistoricalFloodRisk.ts`.

The frontend makes **no** API call for historical data — it loads these static
assets.

## Distribution of results (100-year default)

- Barangays: **1,710** · Cities/LGUs: **17**
- High **708** · Moderate **379** · Low **606** · Unknown **17**
- Hazard coverage: 5-yr 1,651 · 25-yr 1,680 · 100-yr 1,693 barangays

## UI

The **Historical Flood Risk** layer (toggled in the layer drawer) paints
barangay polygons in a distinct **indigo/violet** ramp (current risk uses a
green→red ramp), and opens a panel with:

- **View by:** NCR · City / LGU · Barangay
- **City** and **Barangay** selectors
- **Risk** filter: All / Low / Moderate / High / Unknown
- **Barangay detail:** susceptibility class, Low/Medium/High exposure %, total
  exposed area, highest mapped hazard, return period, source, source year,
  confidence, and the "historical, not current flooding" disclaimer.
- **City summary:** barangay count, Low/Moderate/High/Unknown counts, exposed
  area, dominant class.

## Current vs historical

A barangay can legitimately be, at the same time:

- Historical susceptibility **High** + current risk **Low**, or
- Historical susceptibility **High** + current risk **Likely Flooding**.

The two are **independent layers** with independent state, colors, and feature-
state keys (`histRisk` vs `risk`). BahaRoute never forces current risk to High
because historical susceptibility is High. Historical susceptibility is
context/input, not proof of current flooding.

## Known limitations

- Phil-LiDAR terrain vintage (2014–2017) predates newer drainage infrastructure
  and urban development; modeled hazard may over- or under-state present
  conditions in changed areas.
- The 10 m rasterization quantizes areas to the source's own resolution.
- Depth thresholds (0.5 m / 1.5 m) may not capture road-level nuance where even
  shallow standing water impedes travel.
- Barangays outside mapped flood plains are `Unknown`, not flood-free.

## Attribution / license

Flood hazard © Project NOAH and contributors, via the bettergovph archive
(**ODbL**); boundaries © PSA (PSGC) + NAMRIA. See `LICENSE-DATA.md`.
