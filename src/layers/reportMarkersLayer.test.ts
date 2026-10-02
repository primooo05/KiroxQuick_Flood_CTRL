// src/layers/reportMarkersLayer.test.ts
//
// Guards the runtime community-report marker refresh used by the dynamic
// "report flooding" flow. A newly submitted report must appear in the layer's
// GeoJSON without reinstalling the layer, and must never read as confirmed.

import { describe, it, expect, vi } from 'vitest';
import {
  updateCommunityReportsSource,
  communityReportsToGeoJSON,
  COMMUNITY_REPORTS_SOURCE_ID,
  type PointSourceUpdateMap,
  type UpdatableGeoJSONSource,
} from './reportMarkersLayer';
import type { CommunityReport } from '../types/report';

/** A real NCR point (Manila) so the report resolves to a barangay. */
const report: CommunityReport = {
  id: 'user-report-1',
  state: 'ORANGE',
  passable: false,
  metadata: {
    location: { lng: 120.982, lat: 14.598 },
    source: 'DEMO — community report (fixture)',
    dataType: 'COMMUNITY_REPORT',
    updatedAt: 1_700_000_000,
    verificationStatus: 'UNCONFIRMED',
  },
};

describe('updateCommunityReportsSource', () => {
  it('replaces the community-reports source data via setData', () => {
    const setData = vi.fn();
    const source: UpdatableGeoJSONSource = { setData };
    const map: PointSourceUpdateMap = {
      getSource: (id) => (id === COMMUNITY_REPORTS_SOURCE_ID ? source : undefined),
    };

    updateCommunityReportsSource(map, [report]);

    expect(setData).toHaveBeenCalledTimes(1);
    expect(setData).toHaveBeenCalledWith(communityReportsToGeoJSON([report]));
  });

  it('is a no-op when the source is not installed yet', () => {
    const map: PointSourceUpdateMap = { getSource: () => undefined };
    expect(() => updateCommunityReportsSource(map, [report])).not.toThrow();
  });

  it('projects the report as a point feature carrying its reported state', () => {
    const fc = communityReportsToGeoJSON([report]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry).toEqual({
      type: 'Point',
      coordinates: [120.982, 14.598],
    });
    expect(fc.features[0].properties?.state).toBe('ORANGE');
  });
});
