// src/components/overlays/overlays.test.tsx
//
// Component tests for the overlay/messaging components (Task 15.1). Each
// component renders its expected accessible text/role. The safety-critical
// components (Disclaimer, FloodPopup) are additionally asserted to carry the
// decision-support / historical-exposure framing and to NOT contain any banned
// safety language — "safe", "clear", "no risk", or a numeric safety score
// (Req 13.1, 13.2, 13.3, 13.4). Environment is jsdom.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LoadingIndicator } from './LoadingIndicator';
import { ConfigIncomplete } from './ConfigIncomplete';
import { ErrorMessage } from './ErrorMessage';
import { DemoDataBadge } from './DemoDataBadge';
import { CoverageBadge } from './CoverageBadge';
import { Disclaimer } from './Disclaimer';
import { FloodPopup } from './FloodPopup';
import { floodStateLabel } from '../../layers/visualMapping';
import type { FloodState } from '../../types/flood';

/**
 * Banned safety language that must never appear in any overlay. Matched
 * case-insensitively as whole words. Also asserts absence of a numeric safety
 * score (a "score" token) anywhere.
 */
const BANNED_WORDS = ['safe', 'clear', 'no risk'];

function expectNoBannedLanguage(text: string): void {
  const lower = text.toLowerCase();
  for (const word of BANNED_WORDS) {
    // Whole-word / phrase match so we don't false-positive on unrelated
    // substrings (there are none expected, but this keeps the intent explicit).
    const pattern = new RegExp(`\\b${word.replace(/\s+/g, '\\s+')}\\b`, 'i');
    expect(lower, `should not contain banned word "${word}"`).not.toMatch(
      pattern,
    );
  }
  // No numeric safety score (e.g. "safety score", "score: 7", "7/10").
  expect(lower).not.toContain('score');
  expect(lower).not.toMatch(/\b\d+\s*\/\s*\d+\b/);
}

describe('LoadingIndicator', () => {
  it('renders a status role with the default "Loading map…" text', () => {
    render(<LoadingIndicator />);
    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent('Loading map…');
  });

  it('renders a custom label when provided', () => {
    render(<LoadingIndicator label="Please wait" />);
    expect(screen.getByRole('status')).toHaveTextContent('Please wait');
  });
});

describe('ConfigIncomplete', () => {
  it('renders an alert explaining configuration is incomplete and names the env var', () => {
    render(<ConfigIncomplete />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/configuration is incomplete/i);
    expect(alert).toHaveTextContent('VITE_MAPBOX_ACCESS_TOKEN');
    expect(alert).toHaveTextContent(/\.env\.example/);
  });

  it('does not embed a secret value — only the variable name', () => {
    render(<ConfigIncomplete envVarName="VITE_MAPBOX_ACCESS_TOKEN" />);
    const alert = screen.getByRole('alert');
    // The variable name is present but no assignment/value form is rendered.
    expect(alert.textContent ?? '').not.toMatch(/VITE_MAPBOX_ACCESS_TOKEN\s*=/);
  });
});

describe('ErrorMessage', () => {
  it('renders an alert with the default "could not load" message', () => {
    render(<ErrorMessage />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/the map could not load/i);
  });

  it('renders an optional reason', () => {
    render(<ErrorMessage reason="timeout" />);
    expect(screen.getByRole('alert')).toHaveTextContent('timeout');
  });

  it('renders children in place of a reason when both provided', () => {
    render(
      <ErrorMessage reason="ignored">
        <p>custom detail</p>
      </ErrorMessage>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('custom detail');
    expect(alert).not.toHaveTextContent('ignored');
  });
});

describe('DemoDataBadge', () => {
  it('renders a visible, accessible "Demo data" badge', () => {
    render(<DemoDataBadge />);
    const badge = screen.getByRole('img', { name: 'Demo data' });
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('Demo data');
  });

  it('renders a custom label', () => {
    render(<DemoDataBadge label="Sample data" />);
    expect(
      screen.getByRole('img', { name: 'Sample data' }),
    ).toHaveTextContent('Sample data');
  });
});

describe('CoverageBadge', () => {
  it('states the NCR-only coverage scope', () => {
    render(<CoverageBadge />);
    const badge = screen.getByTestId('coverage-badge');
    expect(badge).toHaveTextContent(/Metro Manila \/ NCR/i);
    expect(badge).toHaveTextContent(/Coverage/i);
  });
});

describe('Disclaimer', () => {
  it('renders the general decision-support / not-a-guarantee framing', () => {
    render(<Disclaimer />);
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent(/support your own travel decisions/i);
    expect(note).toHaveTextContent(/not a guarantee/i);
  });

  it('renders the susceptibility historical-exposure framing', () => {
    render(<Disclaimer variant="susceptibility" />);
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent(
      /historical or modeled flood exposure/i,
    );
    expect(note).toHaveTextContent(/does not confirm current flooding/i);
  });

  it('contains no banned safety language in either variant', () => {
    const { rerender } = render(<Disclaimer />);
    expectNoBannedLanguage(screen.getByRole('note').textContent ?? '');
    rerender(<Disclaimer variant="susceptibility" />);
    expectNoBannedLanguage(screen.getByRole('note').textContent ?? '');
  });
});

describe('FloodPopup', () => {
  it('renders all required fields for a susceptibility item incl. formatted date', () => {
    render(
      <FloodPopup
        area="Marikina Riverbanks"
        dataType="SUSCEPTIBILITY"
        level="HIGH"
        source="Demo Hazard Dataset"
        updatedAt={1_700_000_000}
      />,
    );

    expect(screen.getByTestId('flood-popup-area')).toHaveTextContent(
      'Marikina Riverbanks',
    );
    expect(screen.getByTestId('flood-popup-data-type')).toHaveTextContent(
      'Susceptibility',
    );
    expect(screen.getByTestId('flood-popup-susceptibility')).toHaveTextContent(
      'High',
    );
    expect(screen.getByTestId('flood-popup-source')).toHaveTextContent(
      'Demo Hazard Dataset',
    );
    // 1_700_000_000s => 2023-11-14 UTC.
    expect(screen.getByTestId('flood-popup-updated')).toHaveTextContent(
      /Nov 14, 2023/,
    );
    // Susceptibility disclaimer present.
    expect(screen.getByRole('note')).toHaveTextContent(
      /does not confirm current flooding/i,
    );
  });

  it('renders the Flood_State via floodStateLabel for a report item (GRAY → "Unknown")', () => {
    render(
      <FloodPopup
        area="Sample Road"
        dataType="REPORT"
        state="GRAY"
        source="Demo Reports"
        updatedAt={1_700_000_000}
      />,
    );

    expect(screen.getByTestId('flood-popup-state')).toHaveTextContent(
      floodStateLabel('GRAY'),
    );
    expect(screen.getByTestId('flood-popup-state')).toHaveTextContent(
      'Unknown',
    );
    // General disclaimer present for reports.
    expect(screen.getByRole('note')).toHaveTextContent(/not a guarantee/i);
  });

  it('labels every Flood_State via the approved vocabulary', () => {
    const states: FloodState[] = ['RED', 'ORANGE', 'YELLOW', 'GREEN', 'GRAY'];
    for (const state of states) {
      const { unmount } = render(
        <FloodPopup
          area="X"
          dataType="REPORT"
          state={state}
          source="src"
          updatedAt={1_700_000_000}
        />,
      );
      expect(screen.getByTestId('flood-popup-state')).toHaveTextContent(
        floodStateLabel(state),
      );
      unmount();
    }
  });

  it('contains no banned safety language', () => {
    render(
      <FloodPopup
        area="Marikina Riverbanks"
        dataType="SUSCEPTIBILITY"
        level="HIGH"
        source="Demo Hazard Dataset"
        updatedAt={1_700_000_000}
      />,
    );
    expectNoBannedLanguage(
      screen.getByTestId('flood-popup').textContent ?? '',
    );
  });
});
