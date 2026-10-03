// src/data/fixtures/floodReports.ts
//
// ⚠️ DEMO / FIXTURE DATA — NOT AUTHORITATIVE ⚠️
// Sample authoritative-style current/recent flood reports for development only.
// These are invented demo points, not real reports from any agency, and must
// not be presented as authoritative or verified (Req 15.1, 15.2, 15.4).

import type { FloodReport } from '../../types/flood';

/** Demo source marker attached to every report fixture (Req 15.4). */
export const FLOOD_REPORTS_DEMO_SOURCE = 'DEMO — current/recent report (fixture)';

/** Marks this module's contents as demo/fixture data (Req 15.2). */
export const FLOOD_REPORTS_IS_DEMO = true;

/** Fixed demo epoch (seconds); deliberately old so fixtures cannot imply live data. */
const DEMO_REPORTED_AT = 1_700_000_000;

/**
 * Demo flood reports covering major Metro Manila roads. Coordinates and
 * conditions are invented for UI development; they are not real observations.
 * GREEN carries passable === true (Recently Reported Passable).
 */
export const floodReportFixtures: FloodReport[] = [
  {
    id: 'demo-report-red-marikina',
    state: 'RED',
    passable: false,
    metadata: {
      location: { lng: 121.101, lat: 14.648 },
      source: FLOOD_REPORTS_DEMO_SOURCE,
      dataType: 'REPORT',
      updatedAt: DEMO_REPORTED_AT,
      verificationStatus: 'UNCONFIRMED',
      severity: 'reported flooding',
      depth: 0.9,
      description: 'DEMO ONLY — invented flooding example near Marcos Highway / Marikina. Not a real observation.',
    },
  },
  {
    id: 'demo-report-orange-pasig',
    state: 'ORANGE',
    passable: false,
    metadata: {
      location: { lng: 121.078, lat: 14.576 },
      source: FLOOD_REPORTS_DEMO_SOURCE,
      dataType: 'REPORT',
      updatedAt: DEMO_REPORTED_AT,
      verificationStatus: 'UNCONFIRMED',
      severity: 'elevated flood exposure',
      depth: 0.4,
      description: 'DEMO ONLY — invented flooding example along C-5 near Pasig. Not a real observation.',
    },
  },
  {
    id: 'demo-report-yellow-espana',
    state: 'YELLOW',
    metadata: {
      location: { lng: 120.994, lat: 14.61 },
      source: FLOOD_REPORTS_DEMO_SOURCE,
      dataType: 'REPORT',
      updatedAt: DEMO_REPORTED_AT,
      verificationStatus: 'UNCONFIRMED',
      severity: 'caution',
      description: 'DEMO ONLY — invented minor-ponding example along España Boulevard. Not a real observation.',
    },
  },
  {
    id: 'demo-report-green-makati',
    state: 'GREEN',
    passable: true,
    metadata: {
      location: { lng: 121.028, lat: 14.556 },
      source: FLOOD_REPORTS_DEMO_SOURCE,
      dataType: 'REPORT',
      updatedAt: DEMO_REPORTED_AT,
      verificationStatus: 'UNCONFIRMED',
      severity: 'recently reported passable',
      description: 'DEMO ONLY — invented passability example near EDSA / Makati. Not a real observation.',
    },
  },
  {
    id: 'demo-report-edsa-quezon-city',
    state: 'ORANGE',
    passable: false,
    metadata: {
      location: { lng: 121.056, lat: 14.637 },
      source: FLOOD_REPORTS_DEMO_SOURCE,
      dataType: 'REPORT',
      updatedAt: DEMO_REPORTED_AT,
      verificationStatus: 'UNCONFIRMED',
      severity: 'demo elevated-water example',
      depth: 0.35,
      description: 'DEMO ONLY — invented elevated-water example on EDSA near Quezon Avenue. Not a real observation.',
    },
  },
  {
    id: 'demo-report-roxas-blvd',
    state: 'YELLOW',
    metadata: {
      location: { lng: 120.982, lat: 14.559 },
      source: FLOOD_REPORTS_DEMO_SOURCE,
      dataType: 'REPORT',
      updatedAt: DEMO_REPORTED_AT,
      verificationStatus: 'UNCONFIRMED',
      severity: 'demo ponding example',
      description: 'DEMO ONLY — invented ponding example on Roxas Boulevard. Not a real observation.',
    },
  },
  {
    id: 'demo-report-commonwealth-ave',
    state: 'RED',
    passable: false,
    metadata: {
      location: { lng: 121.062, lat: 14.676 },
      source: FLOOD_REPORTS_DEMO_SOURCE,
      dataType: 'REPORT',
      updatedAt: DEMO_REPORTED_AT,
      verificationStatus: 'UNCONFIRMED',
      severity: 'demo road-flooding example',
      depth: 0.6,
      description: 'DEMO ONLY — invented road-flooding example on Commonwealth Avenue. Not a real observation.',
    },
  },
];
