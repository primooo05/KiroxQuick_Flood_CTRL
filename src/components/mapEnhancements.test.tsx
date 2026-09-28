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
  it('is collapsed by default and expands to show text labels for every color', async () => {
    const user = userEvent.setup();
    render(<MapLegend />);
    const toggle = screen.getByTestId('map-legend-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('High')).not.toBeVisible();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    for (const label of ['High', 'Moderate', 'Low', 'Unknown']) {
      expect(screen.getByText(label)).toBeVisible();
    }
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
