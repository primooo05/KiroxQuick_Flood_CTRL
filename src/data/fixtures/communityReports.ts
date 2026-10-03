// src/data/fixtures/communityReports.ts
//
// ⚠️ DEMO / FIXTURE DATA — NOT AUTHORITATIVE ⚠️
// Sample community (non-authoritative) flood reports for development only.
// These are invented demo points, not real community submissions, and are
// always marked UNCONFIRMED (Req 14.3, 14.4, 15.1, 15.2, 15.4).

import type { CommunityReport } from '../../types/report';

/** Demo source marker attached to every community-report fixture (Req 15.4). */
export const COMMUNITY_REPORTS_DEMO_SOURCE = 'DEMO — community report (fixture)';

/** Marks this module's contents as demo/fixture data (Req 15.2). */
export const COMMUNITY_REPORTS_IS_DEMO = true;

const RECENT = 1_700_000_000;

/**
 * Demo community reports. All carry dataType 'COMMUNITY_REPORT' and
 * verificationStatus 'UNCONFIRMED' (Req 14.1, 14.3).
 */
export const communityReportFixtures: CommunityReport[] = [
  {
    id: 'demo-community-quezon-city',
    state: 'ORANGE',
    passable: false,
    metadata: {
      location: { lng: 121.043, lat: 14.676 },
      source: COMMUNITY_REPORTS_DEMO_SOURCE,
      dataType: 'COMMUNITY_REPORT',
      updatedAt: RECENT,
      verificationStatus: 'UNCONFIRMED',
      description:
        'DEMO: unconfirmed community report of rising water in Quezon City. Not authoritative.',
    },
  },
  {
    id: 'demo-community-manila',
    state: 'YELLOW',
    metadata: {
      location: { lng: 120.982, lat: 14.598 },
      source: COMMUNITY_REPORTS_DEMO_SOURCE,
      dataType: 'COMMUNITY_REPORT',
      updatedAt: RECENT,
      verificationStatus: 'UNCONFIRMED',
      description: 'DEMO: unconfirmed community report of ponding in Manila. Not authoritative.',
    },
  },
  {
    id: 'demo-community-taguig',
    state: 'GRAY',
    metadata: {
      location: { lng: 121.055, lat: 14.52 },
      source: COMMUNITY_REPORTS_DEMO_SOURCE,
      dataType: 'COMMUNITY_REPORT',
      updatedAt: RECENT,
      verificationStatus: 'UNCONFIRMED',
      description:
        'DEMO: unconfirmed community report with unknown conditions in Taguig. Not authoritative.',
    },
  },
  {
    id: 'demo-community-highway-edsa',
    state: 'ORANGE',
    passable: false,
    metadata: {
      location: { lng: 121.056, lat: 14.637 },
      source: COMMUNITY_REPORTS_DEMO_SOURCE,
      dataType: 'COMMUNITY_REPORT',
      updatedAt: RECENT,
      verificationStatus: 'UNCONFIRMED',
      severity: 'mock elevated-water condition',
      description:
        'MOCK DATA — invented elevated-water example on EDSA near Quezon Avenue. Not a real report or current road condition.',
    },
  },
  {
    id: 'demo-community-highway-c5',
    state: 'YELLOW',
    metadata: {
      location: { lng: 121.078, lat: 14.576 },
      source: COMMUNITY_REPORTS_DEMO_SOURCE,
      dataType: 'COMMUNITY_REPORT',
      updatedAt: RECENT,
      verificationStatus: 'UNCONFIRMED',
      severity: 'mock ponding condition',
      description:
        'MOCK DATA — invented ponding example along C-5 in Pasig. Not a real report or current road condition.',
    },
  },
  {
    id: 'demo-community-highway-commonwealth',
    state: 'RED',
    passable: false,
    metadata: {
      location: { lng: 121.062, lat: 14.676 },
      source: COMMUNITY_REPORTS_DEMO_SOURCE,
      dataType: 'COMMUNITY_REPORT',
      updatedAt: RECENT,
      verificationStatus: 'UNCONFIRMED',
      severity: 'mock road-flooding condition',
      depth: 0.6,
      description:
        'MOCK DATA — invented road-flooding example on Commonwealth Avenue. Not a real report or current road condition.',
    },
  },
  {
    id: 'demo-community-highway-roxas',
    state: 'YELLOW',
    metadata: {
      location: { lng: 120.982, lat: 14.559 },
      source: COMMUNITY_REPORTS_DEMO_SOURCE,
      dataType: 'COMMUNITY_REPORT',
      updatedAt: RECENT,
      verificationStatus: 'UNCONFIRMED',
      severity: 'mock ponding condition',
      description:
        'MOCK DATA — invented ponding example on Roxas Boulevard. Not a real report or current road condition.',
    },
  },
];
