// src/services/FixtureDataSource.ts
//
// A DataSource implementation backed by the isolated demo fixtures. It exposes
// every category as a DataLayer through the same interface a future
// ApiDataSource will implement, so consuming components and the LayerRegistry
// never need to change when fixtures are swapped for a real API (Req 15.3,
// 16.3).
//
// All layers reported by this source are demo/fixture data (isDemo: true) and
// carry plain human labels — never AI-generated labels, and this source never
// invents authoritative flood APIs (Req 15.1, 15.4, 15.5).

import type { DataLayer, DataLayerMeta, DataSource, LayerId } from '../types/layer';
import { ALL_LAYER_IDS, fixtureLayers } from '../layers/dataLayers';

export class FixtureDataSource implements DataSource {
  /**
   * Returns the DataLayer for the given LayerId. The caller supplies the
   * expected item type via the generic parameter; the underlying fixture layer
   * validates and projects that category's items.
   */
  getLayer<TItem>(id: LayerId): DataLayer<TItem> {
    const layer = fixtureLayers[id];
    if (!layer) {
      throw new Error(`FixtureDataSource: no fixture layer for id "${id}".`);
    }
    return layer as unknown as DataLayer<TItem>;
  }

  /**
   * Lists metadata for every layer this source provides (all seven LayerIds),
   * in a stable order, for the Layer_Control. Every entry reports
   * `isDemo: true` (Req 15.2).
   */
  listLayers(): DataLayerMeta[] {
    return ALL_LAYER_IDS.map((id) => fixtureLayers[id]).flatMap((layer) =>
      layer ? [layer.meta] : [],
    );
  }
}

/** A shared default instance for convenience. */
export const fixtureDataSource = new FixtureDataSource();
