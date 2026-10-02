// src/components/primaryLeftPanel.ts
//
// Pure decision for which SINGLE panel occupies the desktop left rail (and the
// mobile bottom sheet). Exactly one panel is ever primary, by priority, so two
// full panels can never stack on top of each other (the overlap bug). Kept pure
// + separate from MapView so the exclusivity rule is unit-testable.

/** The panel that currently owns the left rail, or `null` for none. */
export type PrimaryLeftPanel = 'insights' | 'compare' | 'explore' | 'search' | null;

/** The inputs the decision reads (all already-derived MapView state). */
export interface PrimaryLeftPanelInput {
  /** True when the app shell is in its error phase. */
  readonly isError: boolean;
  /** True while Driver Mode is active (panels are replaced by the HUD). */
  readonly driving: boolean;
  /** True when a barangay is selected (Flood Insights). */
  readonly barangaySelected: boolean;
  /** True while comparing routes. */
  readonly comparing: boolean;
  /** True while the trip search step is active. */
  readonly searching: boolean;
  /** True when the Historical layer is visible (explore panel eligible). */
  readonly historicalVisible: boolean;
}

/**
 * Resolves the single primary left panel by priority:
 *   error/driving → none;
 *   barangay selected → Flood Insights;
 *   comparing → Route Compare;
 *   historical visible → Historical Explore;
 *   searching → Route Search;
 *   otherwise → none.
 */
export function resolvePrimaryLeftPanel(
  input: PrimaryLeftPanelInput,
): PrimaryLeftPanel {
  if (input.isError || input.driving) return null;
  if (input.barangaySelected) return 'insights';
  if (input.comparing) return 'compare';
  if (input.historicalVisible) return 'explore';
  if (input.searching) return 'search';
  return null;
}
