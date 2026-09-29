/// <reference types="geojson" />
// src/types/layer.ts

export type LayerId =
  | 'boundaries'
  | 'barangayFloodRisk'
  | 'cityFloodSummary'
  | 'floodSusceptibility'
  | 'floodReports'
  | 'communityReports'
  | 'officialClosures'
  | 'routes'
  | 'routeFloodSegments'
  | 'evacuationCenters';

export interface DataLayerMeta {
  id: LayerId;
  label: string; // human text for Layer_Control (Req 9.5)
  /** Optional longer, more descriptive accessible name for assistive tech. */
  ariaLabel?: string;
  isDemo: boolean; // drives the demo/fixture badge (Req 15.2)
  defaultVisible: boolean;
}

export interface LoadResult<TItem> {
  items: TItem[];
  skipped: number; // count of malformed items skipped (Req 18.2)
  isDemo: boolean;
}

export interface DataLayer<TItem = unknown> {
  readonly meta: DataLayerMeta;
  /** Returns validated items; malformed items are skipped, not thrown (Req 18.2). */
  load(): Promise<LoadResult<TItem>>;
  /** GeoJSON projection for MapLibre sources; empty layers return empty FeatureCollection (Req 18.3). */
  toGeoJSON(items: TItem[]): GeoJSON.FeatureCollection;
}

export interface DataSource {
  getLayer<TItem>(id: LayerId): DataLayer<TItem>;
  listLayers(): DataLayerMeta[];
}
