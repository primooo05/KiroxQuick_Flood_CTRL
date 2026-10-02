// src/components/primaryLeftPanel.test.ts
import { describe, expect, it } from 'vitest';
import {
  resolvePrimaryLeftPanel,
  type PrimaryLeftPanelInput,
} from './primaryLeftPanel';

const base: PrimaryLeftPanelInput = {
  isError: false,
  driving: false,
  barangaySelected: false,
  comparing: false,
  searching: false,
  historicalVisible: false,
};

describe('resolvePrimaryLeftPanel (single-panel exclusivity)', () => {
  it('returns null during error or driving', () => {
    expect(resolvePrimaryLeftPanel({ ...base, isError: true })).toBeNull();
    expect(resolvePrimaryLeftPanel({ ...base, driving: true })).toBeNull();
    // Driving/error outrank everything else.
    expect(
      resolvePrimaryLeftPanel({ ...base, driving: true, comparing: true, barangaySelected: true }),
    ).toBeNull();
  });

  it('prioritizes Insights (barangay) over Compare, Explore, Search', () => {
    expect(
      resolvePrimaryLeftPanel({
        ...base,
        barangaySelected: true,
        comparing: true,
        historicalVisible: true,
        searching: true,
      }),
    ).toBe('insights');
  });

  it('prioritizes Compare over Explore and Search', () => {
    expect(
      resolvePrimaryLeftPanel({
        ...base,
        comparing: true,
        historicalVisible: true,
        searching: true,
      }),
    ).toBe('compare');
  });

  it('prefers Explore over Search when Historical is visible', () => {
    expect(
      resolvePrimaryLeftPanel({ ...base, historicalVisible: true, searching: true }),
    ).toBe('explore');
  });

  it('falls back to Search, then null', () => {
    expect(resolvePrimaryLeftPanel({ ...base, searching: true })).toBe('search');
    expect(resolvePrimaryLeftPanel(base)).toBeNull();
  });

  it('NEVER returns two panels: the comparing+barangay case that caused the overlap now yields exactly Insights', () => {
    // Reproduces the reported bug input: comparing a route AND a barangay open.
    const result = resolvePrimaryLeftPanel({
      ...base,
      comparing: true,
      barangaySelected: true,
    });
    expect(result).toBe('insights');
    // (The route remains recoverable via the "Route ready" chip in MapView.)
  });
});
