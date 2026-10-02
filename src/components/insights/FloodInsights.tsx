// src/components/insights/FloodInsights.tsx
//
// The unified contextual panel for a selected barangay. One panel, two tabs —
// [ Current ] [ Historical ] — so users can inspect both for the same barangay
// without two competing panels. This is a UI GROUPING ONLY; the datasets stay
// separate (current-risk controller vs static historical dataset) and are never
// merged.
//
// On mobile this renders as a bottom sheet (collapsed / half / full); the sheet
// state is owned here so the header doubles as the drag/expand affordance.

import { useId } from 'react';
import type { BarangayInfoPanelProps } from '../overlays/BarangayInfoPanel';
import type { BarangayHistoricalRisk } from '../../data/historical/ncrHistoricalFloodRisk';
import type { HistoricalRiskClass } from '../../data/historical/ncrHistoricalFloodRisk';
import type { TimelineStep } from '../../types/risk';
import { currentRiskLabel } from '../../layers/riskLabels';
import { TimelineControl } from '../controls/TimelineControl';
import { CurrentTab } from './CurrentTab';
import { HistoricalTab } from './HistoricalTab';

/** Which tab is active. */
export type InsightsTab = 'current' | 'historical';

/** Mobile bottom-sheet height state. */
export type SheetState = 'collapsed' | 'half' | 'full';

export interface FloodInsightsProps {
  /** Barangay display name (always known once selected). */
  barangayName: string;
  /** Parent city / LGU name. */
  cityName: string;
  /** Active tab. */
  tab: InsightsTab;
  onTabChange: (tab: InsightsTab) => void;
  /** Current-conditions props (from BarangayRiskController.infoFor), or null. */
  current: BarangayInfoPanelProps | null;
  /** Static historical record for this barangay, or null when uncovered. */
  historical: BarangayHistoricalRisk | null;
  /** Timeline step for the Current tab. */
  timelineStep: TimelineStep;
  onTimelineStep: (step: TimelineStep) => void;
  /** Close the panel. */
  onClose: () => void;
  /** Mobile sheet state + setter (desktop ignores it via CSS). */
  sheetState?: SheetState;
  onSheetStateChange?: (s: SheetState) => void;
  className?: string;
}

export function FloodInsights({
  barangayName,
  cityName,
  tab,
  onTabChange,
  current,
  historical,
  timelineStep,
  onTimelineStep,
  onClose,
  sheetState = 'half',
  onSheetStateChange,
  className,
}: FloodInsightsProps) {
  const currentTabId = useId();
  const historicalTabId = useId();
  const currentPanelId = useId();
  const historicalPanelId = useId();

  const historicalClass: HistoricalRiskClass | null =
    historical?.historicalRiskClass ?? null;

  // A one-line collapsed summary for the mobile sheet handle.
  const collapsedSummary =
    tab === 'current' && current
      ? `Current risk: ${currentRiskLabel(current.currentRisk)}`
      : historicalClass
        ? `Historical: ${historicalClass}`
        : 'Flood insights';

  const cycleSheet = (): void => {
    if (!onSheetStateChange) return;
    const next: SheetState =
      sheetState === 'collapsed' ? 'half' : sheetState === 'half' ? 'full' : 'collapsed';
    onSheetStateChange(next);
  };

  // WAI-ARIA tabs keyboard pattern: Left/Right (and Home/End) move between tabs.
  const onTabsKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowRight' || e.key === 'End') {
      e.preventDefault();
      onTabChange('historical');
    } else if (e.key === 'ArrowLeft' || e.key === 'Home') {
      e.preventDefault();
      onTabChange('current');
    }
  };

  return (
    <section
      className={['baharoute-insights', className].filter(Boolean).join(' ')}
      data-testid="flood-insights"
      data-sheet={sheetState}
      aria-label={`Flood insights for ${barangayName}, ${cityName}`}
    >
      {/* Drag handle / expand affordance (mobile). Keyboard-operable. */}
      <button
        type="button"
        className="baharoute-insights__handle baharoute-focus-ring"
        data-testid="insights-handle"
        aria-label={
          sheetState === 'full'
            ? 'Collapse flood insights'
            : 'Expand flood insights'
        }
        onClick={cycleSheet}
      >
        <span aria-hidden="true" className="baharoute-insights__grip" />
        <span className="baharoute-insights__collapsed-summary">{collapsedSummary}</span>
      </button>

      <div className="baharoute-insights__head">
        <div>
          <h2 className="baharoute-insights__title" data-testid="insights-barangay">
            {barangayName}
          </h2>
          <p className="baharoute-insights__city" data-testid="insights-city">
            {cityName}
          </p>
        </div>
        <button
          type="button"
          className="baharoute-insights__close baharoute-icon-button baharoute-focus-ring"
          aria-label="Close flood insights"
          data-testid="insights-close"
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      {/* Tabs */}
      <div
        className="baharoute-insights__tabs"
        role="tablist"
        aria-label="Flood insights view"
        onKeyDown={onTabsKeyDown}
      >
        <button
          type="button"
          role="tab"
          id={currentTabId}
          aria-selected={tab === 'current'}
          aria-controls={currentPanelId}
          tabIndex={tab === 'current' ? 0 : -1}
          className={`baharoute-insights__tab baharoute-focus-ring${
            tab === 'current' ? ' baharoute-insights__tab--active' : ''
          }`}
          data-testid="insights-tab-current"
          onClick={() => onTabChange('current')}
        >
          Current
        </button>
        <button
          type="button"
          role="tab"
          id={historicalTabId}
          aria-selected={tab === 'historical'}
          aria-controls={historicalPanelId}
          tabIndex={tab === 'historical' ? 0 : -1}
          className={`baharoute-insights__tab baharoute-focus-ring${
            tab === 'historical' ? ' baharoute-insights__tab--active' : ''
          }`}
          data-testid="insights-tab-historical"
          onClick={() => onTabChange('historical')}
        >
          Historical
        </button>
      </div>

      {/* Current panel */}
      {tab === 'current' && (
        <div role="tabpanel" id={currentPanelId} aria-labelledby={currentTabId}>
          <TimelineControl step={timelineStep} onStepChange={onTimelineStep} />
          {current ? (
            <CurrentTab info={current} historicalClass={historicalClass} />
          ) : (
            <p className="baharoute-insights__empty" data-testid="current-none">
              Current flood information is temporarily unavailable. Historical
              information may still be available.
            </p>
          )}
        </div>
      )}

      {/* Historical panel */}
      {tab === 'historical' && (
        <div role="tabpanel" id={historicalPanelId} aria-labelledby={historicalTabId}>
          <HistoricalTab record={historical} />
        </div>
      )}
    </section>
  );
}

export default FloodInsights;
