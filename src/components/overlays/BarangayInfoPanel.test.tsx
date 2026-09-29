// src/components/overlays/BarangayInfoPanel.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BarangayInfoPanel, type BarangayInfoPanelProps } from './BarangayInfoPanel';

const base: BarangayInfoPanelProps = {
  barangayName: 'Commonwealth',
  cityName: 'Quezon City',
  currentRisk: 'HIGH',
  reason: 'Heavy rainfall is affecting a historically flood-prone area.',
  confidence: 'medium',
  signals: [
    { key: 'rainfall', text: 'Heavy rainfall detected' },
    { key: 'susceptibility', text: 'High historical susceptibility' },
  ],
  rainfallNowMmHr: 18.2,
  trend: 'rising',
  rainfallNext30MmHr: 20,
  rainfallNext60MmHr: 22,
  baselineSusceptibility: 'HIGH',
  recentReportCount: 2,
  officialStatus: 'Not confirmed',
  lastUpdated: Math.floor(Date.now() / 1000) - 120,
  freshness: 'live',
  source: 'Estimated rainfall — Open-Meteo',
  timelineStep: 'now',
};

describe('BarangayInfoPanel (commuter redesign)', () => {
  it('leads with barangay, city, current risk, and a short explanation', () => {
    render(<BarangayInfoPanel {...base} />);
    expect(screen.getByTestId('barangay-name')).toHaveTextContent('Commonwealth');
    expect(screen.getByTestId('barangay-city')).toHaveTextContent('Quezon City');
    expect(screen.getByTestId('barangay-current-risk')).toHaveTextContent('HIGH');
    expect(screen.getByTestId('barangay-explain')).toHaveTextContent(
      /historically flood-prone/i,
    );
  });

  it('shows the 3 primary metrics', () => {
    render(<BarangayInfoPanel {...base} />);
    expect(screen.getByTestId('barangay-rainfall')).toHaveTextContent('18.2 mm/hr');
    expect(screen.getByTestId('barangay-trend')).toHaveTextContent('Rising');
    expect(screen.getByTestId('barangay-baseline')).toHaveTextContent('High');
  });

  it('renders Why this risk from the actual signals', () => {
    render(<BarangayInfoPanel {...base} />);
    const why = screen.getByTestId('barangay-why');
    expect(why).toHaveTextContent('Heavy rainfall detected');
    expect(why).toHaveTextContent('High historical susceptibility');
  });

  it('hides secondary details until More details is expanded', async () => {
    const user = userEvent.setup();
    render(<BarangayInfoPanel {...base} />);
    expect(screen.getByTestId('barangay-forecast')).not.toBeVisible();
    await user.click(screen.getByTestId('barangay-more-toggle'));
    expect(screen.getByTestId('barangay-forecast')).toBeVisible();
    expect(screen.getByTestId('barangay-confidence')).toHaveTextContent('Medium');
  });

  it('UNKNOWN never shows a classified level or a fabricated rainfall value', () => {
    render(
      <BarangayInfoPanel
        {...base}
        currentRisk="UNKNOWN"
        rainfallNowMmHr={null}
        freshness="unavailable"
        lastUpdated={null}
      />,
    );
    const risk = screen.getByTestId('barangay-current-risk').textContent ?? '';
    // Must not read as a low/elevated/high severity.
    expect(risk).not.toMatch(/\b(LOW|ELEVATED|HIGH)\b/);
    expect(screen.getByTestId('barangay-explain')).toHaveTextContent(
      /data unavailable/i,
    );
    expect(screen.getByTestId('barangay-rainfall')).toHaveTextContent('Unavailable');
  });

  it('never uses banned safety language', () => {
    render(<BarangayInfoPanel {...base} />);
    const text = screen.getByTestId('barangay-info-panel').textContent ?? '';
    expect(text).not.toMatch(/\bsafe\b|\bclear\b|no risk/i);
  });
});
