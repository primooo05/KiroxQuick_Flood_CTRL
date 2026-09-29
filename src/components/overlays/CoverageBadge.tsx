// src/components/overlays/CoverageBadge.tsx
//
// A subtle, always-visible coverage label making BahaRoute's scope explicit:
// the app covers Metro Manila / NCR ONLY. Paired with the opaque outside-NCR
// mask, this ensures a user can never reasonably think coverage extends beyond
// the National Capital Region. Purely presentational.

export interface CoverageBadgeProps {
  /** Visible + accessible label. Defaults to the NCR coverage statement. */
  label?: string;
  className?: string;
}

export function CoverageBadge({
  label = 'Coverage: Metro Manila / NCR',
  className,
}: CoverageBadgeProps = {}) {
  return (
    <span
      role="img"
      aria-label={label}
      className={['baharoute-coverage-badge', className].filter(Boolean).join(' ')}
      data-testid="coverage-badge"
    >
      {label}
    </span>
  );
}

export default CoverageBadge;
