// src/components/overlays/ReportPopup.tsx
//
// Popup shown when a community report or an official closure marker is clicked
// (Phase 2, Req 10). Community reports are ALWAYS labeled "Unconfirmed
// community report" and are visually + textually distinct from official
// closures, which carry the confirming source. Never presents a community
// report as official.

import type { FloodState } from '../../types/flood';
import { floodStateLabel } from '../../layers/visualMapping';
import {
  CURRENT_RISK_COLORS,
  FLOOD_STATE_COLORS,
} from '../../map/basemap/colorTokens';
import { formatRelativeTime } from '../../layers/riskLabels';
import {
  reportFreshness,
  reportFreshnessLabel,
} from '../../services/reportResolution';
import { Disclaimer } from './Disclaimer';

export interface ReportPopupProps {
  kind: 'community' | 'official';
  /** Report severity/state (community reports). */
  state?: FloodState;
  /** Barangay name/label if resolved. */
  barangay?: string;
  /** Optional free-text note (official closures). */
  note?: string;
  /** Timestamp (epoch seconds). */
  updatedAt: number | null;
  /** Source label. */
  source: string;
  className?: string;
}

export function ReportPopup({
  kind,
  state,
  barangay,
  note,
  updatedAt,
  source,
  className,
}: ReportPopupProps) {
  const isOfficial = kind === 'official';
  const chipColor = isOfficial
    ? CURRENT_RISK_COLORS.CONFIRMED_NOT_PASSABLE.hex
    : state
      ? FLOOD_STATE_COLORS[state].hex
      : FLOOD_STATE_COLORS.GRAY.hex;

  return (
    <section
      className={['baharoute-report-popup', className].filter(Boolean).join(' ')}
      aria-label={isOfficial ? 'Official closure' : 'Community report'}
      data-testid="report-popup"
      data-kind={kind}
    >
      <p className="baharoute-flood-popup__chip">
        <span
          aria-hidden="true"
          className="baharoute-flood-popup__swatch"
          style={{ backgroundColor: chipColor }}
        />
        {isOfficial
          ? 'Confirmed Closure'
          : state
            ? floodStateLabel(state)
            : 'Community report'}
      </p>

      <dl className="baharoute-flood-popup__fields">
        {barangay && (
          <>
            <dt>Barangay</dt>
            <dd data-testid="report-barangay">{barangay}</dd>
          </>
        )}

        <dt>Status</dt>
        <dd data-testid="report-status">
          {isOfficial ? 'Official confirmation' : 'Unconfirmed community report'}
        </dd>

        {note && (
          <>
            <dt>Note</dt>
            <dd data-testid="report-note">{note}</dd>
          </>
        )}

        <dt>Reported</dt>
        <dd data-testid="report-time">{formatRelativeTime(updatedAt)}</dd>

        {/* Freshness cue (community reports only). Presentation-only — it never
            makes an unconfirmed report confirmed; expired reports already stop
            counting toward risk via the shared TTL. */}
        {!isOfficial && updatedAt !== null && (
          <>
            <dt>Freshness</dt>
            <dd data-testid="report-freshness">
              {reportFreshnessLabel(reportFreshness(updatedAt))}
            </dd>
          </>
        )}

        <dt>Source</dt>
        <dd data-testid="report-source">{source}</dd>
      </dl>

      <Disclaimer variant="general" />
    </section>
  );
}

export default ReportPopup;
