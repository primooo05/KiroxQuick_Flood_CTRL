// src/services/rainfallGrid.ts
//
// Coarse spatial sampling for rainfall (Phase 4 fix for Open-Meteo rate limits).
//
// WHY: sampling all 1,710 barangay centroids meant ~9 Open-Meteo requests per
// 5-minute poll (batch 200), which exhausted the free tier's HOURLY request
// quota and returned HTTP 429 ("Hourly API request limit exceeded"). Rainfall
// does not vary meaningfully between adjacent ~1 km barangays, so we sample a
// COARSE grid (a few dozen cells covering NCR) in a SINGLE small request and
// map every barangay to its containing grid cell. This cuts requests per poll
// from ~9 to 1 while every barangay still receives an estimated value.
//
// The grid cell size is a balance: small enough that rainfall is locally
// representative, large enough to keep the sample count in one request.

import { ncrBarangayInfos } from '../data/geojson/ncrBarangays';
import type { SampleCoord } from './rainfallService';

/**
 * Grid cell size in degrees (~0.03° ≈ 3.3 km). Over NCR's ~0.6° × 0.5° extent
 * this yields roughly 40–60 populated cells — comfortably within a single
 * conservative Open-Meteo request.
 */
export const GRID_CELL_DEG = 0.03;

/** Rounds a coordinate to its grid cell index. */
function cellIndex(value: number): number {
  return Math.round(value / GRID_CELL_DEG);
}

/** A synthetic grid-cell id from its lat/lng cell indices. */
function cellId(lngIdx: number, latIdx: number): string {
  return `grid:${lngIdx}:${latIdx}`;
}

interface GridBuild {
  /** The unique grid sample coordinates (cell centers), one per populated cell. */
  readonly samples: SampleCoord[];
  /** barangay PSGC → grid cell id (the sample whose value it inherits). */
  readonly barangayToCell: ReadonlyMap<string, string>;
}

/**
 * Builds the coarse rainfall grid from the NCR barangay centroids: one sample
 * per populated cell (at the cell center), plus a barangay→cell assignment so
 * each barangay inherits its cell's rainfall. Deterministic and pure.
 */
function buildGrid(): GridBuild {
  const cellCenters = new Map<string, SampleCoord>();
  const barangayToCell = new Map<string, string>();

  for (const b of ncrBarangayInfos) {
    const [lng, lat] = b.centroid;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const lngIdx = cellIndex(lng);
    const latIdx = cellIndex(lat);
    const id = cellId(lngIdx, latIdx);
    if (!cellCenters.has(id)) {
      cellCenters.set(id, {
        psgc: id, // the SampleCoord.psgc carries the grid-cell id
        lng: lngIdx * GRID_CELL_DEG,
        lat: latIdx * GRID_CELL_DEG,
      });
    }
    barangayToCell.set(b.psgc, id);
  }

  return { samples: [...cellCenters.values()], barangayToCell };
}

const GRID = buildGrid();

/** The coarse grid sample coordinates (cell centers) — the request payload. */
export const rainfallGridSamples: readonly SampleCoord[] = GRID.samples;

/** barangay PSGC → grid cell id. */
export const barangayToGridCell: ReadonlyMap<string, string> = GRID.barangayToCell;
