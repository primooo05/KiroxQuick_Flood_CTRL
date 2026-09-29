// src/components/overlays/LiveStatusPill.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveStatusPill } from './LiveStatusPill';

describe('LiveStatusPill', () => {
  const now = Math.floor(Date.now() / 1000);

  it('shows a live indicator with the update time', () => {
    render(<LiveStatusPill freshness="live" lastUpdated={now - 120} />);
    const pill = screen.getByTestId('live-status-pill');
    expect(pill).toHaveTextContent(/live/i);
    expect(pill).toHaveTextContent(/updated/i);
  });

  it('shows a stale warning with the last update time', () => {
    render(<LiveStatusPill freshness="stale" lastUpdated={now - 18 * 60} />);
    const pill = screen.getByTestId('live-status-pill');
    expect(pill).toHaveTextContent(/stale/i);
    expect(pill).toHaveTextContent(/last updated/i);
  });

  it('shows unavailable and never says "showing last known values"', () => {
    render(<LiveStatusPill freshness="unavailable" lastUpdated={null} />);
    const pill = screen.getByTestId('live-status-pill');
    expect(pill).toHaveTextContent(/unavailable/i);
    expect(pill.textContent ?? '').not.toMatch(/showing last known values/i);
  });
});
