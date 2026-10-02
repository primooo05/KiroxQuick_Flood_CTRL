// src/components/insights/DistributionBar.tsx
//
// A simple horizontal distribution bar for a set of labeled, colored counts
// (e.g. NCR / city historical class breakdown). Non-decorative: each segment
// carries an accessible label so meaning never relies on color alone.

export interface DistributionSegment {
  key: string;
  label: string;
  count: number;
  color: string;
}

export interface DistributionBarProps {
  segments: readonly DistributionSegment[];
  className?: string;
}

export function DistributionBar({ segments, className }: DistributionBarProps) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.count), 0) || 1;
  return (
    <div
      className={['baharoute-distbar', className].filter(Boolean).join(' ')}
      data-testid="distribution-bar"
      role="img"
      aria-label={segments
        .map((s) => `${s.label} ${s.count} (${Math.round((s.count / total) * 100)}%)`)
        .join(', ')}
    >
      {segments.map((s) => {
        const pct = (Math.max(0, s.count) / total) * 100;
        if (pct <= 0) return null;
        return (
          <span
            key={s.key}
            className="baharoute-distbar__seg"
            style={{ width: `${pct}%`, backgroundColor: s.color }}
            title={`${s.label}: ${s.count}`}
          />
        );
      })}
    </div>
  );
}

export default DistributionBar;
