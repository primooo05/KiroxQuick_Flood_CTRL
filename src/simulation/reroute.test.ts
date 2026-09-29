import { describe, expect, it, vi } from 'vitest';
import {
  branchPoint,
  findRerouteOffer,
  formatRerouteDelta,
  MAX_JOIN_GAP_M,
  MIN_DECISION_M,
  stitchReroute,
} from './reroute';
import { PITX_TO_MOA_REROUTES } from '../data/fixtures/floodReroutes';
import { PITX_TO_MOA_HAZARDS } from '../data/fixtures/driveHazards';
import { PITX_TO_MOA_MANEUVERS, PITX_TO_MOA_ROUTE } from '../data/fixtures/pitxToMoaRoute';
import {
  distanceMeters,
  measureRoute,
  nearestAlong,
  pointAlong,
  type LngLat,
} from './routeGeometry';
import { DriveSimulator, type Scheduler } from './DriveSimulator';

const base = measureRoute(PITX_TO_MOA_ROUTE);
const at = (m: number) => pointAlong(base, m);

describe('flood reroute fixtures', () => {
  it('has several reroutes per hazard, the first 1 km before it, all ending at MOA', () => {
    const end = PITX_TO_MOA_ROUTE[PITX_TO_MOA_ROUTE.length - 1];
    for (const h of PITX_TO_MOA_HAZARDS) {
      const rs = PITX_TO_MOA_REROUTES.filter((x) => x.hazardId === h.id);
      expect(rs.length).toBeGreaterThanOrEqual(2);
      expect(rs[0].fromM).toBe(h.atM - 1000);
      for (const r of rs) {
        expect(distanceMeters(r.route[r.route.length - 1] as LngLat, end)).toBeLessThan(100);
        expect(r.maneuvers[r.maneuvers.length - 1].type).toBe('arrive');
      }
    }
  });

  it('keeps every reroute at least 150 m from every demo hazard', () => {
    for (const r of PITX_TO_MOA_REROUTES) {
      const alt = measureRoute(r.route);
      for (const h of PITX_TO_MOA_HAZARDS) {
        const hp = at(h.atM);
        let best = Infinity;
        for (let d = 0; d <= alt.length; d += 10) {
          best = Math.min(best, distanceMeters(hp, pointAlong(alt, d)));
        }
        expect(best).toBeGreaterThan(150);
      }
    }
  });
});

describe('nearestAlong', () => {
  it('projects a point onto the route', () => {
    const r = measureRoute([
      [121, 14],
      [121, 14.01],
    ]);
    const n = nearestAlong(r, [121.0001, 14.005]);
    expect(n.alongM).toBeCloseTo(r.length / 2, -1);
    expect(n.offM).toBeGreaterThan(5);
    expect(n.offM).toBeLessThan(15);
  });
});

describe('findRerouteOffer (car keeps moving)', () => {
  const [h] = PITX_TO_MOA_HAZARDS;
  const none = new Set<string>();
  // The HUD only passes a hazard id once it is within the 1 km look-ahead.
  const offerAt = (m: number, dismissed = none) =>
    findRerouteOffer(base, m, h.atM - m <= 1000 ? h.id : null, PITX_TO_MOA_REROUTES, dismissed, 10);

  it('offers a reroute at 1 km with its turn-off still ahead', () => {
    expect(offerAt(h.atM - 1100)).toBeNull();
    const offer = offerAt(h.atM - 1000);
    expect(offer).not.toBeNull();
    expect(offer!.isRetry).toBe(false);
    expect(offer!.toBranchM).toBeGreaterThanOrEqual(MIN_DECISION_M);
  });

  it('offers a later turn-off (retry) after the driver passes one', () => {
    const branches: number[] = [];
    let sawRetry = false;
    for (let m = h.atM - 1000; m < h.atM; m += 10) {
      const o = offerAt(m);
      if (!o) continue;
      const b = branchPoint(base, o.reroute)!.baseM;
      if (branches[branches.length - 1] !== b) branches.push(b);
      if (o.isRetry) sawRetry = true;
    }
    expect(branches.length).toBeGreaterThanOrEqual(2);
    expect([...branches].sort((a, b) => a - b)).toEqual(branches);
    expect(sawRetry).toBe(true);
  });

  it('stops offering after the driver chooses to keep the route', () => {
    expect(offerAt(h.atM - 900, new Set([h.id]))).toBeNull();
  });

  it('formats the time/distance delta', () => {
    expect(formatRerouteDelta({ extraM: 400, extraS: 120 })).toBe('+2 min · +0.4 km');
    expect(formatRerouteDelta({ extraM: -300, extraS: -60 })).toBe('−1 min · −0.3 km');
  });
});

describe('stitchReroute (accept from where the driver is)', () => {
  const [h] = PITX_TO_MOA_HAZARDS;
  const traveled = h.atM - 1000;
  const offer = findRerouteOffer(base, traveled, h.id, PITX_TO_MOA_REROUTES, new Set(), 10)!;
  const next = stitchReroute(base, PITX_TO_MOA_MANEUVERS, offer.reroute, traveled)!;

  it('starts exactly at the vehicle, so accepting never moves it', () => {
    expect(distanceMeters(next.route[0], at(traveled))).toBeLessThan(0.5);
  });

  it('follows the current road to the turn-off, then the reroute to MOA', () => {
    const branch = branchPoint(base, offer.reroute)!;
    const newRoute = measureRoute(next.route);
    expect(distanceMeters(pointAlong(newRoute, offer.toBranchM), at(branch.baseM))).toBeLessThan(5);
    const end = offer.reroute.route[offer.reroute.route.length - 1];
    expect(distanceMeters(next.route[next.route.length - 1], end)).toBeLessThan(1);
    expect(newRoute.length).toBeCloseTo(next.lengthM, 5);
  });

  it('gives directions from here: turns ascending, ending with arrive', () => {
    const ats = next.maneuvers.map((m) => m.atM);
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    expect(ats[0]).toBeGreaterThan(0);
    expect(next.maneuvers[next.maneuvers.length - 1].type).toBe('arrive');
  });

  it('never passes within 150 m of a demo hazard', () => {
    const r = measureRoute(next.route);
    for (const hz of PITX_TO_MOA_HAZARDS) {
      let best = Infinity;
      for (let d = 0; d <= r.length; d += 10)
        best = Math.min(best, distanceMeters(at(hz.atM), pointAlong(r, d)));
      expect(best).toBeGreaterThan(150);
    }
  });
});

describe('reroutes only use real roads', () => {
  it('every offered, stitched route lies entirely on Directions road geometry', () => {
    for (const h of PITX_TO_MOA_HAZARDS) {
      for (let m = h.atM - 1000; m < h.atM; m += 25) {
        const offer = findRerouteOffer(base, m, h.id, PITX_TO_MOA_REROUTES, new Set(), 10);
        if (!offer) continue;
        const next = stitchReroute(base, PITX_TO_MOA_MANEUVERS, offer.reroute, m)!;
        const alt = measureRoute(offer.reroute.route);
        const stitched = measureRoute(next.route);
        // Sample the whole stitched line: each point must sit on the base road
        // or on the reroute (both from the Mapbox road network).
        for (let d = 0; d <= stitched.length; d += 5) {
          const p = pointAlong(stitched, d);
          const off = Math.min(nearestAlong(base, p).offM, nearestAlong(alt, p).offM);
          expect(off).toBeLessThan(MAX_JOIN_GAP_M);
        }
      }
    }
  });

  it('rejects a reroute that cannot join the current road at a shared node', () => {
    // The 250 m-before-Roxas reroute was snapped by Directions onto a nearby
    // side road (~58 m away): joining it would invent a segment.
    const orphan = PITX_TO_MOA_REROUTES.find(
      (r) => r.hazardId === 'demo-roxas-baclaran' && r.fromM === 2600,
    )!;
    expect(branchPoint(base, orphan)).toBeNull();
    expect(stitchReroute(base, PITX_TO_MOA_MANEUVERS, orphan, 2600)).toBeNull();
  });
});

describe('DriveSimulator start offset + pause/resume', () => {
  function sim(onFrame: (m: number) => void) {
    let pending: ((t: number) => void) | null = null;
    const scheduler: Scheduler = {
      request: (cb) => ((pending = cb), 1),
      cancel: () => (pending = null),
    };
    const step = (t: number) => {
      const cb = pending;
      pending = null;
      cb?.(t);
    };
    const s = new DriveSimulator({
      route: [
        [121, 14],
        [121, 14.01],
      ],
      onFrame: (f) => onFrame(f.traveledM),
      onFinish: vi.fn(),
      speedMps: 10,
      playbackRate: 1,
      scheduler,
    });
    return { s, step };
  }

  it('starts part-way along the route without jumping back', () => {
    const traveled: number[] = [];
    const { s, step } = sim((m) => traveled.push(m));
    s.start(300);
    expect(traveled[0]).toBe(300);
    step(0);
    step(1000);
    expect(traveled[traveled.length - 1]).toBeCloseTo(310, 5);
  });

  it('holds position while paused and continues without jumping', () => {
    const traveled: number[] = [];
    const { s, step } = sim((m) => traveled.push(m));
    s.start();
    step(0);
    step(1000);
    s.pause();
    step(50_000);
    s.resume();
    step(60_000);
    step(61_000);
    expect(traveled[traveled.length - 1]).toBeCloseTo(20, 5);
  });
});
