import { CITY_NORM_TO_CITY } from '../data/geojson/cityNameNormalization';
import { metroManilaCityBoundaries } from '../data/geojson/metroManilaCityBoundaries';
import { pointInGeometry, pointOnGeometryBoundary } from './pointInPolygon';
import type { MetroManilaTrafficCamera, TrafficCamera } from '../types/camera';

/**
 * Assigns records by local NCR boundary geometry. Any record outside the 17
 * LGUs (including points exactly on a polygon edge, which are ambiguous under
 * the ray-casting helper) is excluded. Provider city labels are not trusted as
 * a substitute for coordinates.
 */
export function filterMetroManilaCameras(
  cameras: readonly TrafficCamera[],
): MetroManilaTrafficCamera[] {
  const result: MetroManilaTrafficCamera[] = [];
  const seenIds = new Set<string>();

  for (const camera of cameras) {
    const [lng, lat] = camera.coordinates;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (metroManilaCityBoundaries.features.some((feature) =>
      pointOnGeometryBoundary(lng, lat, feature.geometry),
    )) continue;
    const matches = metroManilaCityBoundaries.features.filter((feature) =>
      pointInGeometry(lng, lat, feature.geometry),
    );
    // Exclude outside points and any overlap/ambiguous geometry match.
    if (matches.length !== 1) continue;

    const city = CITY_NORM_TO_CITY[matches[0].properties.city_norm];
    if (!city) continue;
    const dedupeKey = `${camera.source}\u0000${camera.sourceId}`;
    if (seenIds.has(dedupeKey)) continue;
    seenIds.add(dedupeKey);
    result.push({ ...camera, city });
  }
  return result;
}
