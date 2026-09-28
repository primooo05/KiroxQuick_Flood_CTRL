import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ViewModeControl } from './ViewModeControl';

describe('ViewModeControl', () => {
  it('exposes an accessible toggle reflecting the current mode', () => {
    const { rerender } = render(<ViewModeControl is3D={false} onToggle={vi.fn()} />);
    const button = screen.getByRole('button', { name: '3D view' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    rerender(<ViewModeControl is3D onToggle={vi.fn()} />);
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('requests the opposite mode when activated (click or keyboard)', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<ViewModeControl is3D={false} onToggle={onToggle} />);
    await user.click(screen.getByRole('button', { name: '3D view' }));
    expect(onToggle).toHaveBeenLastCalledWith(true);
    await user.keyboard('{Enter}');
    expect(onToggle).toHaveBeenCalledTimes(2);
  });
});
