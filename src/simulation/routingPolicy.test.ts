// src/simulation/routingPolicy.test.ts
import { describe, expect, it } from 'vitest';
import {
  isBlocking,
  rerouteReason,
  routingStanceForHazard,
  routingStanceForRisk,
  shouldRecommendAlternative,
} from './routingPolicy';

describe('routingStanceForRisk', () => {
  it('confirmed closure is BLOCK (never routed through)', () => {
    expect(routingStanceForRisk('CONFIRMED_NOT_PASSABLE')).toBe('block');
    expect(isBlocking(routingStanceForRisk('CONFIRMED_NOT_PASSABLE'))).toBe(true);
  });
  it('reported/likely flooding is strongly avoided', () => {
    expect(routingStanceForRisk('REPORTED_FLOODING')).toBe('stronglyAvoid');
    expect(routingStanceForRisk('LIKELY_FLOODING')).toBe('stronglyAvoid');
  });
  it('high is avoided, elevated is caution, low is normal', () => {
    expect(routingStanceForRisk('HIGH')).toBe('avoid');
    expect(routingStanceForRisk('ELEVATED')).toBe('caution');
    expect(routingStanceForRisk('LOW')).toBe('normal');
  });
  it('data-quality states route normally (no fabricated avoidance)', () => {
    expect(routingStanceForRisk('UNKNOWN')).toBe('normal');
    expect(routingStanceForRisk('STALE')).toBe('normal');
  });
});

describe('routingStanceForHazard', () => {
  it('maps report severity to a stance (never block — only official closures block)', () => {
    expect(routingStanceForHazard('RED')).toBe('stronglyAvoid');
    expect(routingStanceForHazard('ORANGE')).toBe('avoid');
    expect(routingStanceForHazard('YELLOW')).toBe('caution');
    expect(isBlocking(routingStanceForHazard('RED'))).toBe(false);
  });
});

describe('recommendation + wording', () => {
  it('recommends an alternative for avoid/stronglyAvoid/block', () => {
    expect(shouldRecommendAlternative('avoid')).toBe(true);
    expect(shouldRecommendAlternative('stronglyAvoid')).toBe(true);
    expect(shouldRecommendAlternative('block')).toBe(true);
    expect(shouldRecommendAlternative('caution')).toBe(false);
    expect(shouldRecommendAlternative('normal')).toBe(false);
  });
  it('never calls a route "safe"', () => {
    for (const stance of ['block', 'stronglyAvoid', 'avoid', 'caution'] as const) {
      expect(rerouteReason(stance, 'EDSA')).not.toMatch(/\bsafe\b/i);
    }
  });
  it('explains why a change is recommended', () => {
    expect(rerouteReason('block', 'EDSA')).toMatch(/confirmed closure/i);
    expect(rerouteReason('stronglyAvoid', 'EDSA')).toMatch(/reported flooding/i);
    expect(rerouteReason('avoid', 'EDSA')).toMatch(/high flood-risk/i);
  });
});
