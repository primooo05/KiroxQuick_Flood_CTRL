#!/usr/bin/env python3
"""Regenerate src/data/geojson/ncrCityBoundaries.geojson (the Historical
drill-down city/LGU OUTER boundary) from the already-dissolved local city
boundary dataset.

WHY THIS EXISTS
---------------
The historical city-boundary layer (src/layers/historicalCityBoundary.ts) draws
a `line` layer for the selected city. It was reading an UN-DISSOLVED asset where
each LGU was stored as dozens/hundreds of un-merged barangay sub-polygons (e.g.
Quezon City = 41 polygons / 72 rings, City of Manila = 486). A `line` layer
strokes EVERY ring, so those interior barangay seams rendered as a purple
zig-zag / triangular mesh crossing the selected city.

The repo already ships a correctly DISSOLVED per-LGU outline in
`metroManilaCityBoundaries.geojson` (Quezon City = 1 Polygon / 1 ring; Caloocan
and Las Piñas are legitimate 2-part MultiPolygons). This script re-tags those
clean outlines with the ADM3 `cityPsgc` (the join key the historical layer and
hover use via `promoteId: 'cityPsgc'`) and the display `city` name, and writes
them out. No polygon union is performed here — we REUSE the existing dissolved
geometry; we never concatenate rings from separate barangay polygons.

Deterministic + offline. Run from the repo root:
    python3 data-processing/build_city_boundaries.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GEOJSON_DIR = ROOT / "src" / "data" / "geojson"
CLEAN_SRC = GEOJSON_DIR / "metroManilaCityBoundaries.geojson"
CITY_SUMMARY = ROOT / "src" / "data" / "historical" / "ncrCityHistoricalFloodSummary.json"
OUT = GEOJSON_DIR / "ncrCityBoundaries.geojson"

# city_norm (source key) -> ADM3 city PSGC. Mirrors the explicit tables in
# src/data/geojson/cityNameNormalization.ts + ncrCityContext.ts (kept in sync).
CITY_NORM_TO_PSGC: dict[str, str] = {
    "CALOOCAN": "PH1307501",
    "LAS PINAS": "PH1307601",
    "MAKATI": "PH1307602",
    "MALABON": "PH1307502",
    "MANDALUYONG": "PH1307401",
    "MANILA": "PH1303901",
    "MARIKINA": "PH1307402",
    "MUNTINLUPA": "PH1307603",
    "NAVOTAS": "PH1307503",
    "PARANAQUE": "PH1307604",
    "PASAY": "PH1307605",
    "PASIG": "PH1307403",
    "PATEROS": "PH1307606",
    "QUEZON": "PH1307404",
    "SAN JUAN": "PH1307405",
    "TAGUIG": "PH1307607",
    "VALENZUELA": "PH1307504",
}


def ring_count(geometry: dict) -> tuple[int, int]:
    t = geometry["type"]
    if t == "Polygon":
        return 1, len(geometry["coordinates"])
    if t == "MultiPolygon":
        return len(geometry["coordinates"]), sum(len(p) for p in geometry["coordinates"])
    raise ValueError(f"unexpected geometry type {t!r}")


def main() -> None:
    clean = json.loads(CLEAN_SRC.read_text(encoding="utf-8"))
    summary = json.loads(CITY_SUMMARY.read_text(encoding="utf-8"))
    name_by_psgc = {c["city_psgc"]: c["city_name"] for c in summary["cities"]}

    out_features = []
    seen_psgc: set[str] = set()
    total_polys = 0
    for feat in clean["features"]:
        props = feat.get("properties") or {}
        city_norm = props.get("city_norm")
        if not isinstance(city_norm, str) or not city_norm.strip():
            raise SystemExit(f"source feature missing city_norm: {props!r}")
        psgc = CITY_NORM_TO_PSGC.get(city_norm)
        if not psgc:
            raise SystemExit(f"unknown city_norm {city_norm!r} (update CITY_NORM_TO_PSGC)")
        if psgc in seen_psgc:
            raise SystemExit(f"duplicate cityPsgc {psgc} for {city_norm!r}")
        seen_psgc.add(psgc)
        city_name = name_by_psgc.get(psgc, city_norm.title())
        polys, _rings = ring_count(feat["geometry"])
        total_polys += polys
        out_features.append(
            {
                "type": "Feature",
                "id": psgc,  # so promoteId: 'cityPsgc' / feature id both resolve
                "properties": {"cityPsgc": psgc, "city": city_name},
                "geometry": feat["geometry"],
            }
        )

    if len(out_features) != 17:
        raise SystemExit(f"expected 17 LGUs, got {len(out_features)}")

    out = {"type": "FeatureCollection", "features": out_features}
    OUT.write_text(json.dumps(out), encoding="utf-8")
    print(f"[write] {OUT} ({len(out_features)} LGUs, {total_polys} total polygons)")


if __name__ == "__main__":
    main()
