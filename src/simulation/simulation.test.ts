import { describe, expect, it, vi } from 'vitest';
import {
  bearingDegrees,
  distanceMeters,
  measureRoute,
  outsideRadiusMask,
  pointAlong,
  type LngLat,
} from './routeGeometry';
import { DriveSimulator, type DriveFrame, type Scheduler } from './DriveSimulator';
import { PITX_TO_MOA_ROUTE, PITX_TO_MOA_DISTANCE_M } from '../data/fixtures/pitxToMoaRoute';

describe('routeGeometry', () => {
  it('measures distance and bearing', () => {
    // ~111 km per degree of latitude.
    expect(distanceMeters([121, 14], [121, 15])).toBeGreaterThan(110_000);
    expect(distanceMeters([121, 14], [121, 15])).toBeLessThan(112_000);
    expect(bearingDegrees([121, 14], [121, 15])).toBeCloseTo(0, 5);
    expect(bearingDegrees([121, 14], [121.1, 14])).toBeCloseTo(90, 0);
  });

  it('interpolates along the route and clamps at the ends', () => {
    const route = measureRoute([
      [121, 14],
      [121, 14.01],
    ]);
    expect(pointAlong(route, -5)).toEqual([121, 14]);
    expect(pointAlong(route, route.length + 5)).toEqual([121, 14.01]);
    expect(pointAlong(route, route.length / 2)[1]).toBeCloseTo(14.005, 6);
  });

  it('builds a world mask with a ~radius hole around the center', () => {
    const center: LngLat = [120.99, 14.51];
    const [, hole] = outsideRadiusMask(center, 600).geometry.coordinates;
    for (const p of hole) {
      expect(distanceMeters(center, p as LngLat)).toBeGreaterThan(590);
      expect(distanceMeters(center, p as LngLat)).toBeLessThan(610);
    }
  });

  it('ships a PITX → MOA fixture whose length matches its metadata', () => {
    const length = measureRoute(PITX_TO_MOA_ROUTE).length;
    expect(PITX_TO_MOA_ROUTE.length).toBeGreaterThan(50);
    expect(Math.abs(length - PITX_TO_MOA_DISTANCE_M)).toBeLessThan(100);
  });
});

describe('DriveSimulator', () => {
  function manualScheduler() {
    let pending: ((t: number) => void) | null = null;
    const scheduler: Scheduler = {
      request: (cb) => {
        pending = cb;
        return 1;
      },
      cancel: () => {
        pending = null;
      },
    };
    return {
      scheduler,
      step: (t: number) => {
        const cb = pending;
        pending = null;
        cb?.(t);
      },
    };
  }

  it('advances at speed × playback rate and finishes at the route end', () => {
    const { scheduler, step } = manualScheduler();
    const frames: DriveFrame[] = [];
    const onFinish = vi.fn();
    const sim = new DriveSimulator({
      route: [
        [121, 14],
        [121, 14.01],
      ],
      onFrame: (f) => frames.push(f),
      onFinish,
      speedMps: 10,
      playbackRate: 2,
      scheduler,
    });
    sim.start();
    step(0);
    step(1000); // 20 m in 1 s
    const last = frames[frames.length - 1];
    expect(last?.traveledM).toBeCloseTo(20, 5);
    expect(last?.bearing).toBeCloseTo(0, 1);
    step(1_000_000);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(sim.running).toBe(false);
  });

  it('stop() halts playback without firing onFinish', () => {
    const { scheduler, step } = manualScheduler();
    const onFinish = vi.fn();
    const sim = new DriveSimulator({
      route: PITX_TO_MOA_ROUTE,
      onFrame: () => undefined,
      onFinish,
      scheduler,
    });
    sim.start();
    sim.stop();
    step(10_000_000);
    expect(onFinish).not.toHaveBeenCalled();
  });
});
