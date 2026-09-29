// src/components/overlays/LiveStatusPill.tsx
//
// A compact live-data status indicator (Phase 2, Req 4). Replaces the large
// warning box. Three states, always small and unobtrusive:
//   ● Live — updated 2 min ago
//   ⚠ Data stale — last updated 18 min ago
//   ⚠ Live rainfall unavailable
//
// It never says "showing last known values" — the barangay panel decides what
// to show; this pill only reports freshness honestly.

import type { DataFreshness } from '../../types/risk';
import { formatRelativeTime } from '../../layers/riskLabels';

export interface LiveStatusPillProps {
  freshness: DataFreshness;
  lastUpdated: number | null;
  className?: string;
}

export function LiveStatusPill({
  freshness,
  lastUpdated,
  className,
}: LiveStatusPillProps) {
  const live = freshness === 'live' || freshness === 'recent';
  const stale = freshness === 'stale';

  const dotClass = live
    ? 'baharoute-status-pill__dot--live'
    : 'baharoute-status-pill__dot--warn';

  let text: string;
  if (freshness === 'unavailable') {
    text = 'Live rainfall unavailable';
  } else if (stale) {
    text = `Data stale — last updated ${formatRelativeTime(lastUpdated)}`;
  } else {
    text = `Live — updated ${formatRelativeTime(lastUpdated)}`;
  }

  return (
    <div
      className={['baharoute-status-pill', className].filter(Boolean).join(' ')}
      data-testid="live-status-pill"
      data-freshness={freshness}
      role="status"
    >
      <span
        aria-hidden="true"
        className={`baharoute-status-pill__dot ${dotClass}`}
      >
        {live ? '●' : '⚠'}
      </span>
      <span className="baharoute-status-pill__text">{text}</span>
    </div>
  );
}

export default LiveStatusPill;
