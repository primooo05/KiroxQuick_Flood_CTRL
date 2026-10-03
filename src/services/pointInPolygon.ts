// src/services/pointInPolygon.ts
//
// Minimal, dependency-free point-in-polygon used to resolve a report's
// coordinate to the barangay that contains it. Ray-casting with a bounding-box
// pre-filter for speed; handles Polygon and MultiPolygon (outer ring + holes).

/** True when [lng,lat] is inside a single linear ring (ray casting). */
function pointInRing(
  lng: number,
  lat: number,
  ring: GeoJSON.Position[],
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** True when the point is inside the polygon (outer ring minus holes). */
function pointInPolygonRings(
  lng: number,
  lat: number,
  rings: GeoJSON.Position[][],
): boolean {
  if (rings.length === 0) return false;
  if (!pointInRing(lng, lat, rings[0])) return false;
  // Inside a hole → not in the polygon.
  for (let h = 1; h < rings.length; h++) {
    if (pointInRing(lng, lat, rings[h])) return false;
  }
  return true;
}

/** True when [lng,lat] falls within a Polygon or MultiPolygon geometry. */
export function pointInGeometry(
  lng: number,
  lat: number,
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): boolean {
  if (geometry.type === 'Polygon') {
    return pointInPolygonRings(lng, lat, geometry.coordinates);
  }
  for (const poly of geometry.coordinates) {
    if (pointInPolygonRings(lng, lat, poly)) return true;
  }
  return false;
}

/** True when a point lies on any outer-ring or hole boundary segment. */
export function pointOnGeometryBoundary(
  lng: number,
  lat: number,
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  epsilon = 1e-10,
): boolean {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (let i = 0; i < ring.length - 1; i += 1) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[i + 1];
        const dx = x2 - x1;
        const dy = y2 - y1;
        const cross = (lng - x1) * dy - (lat - y1) * dx;
        if (Math.abs(cross) > epsilon) continue;
        const dot = (lng - x1) * dx + (lat - y1) * dy;
        const lengthSquared = dx * dx + dy * dy;
        if (dot >= -epsilon && dot <= lengthSquared + epsilon) return true;
      }
    }
  }
  return false;
}

/** Axis-aligned bounding box of a geometry: [minLng, minLat, maxLng, maxLat]. */
export function bboxOf(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const polys =
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const poly of polys) {
    for (const ring of poly) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return [minX, minY, maxX, maxY];
}
