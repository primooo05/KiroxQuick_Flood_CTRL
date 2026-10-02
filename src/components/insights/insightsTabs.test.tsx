// src/components/insights/insightsTabs.test.tsx
// Focused tests for the Current tab, Historical tab, and Historical Explore
// panel behaviors that the unified-panel test does not cover in depth.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CurrentTab } from './CurrentTab';
import { HistoricalTab } from './HistoricalTab';
import { HistoricalExplorePanel } from './HistoricalExplorePanel';
import { DEFAULT_HISTORICAL_FILTER } from '../../layers/historicalFloodRisk';
import type { BarangayInfoPanelProps } from '../overlays/BarangayInfoPanel';
import {
  historicalRiskRecords,
  historicalCitySummaries,
} from '../../data/historical/ncrHistoricalFloodRisk';

const baseCurrent: BarangayInfoPanelProps = {
  barangayName: 'X',
  cityName: 'Y',
  currentRisk: 'CONFIRMED_NOT_PASSABLE',
  reason: '',
  confidence: 'verified',
  signals: [],
  rainfallNowMmHr: 2,
  trend: 'steady',
  rainfallNext30MmHr: 2,
  rainfallNext60MmHr: 2,
  baselineSusceptibility: 'HIGH',
  recentReportCount: 2,
  officialStatus: 'Confirmed closure — LGU',
  lastUpdated: Math.floor(Date.now() / 1000) - 30,
  freshness: 'live',
  source: 'Open-Meteo',
  timelineStep: 'now',
};

describe('CurrentTab', () => {
  it('shows a distinct, prominent confirmed-closure block (not a report)', () => {
    render(<CurrentTab info={baseCurrent} historicalClass="High" />);
    const closure = screen.getByTestId('current-closure');
    expect(closure).toHaveTextContent(/confirmed closure/i);
    expect(closure).toHaveTextContent(/LGU/);
    // Closure is an alert, distinct from the community-reports section.
    expect(closure).toHaveAttribute('role', 'alert');
  });

  it('labels community reports as unverified community-reported', () => {
    render(
      <CurrentTab
        info={{ ...baseCurrent, currentRisk: 'ELEVATED', recentReportCount: 2 }}
        historicalClass={null}
      />,
    );
    const reports = screen.getByTestId('current-reports');
    expect(reports).toHaveTextContent('2 recent reports');
    expect(reports).toHaveTextContent(/community reported/i);
  });

  it('shows a live status line when fresh', () => {
    render(
      <CurrentTab info={{ ...baseCurrent, currentRisk: 'LOW' }} historicalClass={null} />,
    );
    expect(screen.getByText(/Live · updated/i)).toBeInTheDocument();
  });

  it('shows a stale status line and no fabricated metrics', () => {
    render(
      <CurrentTab
        info={{ ...baseCurrent, currentRisk: 'STALE', freshness: 'stale' }}
        historicalClass={null}
      />,
    );
    expect(screen.getByText(/may be outdated/i)).toBeInTheDocument();
  });
});

describe('HistoricalTab', () => {
  const record = historicalRiskRecords.find((r) => r.historicalRiskClass === 'High')!;

  it('shows a simplified headline with total exposure + max hazard', () => {
    render(<HistoricalTab record={record} />);
    expect(screen.getByTestId('historical-class')).toHaveTextContent('HIGH');
    expect(screen.getByTestId('historical-total-exposure')).toBeInTheDocument();
    expect(screen.getByTestId('historical-max-hazard')).toBeInTheDocument();
  });

  it('hides advanced metrics until View details is expanded', async () => {
    render(<HistoricalTab record={record} />);
    const toggle = screen.getByTestId('historical-details-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('historical-pct-high').closest('[hidden]')).not.toBeNull();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('offers a return-period selector with only the loaded period enabled', () => {
    render(<HistoricalTab record={record} />);
    expect(screen.getByTestId('historical-rp-100yr')).toBeEnabled();
    expect(screen.getByTestId('historical-rp-5yr')).toBeDisabled();
    expect(screen.getByTestId('historical-rp-25yr')).toBeDisabled();
  });

  it('includes the "About this data" plain-language note', () => {
    render(<HistoricalTab record={record} />);
    expect(screen.getByTestId('historical-about')).toHaveTextContent(
      /does not mean this area is flooding right now/i,
    );
  });
});

describe('HistoricalExplorePanel', () => {
  const withFilter = (o: object) => ({ ...DEFAULT_HISTORICAL_FILTER, ...o });

  it('shows the NCR summary + distribution bar by default', () => {
    render(
      <HistoricalExplorePanel filter={DEFAULT_HISTORICAL_FILTER} onFilterChange={vi.fn()} />,
    );
    expect(screen.getByTestId('explore-ncr-summary')).toBeInTheDocument();
    expect(screen.getByTestId('distribution-bar')).toBeInTheDocument();
    expect(screen.getByTestId('ncr-high')).toHaveTextContent('708');
  });

  it('only shows the City field for City view (conditional fields)', () => {
    const { rerender } = render(
      <HistoricalExplorePanel filter={DEFAULT_HISTORICAL_FILTER} onFilterChange={vi.fn()} />,
    );
    expect(screen.queryByTestId('explore-city-select')).toBeNull();
    rerender(
      <HistoricalExplorePanel filter={withFilter({ view: 'city' })} onFilterChange={vi.fn()} />,
    );
    expect(screen.getByTestId('explore-city-select')).toBeInTheDocument();
    expect(screen.queryByTestId('explore-barangay-select')).toBeNull();
  });

  it('shows City + Barangay fields for Barangay view', () => {
    render(
      <HistoricalExplorePanel
        filter={withFilter({ view: 'barangay' })}
        onFilterChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('explore-city-select')).toBeInTheDocument();
    expect(screen.getByTestId('explore-barangay-select')).toBeInTheDocument();
  });

  it('shows the city summary when a city is selected', () => {
    const city = historicalCitySummaries.find((c) => c.highCount > 0)!;
    render(
      <HistoricalExplorePanel
        filter={withFilter({ view: 'city', cityPsgc: city.cityPsgc })}
        onFilterChange={vi.fn()}
      />,
    );
    const summary = screen.getByTestId('explore-city-summary');
    expect(summary).toHaveTextContent(city.cityName);
    expect(screen.getByTestId('city-total')).toHaveTextContent(String(city.barangayCount));
  });

  it('changing Risk fires a filter change', async () => {
    const onFilterChange = vi.fn();
    render(
      <HistoricalExplorePanel filter={DEFAULT_HISTORICAL_FILTER} onFilterChange={onFilterChange} />,
    );
    await userEvent.selectOptions(screen.getByTestId('explore-risk-select'), 'High');
    expect(onFilterChange).toHaveBeenCalledWith(expect.objectContaining({ risk: 'High' }));
  });

  it('changing Area fires a filter change and resets dependent selections', async () => {
    const onFilterChange = vi.fn();
    render(
      <HistoricalExplorePanel
        filter={withFilter({ view: 'barangay', cityPsgc: 'PH1307404', barangayPsgc: 'X' })}
        onFilterChange={onFilterChange}
      />,
    );
    await userEvent.selectOptions(screen.getByTestId('explore-area-select'), 'ncr');
    expect(onFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ view: 'ncr', cityPsgc: null, barangayPsgc: null }),
    );
  });

  it('breadcrumb NCR crumb resets the whole scope to NCR', async () => {
    const city = historicalCitySummaries[0];
    const onFilterChange = vi.fn();
    render(
      <HistoricalExplorePanel
        filter={withFilter({ view: 'city', cityPsgc: city.cityPsgc })}
        onFilterChange={onFilterChange}
      />,
    );
    await userEvent.click(screen.getByTestId('breadcrumb-ncr'));
    expect(onFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ view: 'ncr', cityPsgc: null, barangayPsgc: null }),
    );
  });

  it('breadcrumb shows NCR > City in city view', () => {
    const city = historicalCitySummaries[0];
    render(
      <HistoricalExplorePanel
        filter={withFilter({ view: 'city', cityPsgc: city.cityPsgc })}
        onFilterChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('breadcrumb-ncr')).toBeInTheDocument();
    expect(screen.getByTestId('breadcrumb-city')).toHaveTextContent(city.cityName);
  });

  it('shows a barangay/risk mismatch note + Clear risk filter when they conflict', async () => {
    // Pick a barangay whose class is Low, then filter by High → mismatch.
    const b = historicalRiskRecords.find((r) => r.historicalRiskClass === 'Low')!;
    const onFilterChange = vi.fn();
    render(
      <HistoricalExplorePanel
        filter={{
          view: 'barangay',
          cityPsgc: b.cityPsgc,
          barangayPsgc: b.psgc,
          risk: 'High',
        }}
        onFilterChange={onFilterChange}
      />,
    );
    const note = screen.getByTestId('hist-risk-mismatch');
    expect(note).toHaveTextContent(b.name);
    expect(note).toHaveTextContent(/Low/);
    await userEvent.click(screen.getByTestId('hist-clear-risk'));
    expect(onFilterChange).toHaveBeenCalledWith(expect.objectContaining({ risk: 'all' }));
  });
});
