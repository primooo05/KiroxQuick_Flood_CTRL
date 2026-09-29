// src/components/controls/MapContextControl.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MapContextControl } from './MapContextControl';

describe('MapContextControl', () => {
  it('renders a MAP CONTEXT radiogroup with both options', () => {
    render(<MapContextControl value="ncr-only" onChange={() => {}} />);
    expect(screen.getByTestId('map-context-control')).toHaveTextContent(/map context/i);
    expect(screen.getByTestId('map-context-ncr-only')).toBeInTheDocument();
    expect(screen.getByTestId('map-context-nearby')).toBeInTheDocument();
  });

  it('reflects the selected value (NCR only by default)', () => {
    render(<MapContextControl value="ncr-only" onChange={() => {}} />);
    expect(
      (screen.getByTestId('map-context-ncr-only') as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByTestId('map-context-nearby') as HTMLInputElement).checked,
    ).toBe(false);
  });

  it('calls onChange with the picked mode', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MapContextControl value="ncr-only" onChange={onChange} />);
    await user.click(screen.getByTestId('map-context-nearby'));
    expect(onChange).toHaveBeenCalledWith('nearby');
  });
});
