#!/usr/bin/env python3
"""Derive per-barangay historical flood-risk metrics for Metro Manila (NCR).

PIPELINE (offline, run once; outputs are committed as compact static assets):

    NCR barangay boundaries (app GeoJSON, PSA/NAMRIA + PSGC)
        + Project NOAH / Phil-LiDAR flood-hazard polygons (per return period)
        -> reproject both to a common projected CRS (EPSG:32651, UTM 51N)
        -> spatial intersection (barangay x hazard class)
        -> area per hazard class per barangay
        -> per-barangay percentage metrics + derived classification
        -> per-city (LGU) aggregation
        -> export GeoJSON + CSV + city summary JSON

DATA PROVENANCE
    Flood hazard : bettergovph/project-noah-hazard-maps (Hugging Face),
                   ESRI Shapefile, field `Var` in {1,2,3} = Low/Medium/High
                   depth class, per 5yr/25yr/100yr rainfall return period.
                   Derived from the Phil-LiDAR 1 program (~10 m LiDAR DEM,
                   2014-2017 acquisitions). Licensed ODbL (attribution
                   required; see README + LICENSE-DATA.md).
    Boundaries   : bendlikeabamboo/barangay-boundaries-repository (NAMRIA +
                   PSA PSGC), filtered to NCR (1,710 barangays), reused from
                   the app asset src/data/geojson/ncrBarangays.geojson.

HONESTY RULES (see the BahaRoute prompt, items 19-30):
    * Values are TRANSPARENTLY DERIVED from the source, never fabricated.
    * A barangay with NO valid hazard coverage is `Unknown`, never `Low`.
    * The full Low/Medium/High percentage breakdown is preserved (max-only
      classification exaggerates risk), plus dominant + max hazard.
    * All return periods (5/25/100yr) are retained per barangay; the default
      map return period is documented, not hidden.
    * Original source hazard classes are preserved separately from the derived
      BahaRoute class.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from rasterio import features
from rasterstats import zonal_stats
from shapely.validation import make_valid

# --- Paths ------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent
RAW_NOAH = ROOT / "raw" / "noah"
BARANGAYS_GEOJSON = REPO_ROOT / "src" / "data" / "geojson" / "ncrBarangays.geojson"
OUT_DIR = ROOT / "out"

# --- Constants --------------------------------------------------------------
# UTM Zone 51N — appropriate projected CRS for Metro Manila, metres.
PROJECTED_CRS = "EPSG:32651"
REGION_CODE = "13"  # NCR
DEFAULT_RETURN_PERIOD = "100yr"  # map default display; others retained too

# NOAH `Var` code -> source hazard class label + depth range (Phil-LiDAR).
VAR_TO_HAZARD = {1: "Low", 2: "Medium", 3: "High"}
HAZARD_DEPTH_RANGE = {
    "Low": "0-0.5 m",
    "Medium": "0.5-1.5 m",
    "High": ">1.5 m",
}

RETURN_PERIODS = {
    "5yr": RAW_NOAH / "MetroManila_5yr" / "MetroManila_Flood_5year.shp",
    "25yr": RAW_NOAH / "MetroManila_25yr" / "MetroManila_Flood_25year.shp",
    "100yr": RAW_NOAH / "MetroManila_100yr" / "MetroManila_Flood_100year.shp",
}

SOURCE_LABEL = "Project NOAH / Phil-LiDAR (bettergovph HF archive)"
SOURCE_YEAR = 2017  # Phil-LiDAR 1 acquisition vintage (2014-2017)
LICENSE = "ODbL"

# Rasterization resolution (metres). The source flood hazard is ~10 m LiDAR-
# derived; 10 m keeps area estimates faithful while making the barangay x
# hazard intersection a fast zonal-statistics pass instead of an all-pairs
# vector overlay on multi-million-vertex polygons.
RASTER_RES_M = 10.0
HAZARD_RANK = {"High": 3, "Medium": 2, "Low": 1}


# --- Derived classification (DOCUMENTED rule, not hidden truth) -------------
def classify(pct_low: float, pct_medium: float, pct_high: float, has_coverage: bool) -> str:
    """Derive the BahaRoute historical risk class from area-percentage metrics.

    Rule (calibrated against known NCR flood-prone areas; documented in README):
        High     : pct_high > 25  OR  (pct_high + pct_medium) > 50
        Moderate : pct_medium > 25 OR (pct_low+pct_medium+pct_high) > 50
        Low      : some hazard exposure below the Moderate thresholds
        Unknown  : NO valid hazard coverage (never silently 'Low')
    """
    if not has_coverage:
        return "Unknown"
    exposed = pct_low + pct_medium + pct_high
    if pct_high > 25 or (pct_high + pct_medium) > 50:
        return "High"
    if pct_medium > 25 or exposed > 50:
        return "Moderate"
    if exposed > 0:
        return "Low"
    return "Unknown"


def _clean(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Repair invalid geometries so overlay does not error on self-intersections."""
    gdf = gdf.copy()
    gdf["geometry"] = gdf.geometry.apply(lambda g: make_valid(g) if g and not g.is_valid else g)
    return gdf[~gdf.geometry.is_empty & gdf.geometry.notna()]


def load_barangays() -> gpd.GeoDataFrame:
    print(f"[load] barangays <- {BARANGAYS_GEOJSON}")
    gdf = gpd.read_file(BARANGAYS_GEOJSON)
    # Normalise property names from the app asset.
    gdf = gdf.rename(
        columns={
            "psgc": "barangay_psgc",
            "brgy": "barangay_name",
            "city": "city_name",
            "cityPsgc": "city_psgc",
        }
    )
    gdf = gdf[["barangay_psgc", "barangay_name", "city_name", "city_psgc", "geometry"]]
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    gdf = gdf.to_crs(PROJECTED_CRS)
    gdf = _clean(gdf)
    gdf["barangay_area_m2"] = gdf.geometry.area
    print(f"[load] {len(gdf)} NCR barangays")
    return gdf


def load_hazard_parts(shp: Path) -> gpd.GeoDataFrame:
    """Load hazard polygons EXPLODED into small parts, tagged with class rank.

    The source is 3 giant, invalid MultiPolygons (up to ~1.3M vertices). We
    EXPLODE first (instant, no repair needed) into ~120k small parts, then
    reproject. Validity repair is deferred to rasterization, which is tolerant.
    """
    gdf = gpd.read_file(shp)
    gdf = gdf[gdf["Var"].isin(VAR_TO_HAZARD.keys())].copy()
    gdf["hazard"] = gdf["Var"].astype(int).map(VAR_TO_HAZARD)
    gdf["rank"] = gdf["hazard"].map(HAZARD_RANK)
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    parts = gdf[["hazard", "rank", "geometry"]].explode(index_parts=False).reset_index(drop=True)
    parts = parts.to_crs(PROJECTED_CRS)
    parts = parts[~parts.geometry.is_empty & parts.geometry.notna()]
    return parts


def _rasterize_hazard(parts: gpd.GeoDataFrame, bounds, res: float):
    """Burn hazard parts to a categorical raster (1/2/3), HIGH wins overlaps.

    Returns (array, transform). We sort ascending by rank so higher hazard is
    burned last and therefore overwrites lower where classes overlap — the
    conservative, standard convention for depth-class hazard rasters.
    """
    minx, miny, maxx, maxy = bounds
    width = int(np.ceil((maxx - minx) / res))
    height = int(np.ceil((maxy - miny) / res))
    transform = rasterio.transform.from_origin(minx, maxy, res, res)
    shapes = [
        (geom, int(rank))
        for geom, rank in zip(parts.geometry.values, parts["rank"].values)
    ]
    # Sort so highest rank burns last (wins overlaps).
    shapes.sort(key=lambda s: s[1])
    arr = features.rasterize(
        shapes,
        out_shape=(height, width),
        transform=transform,
        fill=0,
        dtype="uint8",
        all_touched=False,
    )
    return arr, transform


def compute_return_period(
    barangays: gpd.GeoDataFrame, parts: gpd.GeoDataFrame
) -> pd.DataFrame:
    """Per-barangay area (m^2) by hazard class via rasterized zonal statistics.

    Rasterize the hazard parts to a 10 m categorical grid (matching the source
    resolution), then run categorical zonal stats per barangay. Pixel counts x
    pixel area give per-class exposed area — a fast, robust substitute for a
    vector overlay on multi-million-vertex polygons. The ~10 m quantisation is
    faithful to the source's own resolution (documented in README).
    """
    total_bounds = barangays.total_bounds
    arr, transform = _rasterize_hazard(parts, total_bounds, RASTER_RES_M)
    px_area = RASTER_RES_M * RASTER_RES_M

    stats = zonal_stats(
        barangays.geometry,
        arr,
        affine=transform,
        categorical=True,
        category_map={0: "none", 1: "Low", 2: "Medium", 3: "High"},
        nodata=0,
        all_touched=False,
    )

    rows = []
    for psgc, s in zip(barangays["barangay_psgc"].values, stats):
        a_low = float(s.get("Low", 0)) * px_area
        a_med = float(s.get("Medium", 0)) * px_area
        a_high = float(s.get("High", 0)) * px_area
        if a_low + a_med + a_high <= 0:
            continue
        rows.append(
            {
                "barangay_psgc": psgc,
                "area_low_m2": a_low,
                "area_medium_m2": a_med,
                "area_high_m2": a_high,
            }
        )
    print(f"[overlay]   {len(rows)} barangays with hazard coverage", flush=True)
    if not rows:
        return pd.DataFrame(
            columns=["barangay_psgc", "area_low_m2", "area_medium_m2", "area_high_m2"]
        )
    return pd.DataFrame.from_records(rows)


def build() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    barangays = load_barangays()

    # Per-return-period metrics keyed by PSGC.
    per_rp: dict[str, pd.DataFrame] = {}
    for rp, shp in RETURN_PERIODS.items():
        if not shp.exists():
            raise FileNotFoundError(f"Missing NOAH shapefile for {rp}: {shp}")
        print(f"[overlay] {rp} <- {shp.name}", flush=True)
        parts = load_hazard_parts(shp)
        per_rp[rp] = compute_return_period(barangays, parts)

    # Assemble the per-barangay record, defaulting to the DEFAULT return period
    # for the top-level metrics but retaining every return period.
    records = []
    base = barangays[
        ["barangay_psgc", "barangay_name", "city_name", "city_psgc", "barangay_area_m2"]
    ].copy()

    rp_by_psgc: dict[str, dict[str, pd.Series]] = {}
    for rp, df in per_rp.items():
        indexed = df.set_index("barangay_psgc")
        for psgc, row in indexed.iterrows():
            rp_by_psgc.setdefault(psgc, {})[rp] = row

    for _, b in base.iterrows():
        psgc = b["barangay_psgc"]
        area = float(b["barangay_area_m2"]) or 1.0
        rp_metrics = {}
        for rp in RETURN_PERIODS:
            row = rp_by_psgc.get(psgc, {}).get(rp)
            a_low = float(row["area_low_m2"]) if row is not None else 0.0
            a_med = float(row["area_medium_m2"]) if row is not None else 0.0
            a_high = float(row["area_high_m2"]) if row is not None else 0.0
            exposed = a_low + a_med + a_high
            pct_low = round(100.0 * a_low / area, 2)
            pct_medium = round(100.0 * a_med / area, 2)
            pct_high = round(100.0 * a_high / area, 2)
            pct_no = round(max(0.0, 100.0 - pct_low - pct_medium - pct_high), 2)
            has_cov = exposed > 0
            # dominant = largest exposed class; max = highest present class.
            areas = {"Low": a_low, "Medium": a_med, "High": a_high}
            dominant = max(areas, key=areas.get) if has_cov else "None"
            if a_high > 0:
                max_hazard = "High"
            elif a_med > 0:
                max_hazard = "Medium"
            elif a_low > 0:
                max_hazard = "Low"
            else:
                max_hazard = "None"
            rp_metrics[rp] = {
                "pct_low": pct_low,
                "pct_medium": pct_medium,
                "pct_high": pct_high,
                "pct_no_hazard": pct_no,
                "exposed_area_km2": round(exposed / 1e6, 4),
                "dominant_hazard": dominant,
                "max_hazard": max_hazard,
                "historical_risk_class": classify(pct_low, pct_medium, pct_high, has_cov),
            }

        default = rp_metrics[DEFAULT_RETURN_PERIOD]
        any_coverage = any(m["exposed_area_km2"] > 0 for m in rp_metrics.values())
        confidence = "Medium"  # ~10 m modeled hazard, decade-old LiDAR vintage
        if not any_coverage:
            confidence = "Low"
        records.append(
            {
                "barangay_name": b["barangay_name"],
                "barangay_psgc": psgc,
                "city_name": b["city_name"],
                "city_psgc": b["city_psgc"],
                "region_code": REGION_CODE,
                "source_hazard_low": HAZARD_DEPTH_RANGE["Low"],
                "source_hazard_medium": HAZARD_DEPTH_RANGE["Medium"],
                "source_hazard_high": HAZARD_DEPTH_RANGE["High"],
                "pct_low": default["pct_low"],
                "pct_medium": default["pct_medium"],
                "pct_high": default["pct_high"],
                "pct_no_hazard": default["pct_no_hazard"],
                "exposed_area_km2": default["exposed_area_km2"],
                "dominant_hazard": default["dominant_hazard"],
                "max_hazard": default["max_hazard"],
                "historical_risk_class": default["historical_risk_class"],
                "return_period": DEFAULT_RETURN_PERIOD,
                "return_periods": rp_metrics,
                "source": SOURCE_LABEL,
                "source_year": SOURCE_YEAR,
                "confidence": confidence,
                "derivation": (
                    "Spatial intersection of NCR barangay boundaries with Project "
                    "NOAH/Phil-LiDAR flood-hazard polygons in EPSG:32651; area per "
                    "hazard class / barangay area; classified by documented rule."
                ),
                "notes": (
                    "Historical/modeled susceptibility, NOT current flooding. "
                    "Phil-LiDAR terrain vintage 2014-2017."
                    if any_coverage
                    else "No mapped flood-hazard coverage in source; class Unknown."
                ),
            }
        )

    df = pd.DataFrame.from_records(records)
    _export(df, barangays)


def _export(df: pd.DataFrame, barangays: gpd.GeoDataFrame) -> None:
    # --- CSV (flat; return_periods flattened) -------------------------------
    flat = df.drop(columns=["return_periods"]).copy()
    csv_path = OUT_DIR / "ncr_barangay_historical_flood_risk.csv"
    flat.to_csv(csv_path, index=False)
    print(f"[write] {csv_path} ({len(flat)} rows)")

    # --- GeoJSON (geometry in WGS84; compact) -------------------------------
    geo = barangays[["barangay_psgc", "geometry"]].to_crs("EPSG:4326").merge(
        df, on="barangay_psgc", how="left"
    )
    geo = gpd.GeoDataFrame(geo, geometry="geometry", crs="EPSG:4326")
    # Round coordinates to ~5 decimals to keep the runtime asset small.
    geo["geometry"] = geo.geometry.set_precision(1e-5)
    gj_path = OUT_DIR / "ncr_barangay_historical_flood_risk.geojson"
    geo.to_file(gj_path, driver="GeoJSON")
    print(f"[write] {gj_path}")

    # --- Compact runtime JSON (PSGC-keyed, NO geometry) --------------------
    # The frontend already ships barangay geometry (ncrBarangays.geojson); the
    # runtime only needs the metrics keyed by PSGC to paint + populate panels.
    # This keeps the shipped asset small (no geometry duplication).
    compact = {
        "region_code": REGION_CODE,
        "source": SOURCE_LABEL,
        "source_year": SOURCE_YEAR,
        "license": LICENSE,
        "return_period": DEFAULT_RETURN_PERIOD,
        "return_periods_available": list(RETURN_PERIODS.keys()),
        "classification_rule": (
            "High: pct_high>25 or (pct_high+pct_medium)>50; "
            "Moderate: pct_medium>25 or total_exposed>50; "
            "Low: any exposure below Moderate; Unknown: no coverage"
        ),
        "barangays": {
            r["barangay_psgc"]: {
                "name": r["barangay_name"],
                "city": r["city_name"],
                "cityPsgc": r["city_psgc"],
                "pctLow": r["pct_low"],
                "pctMedium": r["pct_medium"],
                "pctHigh": r["pct_high"],
                "pctNoHazard": r["pct_no_hazard"],
                "exposedAreaKm2": r["exposed_area_km2"],
                "dominantHazard": r["dominant_hazard"],
                "maxHazard": r["max_hazard"],
                "historicalRiskClass": r["historical_risk_class"],
                "returnPeriod": r["return_period"],
                "confidence": r["confidence"],
                "source": r["source"],
                "sourceYear": r["source_year"],
            }
            for r in df.to_dict("records")
        },
    }
    compact_path = OUT_DIR / "ncr_barangay_historical_flood_risk.compact.json"
    compact_path.write_text(json.dumps(compact, separators=(",", ":")))
    print(f"[write] {compact_path} ({len(compact['barangays'])} barangays)")

    # --- City / LGU summary JSON -------------------------------------------
    city_summary = _aggregate_cities(df)
    city_path = OUT_DIR / "ncr_city_historical_flood_summary.json"
    city_path.write_text(json.dumps(city_summary, indent=2))
    print(f"[write] {city_path} ({len(city_summary['cities'])} cities)")

    # Console sanity summary.
    counts = df["historical_risk_class"].value_counts().to_dict()
    print("[summary] class counts:", counts)


def _aggregate_cities(df: pd.DataFrame) -> dict:
    cities = []
    for city_psgc, grp in df.groupby("city_psgc"):
        classes = grp["historical_risk_class"].value_counts().to_dict()
        total_exposed = round(float(grp["exposed_area_km2"].sum()), 4)
        # Area-weighted average exposure percentages.
        w = grp["exposed_area_km2"].replace(0, 0.0)
        weight = w.sum() if w.sum() > 0 else 1.0
        wa_low = round(float((grp["pct_low"] * w).sum() / weight), 2)
        wa_med = round(float((grp["pct_medium"] * w).sum() / weight), 2)
        wa_high = round(float((grp["pct_high"] * w).sum() / weight), 2)
        # Dominant city class = the highest class with the most barangays.
        order = ["High", "Moderate", "Low", "Unknown"]
        dominant = max(
            order,
            key=lambda c: (classes.get(c, 0), -order.index(c)),
        )
        cities.append(
            {
                "city_name": grp["city_name"].iloc[0],
                "city_psgc": city_psgc,
                "region_code": REGION_CODE,
                "barangay_count": int(len(grp)),
                "low_count": int(classes.get("Low", 0)),
                "moderate_count": int(classes.get("Moderate", 0)),
                "high_count": int(classes.get("High", 0)),
                "unknown_count": int(classes.get("Unknown", 0)),
                "total_exposed_area_km2": total_exposed,
                "area_weighted_pct_low": wa_low,
                "area_weighted_pct_medium": wa_med,
                "area_weighted_pct_high": wa_high,
                "dominant_historical_risk_class": dominant,
                "source": SOURCE_LABEL,
                "source_year": SOURCE_YEAR,
                "return_period": DEFAULT_RETURN_PERIOD,
            }
        )
    cities.sort(key=lambda c: c["city_name"])
    return {
        "region_code": REGION_CODE,
        "source": SOURCE_LABEL,
        "source_year": SOURCE_YEAR,
        "license": LICENSE,
        "return_period": DEFAULT_RETURN_PERIOD,
        "cities": cities,
    }


if __name__ == "__main__":
    build()
