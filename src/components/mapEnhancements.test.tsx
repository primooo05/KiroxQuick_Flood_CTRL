// Enhancement tests: on-demand layers panel, collapsed-by-default legend, and
// the popup title/level chip.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LayersButton } from './controls/LayersButton';
import { MapLegend } from './overlays/MapLegend';
import { FloodPopup } from './overlays/FloodPopup';

describe('LayersButton', () => {
  it('starts closed, opens on click, and closes on Escape with focus returned', async () => {
    const user = userEvent.setup();
    render(
      <LayersButton>
        <p>layer list</p>
      </LayersButton>,
    );
    const button = screen.getByRole('button', { name: 'Map layers' });
    const panel = screen.getByTestId('layers-panel');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(panel).not.toBeVisible();

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(panel).toBeVisible();

    await user.keyboard('{Escape}');
    expect(panel).not.toBeVisible();
    expect(button).toHaveFocus();
  });

  it('closes via the panel close button', async () => {
    const user = userEvent.setup();
    render(
      <LayersButton defaultOpen>
        <p>layer list</p>
      </LayersButton>,
    );
    await user.click(screen.getByRole('button', { name: 'Close map layers' }));
    expect(screen.getByTestId('layers-panel')).not.toBeVisible();
  });
});

describe('MapLegend', () => {
  it('collapses/expands and shows current-risk labels; historical is a nested collapsed section when enabled', async () => {
    const user = userEvent.setup();
    // Force collapsed to exercise the toggle deterministically. Both layers on.
    render(<MapLegend defaultExpanded={false} showCurrent showHistorical />);
    const toggle = screen.getByTestId('map-legend-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByText('Elevated')[0]).not.toBeVisible();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // Current-risk labels are the PRIMARY visible legend.
    for (const label of ['Low', 'Elevated', 'High']) {
      const matches = screen.getAllByText(label);
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0]).toBeVisible();
    }

    // Historical susceptibility is a SEPARATE, collapsed reference sub-section.
    const historyToggle = screen.getByTestId('map-legend-history-toggle');
    expect(historyToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Moderate')).not.toBeVisible();
    await user.click(historyToggle);
    expect(historyToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Moderate')).toBeVisible();
  });

  it('shows ONLY the current section when historical is not enabled', () => {
    render(<MapLegend showCurrent showHistorical={false} />);
    expect(screen.getByTestId('map-legend-toggle')).toHaveTextContent(
      'Current Flood Risk',
    );
    expect(screen.queryByTestId('map-legend-history-toggle')).toBeNull();
  });

  it('shows the historical legend directly when only historical is enabled', () => {
    render(<MapLegend showCurrent={false} showHistorical />);
    expect(screen.getByTestId('map-legend-toggle')).toHaveTextContent(
      'Historical Flood Susceptibility',
    );
    // No current-risk-only labels like "Elevated" in historical-only mode.
    expect(screen.queryByText('Elevated')).toBeNull();
  });

  it('renders nothing when neither section is enabled', () => {
    const { container } = render(
      <MapLegend showCurrent={false} showHistorical={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('is expanded by default so current flood risk is the primary visible legend', () => {
    render(<MapLegend showCurrent />);
    expect(screen.getByTestId('map-legend-toggle')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('never uses banned safety language', () => {
    render(<MapLegend defaultExpanded />);
    const text = screen.getByTestId('map-legend').textContent ?? '';
    expect(text).not.toMatch(/\b(safe|clear|no risk|passable)\b/i);
  });
});

describe('FloodPopup enhancement', () => {
  it('leads with the area as a heading and a text level chip', () => {
    render(
      <FloodPopup
        area="Marikina"
        dataType="SUSCEPTIBILITY"
        level="HIGH"
        source="Demo fixture"
        updatedAt={1_700_000_000}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Marikina' })).toBeInTheDocument();
    expect(screen.getByText('High susceptibility')).toBeInTheDocument();
  });
});
