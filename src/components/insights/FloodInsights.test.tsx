// src/components/insights/FloodInsights.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FloodInsights } from './FloodInsights';
import type { BarangayInfoPanelProps } from '../overlays/BarangayInfoPanel';
import { historicalRiskRecords } from '../../data/historical/ncrHistoricalFloodRisk';

const currentProps: BarangayInfoPanelProps = {
  barangayName: 'Commonwealth',
  cityName: 'Quezon City',
  currentRisk: 'ELEVATED',
  reason: 'Rainfall increasing over a historically flood-prone area.',
  confidence: 'medium',
  signals: [
    { key: 'rainfall', text: 'Rainfall increasing' },
    { key: 'susceptibility', text: 'Moderate historical susceptibility' },
  ],
  rainfallNowMmHr: 8.4,
  trend: 'rising',
  rainfallNext30MmHr: 10.1,
  rainfallNext60MmHr: 7.6,
  baselineSusceptibility: 'MODERATE',
  recentReportCount: 0,
  officialStatus: 'Not confirmed',
  lastUpdated: Math.floor(Date.now() / 1000) - 60,
  freshness: 'live',
  source: 'Estimated rainfall — Open-Meteo',
  timelineStep: 'now',
};

const historicalRecord = historicalRiskRecords.find(
  (r) => r.historicalRiskClass === 'High',
)!;

function setup(overrides: Partial<React.ComponentProps<typeof FloodInsights>> = {}) {
  const onTabChange = vi.fn();
  const onTimelineStep = vi.fn();
  const onClose = vi.fn();
  const onSheetStateChange = vi.fn();
  render(
    <FloodInsights
      barangayName="Commonwealth"
      cityName="Quezon City"
      tab="current"
      onTabChange={onTabChange}
      current={currentProps}
      historical={historicalRecord}
      timelineStep="now"
      onTimelineStep={onTimelineStep}
      onClose={onClose}
      sheetState="half"
      onSheetStateChange={onSheetStateChange}
      {...overrides}
    />,
  );
  return { onTabChange, onTimelineStep, onClose, onSheetStateChange };
}

describe('FloodInsights (unified panel)', () => {
  it('renders barangay + city header and both tabs', () => {
    setup();
    expect(screen.getByTestId('insights-barangay')).toHaveTextContent('Commonwealth');
    expect(screen.getByTestId('insights-city')).toHaveTextContent('Quezon City');
    expect(screen.getByTestId('insights-tab-current')).toBeInTheDocument();
    expect(screen.getByTestId('insights-tab-historical')).toBeInTheDocument();
  });

  it('marks the active tab with aria-selected and switches on click', async () => {
    const { onTabChange } = setup();
    expect(screen.getByTestId('insights-tab-current')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.click(screen.getByTestId('insights-tab-historical'));
    expect(onTabChange).toHaveBeenCalledWith('historical');
  });

  it('shows the Current tab content when tab=current', () => {
    setup({ tab: 'current' });
    expect(screen.getByTestId('current-tab')).toBeInTheDocument();
    expect(screen.getByTestId('current-risk-level')).toHaveTextContent('ELEVATED');
    // Rainfall metrics visible.
    expect(screen.getByTestId('current-rainfall-now')).toHaveTextContent('8.4 mm/hr');
  });

  it('shows the Historical tab content when tab=historical', () => {
    setup({ tab: 'historical' });
    expect(screen.getByTestId('historical-tab')).toBeInTheDocument();
    expect(screen.getByTestId('historical-class')).toHaveTextContent('HIGH');
  });

  it('cross-references current vs historical on the Current tab', () => {
    setup({ tab: 'current' });
    const crossref = screen.getByTestId('current-crossref');
    expect(crossref).toHaveTextContent('Current risk');
    expect(crossref).toHaveTextContent('Historical susceptibility');
    expect(crossref).toHaveTextContent(/does not indicate current flooding/i);
  });

  it('supports arrow-key navigation between tabs (WAI-ARIA tabs pattern)', async () => {
    const { onTabChange } = setup({ tab: 'current' });
    const tablist = screen.getByRole('tablist');
    tablist.focus();
    await userEvent.type(screen.getByTestId('insights-tab-current'), '{ArrowRight}');
    expect(onTabChange).toHaveBeenCalledWith('historical');
    await userEvent.type(screen.getByTestId('insights-tab-historical'), '{ArrowLeft}');
    expect(onTabChange).toHaveBeenCalledWith('current');
  });

  it('close button fires onClose', async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByTestId('insights-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('mobile handle cycles the sheet state', async () => {
    const { onSheetStateChange } = setup({ sheetState: 'half' });
    await userEvent.click(screen.getByTestId('insights-handle'));
    expect(onSheetStateChange).toHaveBeenCalledWith('full');
  });

  it('Current tab shows an unavailable message and no fabricated Low when data is unavailable', () => {
    setup({
      tab: 'current',
      current: { ...currentProps, currentRisk: 'UNKNOWN', freshness: 'unavailable' },
    });
    expect(screen.getByTestId('current-unavailable')).toBeInTheDocument();
    // Never shows Low; shows Unavailable label.
    const card = screen.getByTestId('current-status-card');
    expect(within(card).getByTestId('current-risk-level')).not.toHaveTextContent('LOW');
  });

  it('Historical tab shows an unavailable message for an uncovered barangay', () => {
    setup({ tab: 'historical', historical: null });
    expect(screen.getByTestId('historical-unavailable')).toBeInTheDocument();
  });
});
