import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DrivingHud } from './DrivingHud';
import { computeNavState } from '../../simulation/navigation';
import { PITX_TO_MOA_DISTANCE_M, PITX_TO_MOA_MANEUVERS } from '../../data/fixtures/pitxToMoaRoute';
import { PITX_TO_MOA_HAZARDS } from '../../data/fixtures/driveHazards';

function setup(traveled: number) {
  const props = {
    nav: computeNavState(
      traveled,
      PITX_TO_MOA_DISTANCE_M,
      PITX_TO_MOA_MANEUVERS,
      PITX_TO_MOA_HAZARDS,
      10,
    ),
    camera: 'driver' as const,
    radius: 250 as const,
    onCameraChange: vi.fn(),
    onRadiusChange: vi.fn(),
    onStop: vi.fn(),
  };
  render(<DrivingHud {...props} />);
  return props;
}

describe('DrivingHud', () => {
  it('shows the next turn, trip progress, and no hazard when none is near', () => {
    setup(0);
    expect(screen.getByText('Turn left onto Quirino Avenue')).toBeInTheDocument();
    expect(screen.getByText(/ETA/)).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('labels a hazard ahead with state text and the demo/unconfirmed source', () => {
    setup(PITX_TO_MOA_HAZARDS[0].atM - 400);
    const chip = screen.getByRole('status');
    expect(chip).toHaveTextContent('Reported Flooding ahead');
    expect(chip).toHaveTextContent('400 m');
    expect(chip).toHaveTextContent('DEMO — unconfirmed');
    expect(chip.textContent ?? '').not.toMatch(/safe|clear/i);
  });

  it('exposes camera + radius options and Stop as accessible buttons', async () => {
    const user = userEvent.setup();
    const props = setup(0);
    expect(screen.getByRole('button', { name: 'Driver' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Follow' }));
    expect(props.onCameraChange).toHaveBeenCalledWith('follow');
    await user.click(screen.getByRole('button', { name: '3D radius 600 meters' }));
    expect(props.onRadiusChange).toHaveBeenCalledWith(600);
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(props.onStop).toHaveBeenCalled();
  });
});
