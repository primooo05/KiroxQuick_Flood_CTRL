import { describe, expect, it } from 'vitest';
import {
  computeNavState,
  formatDistance,
  formatDuration,
  maneuverRotation,
  maneuverText,
} from './navigation';
import { PITX_TO_MOA_DISTANCE_M, PITX_TO_MOA_MANEUVERS } from '../data/fixtures/pitxToMoaRoute';
import { PITX_TO_MOA_HAZARDS } from '../data/fixtures/driveHazards';

const nav = (m: number) =>
  computeNavState(m, PITX_TO_MOA_DISTANCE_M, PITX_TO_MOA_MANEUVERS, PITX_TO_MOA_HAZARDS, 10);

describe('computeNavState', () => {
  it('points at the first turn after departure, with distance to it', () => {
    const s = nav(0);
    expect(s.next?.street).toBe('Quirino Avenue');
    expect(s.toNextM).toBe(PITX_TO_MOA_MANEUVERS[1].atM);
    expect(s.remainingM).toBe(PITX_TO_MOA_DISTANCE_M);
    expect(s.remainingS).toBe(PITX_TO_MOA_DISTANCE_M / 10);
  });

  it('warns about a hazard only within 1 km ahead', () => {
    const [first] = PITX_TO_MOA_HAZARDS;
    expect(nav(first.atM - 1500).hazard).toBeNull();
    const s = nav(first.atM - 400);
    expect(s.hazard?.id).toBe(first.id);
    expect(s.toHazardM).toBe(400);
    expect(nav(first.atM + 1).hazard?.id).not.toBe(first.id);
  });

  it('ends on the arrival maneuver', () => {
    const s = nav(PITX_TO_MOA_DISTANCE_M - 5);
    expect(s.next?.type).toBe('arrive');
    expect(maneuverText(s.next)).toBe('Arrive at SM Mall of Asia');
    expect(maneuverRotation(s.next)).toBeNull();
  });
});

describe('formatting', () => {
  it('formats distances and durations for drivers', () => {
    expect(formatDistance(8)).toBe('Now');
    expect(formatDistance(43)).toBe('40 m');
    expect(formatDistance(262)).toBe('250 m');
    expect(formatDistance(1240)).toBe('1.2 km');
    expect(formatDuration(20)).toBe('<1 min');
    expect(formatDuration(170)).toBe('3 min');
  });

  it('maps modifiers to arrow rotations and builds turn text', () => {
    const left = PITX_TO_MOA_MANEUVERS[1];
    expect(maneuverRotation(left)).toBe(-90);
    expect(maneuverText(left)).toBe('Turn left onto Quirino Avenue');
    expect(maneuverRotation({ ...left, modifier: 'slight right' })).toBe(45);
  });
});
