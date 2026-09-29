// src/components/controls/RotateControl.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RotateControl } from './RotateControl';

describe('RotateControl', () => {
  it('rotates clockwise and counter-clockwise by the step', async () => {
    const user = userEvent.setup();
    const onRotate = vi.fn();
    render(
      <RotateControl
        bearing={0}
        onRotate={onRotate}
        onResetNorth={() => {}}
        stepDeg={45}
      />,
    );
    await user.click(screen.getByTestId('rotate-cw'));
    expect(onRotate).toHaveBeenLastCalledWith(45);
    await user.click(screen.getByTestId('rotate-ccw'));
    expect(onRotate).toHaveBeenLastCalledWith(-45);
  });

  it('rotates the needle opposite the bearing so it points to north', () => {
    render(<RotateControl bearing={90} onRotate={() => {}} onResetNorth={() => {}} />);
    const needle = screen.getByTestId('rotate-compass-needle');
    expect(needle.style.transform).toBe('rotate(-90deg)');
  });

  it('resets to north when the compass is activated (and not at north)', async () => {
    const user = userEvent.setup();
    const onResetNorth = vi.fn();
    render(
      <RotateControl bearing={120} onRotate={() => {}} onResetNorth={onResetNorth} />,
    );
    await user.click(screen.getByTestId('rotate-compass'));
    expect(onResetNorth).toHaveBeenCalledTimes(1);
  });

  it('does not reset when already facing north', async () => {
    const user = userEvent.setup();
    const onResetNorth = vi.fn();
    render(
      <RotateControl bearing={0} onRotate={() => {}} onResetNorth={onResetNorth} />,
    );
    const compass = screen.getByTestId('rotate-compass');
    expect(compass).toHaveAttribute('aria-disabled', 'true');
    await user.click(compass);
    expect(onResetNorth).not.toHaveBeenCalled();
  });
});
