// src/components/trip/RouteSearchPanel.test.tsx
//
// The SEARCH step: choosing an origin/destination via place search, the
// current-location + select-on-map affordances, and the NCR-only find gate.

import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { RouteSearchPanel, type TripEndpoint } from './RouteSearchPanel';

/** A controlled harness so the panel's origin/destination are stateful. */
function Harness(props: {
  onFindRoutes?: (o: TripEndpoint, d: TripEndpoint) => void;
  onUseCurrentLocation?: () => void;
}) {
  const [origin, setOrigin] = useState<TripEndpoint | null>(null);
  const [destination, setDestination] = useState<TripEndpoint | null>(null);
  return (
    <RouteSearchPanel
      origin={origin}
      destination={destination}
      onOriginChange={setOrigin}
      onDestinationChange={setDestination}
      onUseCurrentLocation={props.onUseCurrentLocation}
      onPickOnMap={vi.fn()}
      onFindRoutes={props.onFindRoutes ?? vi.fn()}
    />
  );
}

describe('RouteSearchPanel', () => {
  it('shows a drag handle and collapses after a 75% downward drag, then reopens', () => {
    render(<Harness />);
    const panel = screen.getByTestId('route-search-panel');
    const handle = screen.getByRole('separator', { name: /drag down to close/i });
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ height: 400 } as DOMRect);
    Object.defineProperty(handle, 'setPointerCapture', { value: vi.fn() });
    Object.defineProperty(handle, 'hasPointerCapture', { value: () => false });

    const pointer = (type: string, clientY: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientY });
      Object.defineProperties(event, {
        pointerId: { value: 1 },
        pointerType: { value: 'touch' },
      });
      fireEvent(handle, event);
    };
    pointer('pointerdown', 100);
    pointer('pointermove', 400);
    pointer('pointerup', 400);

    expect(screen.queryByTestId('route-search-panel')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Baha-Route' }));
    expect(screen.getByTestId('route-search-panel')).toBeInTheDocument();
  });

  it('renders From/To fields and a hint (no manual Find routes button) initially', () => {
    render(<Harness />);
    expect(screen.getByTestId('search-field-origin')).toBeInTheDocument();
    expect(screen.getByTestId('search-field-destination')).toBeInTheDocument();
    // The flow is automatic: no manual Find routes button exists anymore.
    expect(screen.queryByTestId('find-routes-button')).toBeNull();
    expect(screen.getByTestId('search-hint')).toBeInTheDocument();
  });

  it('AUTOMATICALLY requests routes once both origin and destination are set', async () => {
    const onFindRoutes = vi.fn();
    const user = userEvent.setup();
    render(<Harness onFindRoutes={onFindRoutes} />);

    // Origin: focus the From input, pick a suggestion.
    await user.click(screen.getByLabelText('From'));
    await user.type(screen.getByLabelText('From'), 'PITX');
    const originList = screen.getByTestId('place-suggestions');
    await user.click(within(originList).getByText(/PITX/));

    // No request yet — destination still missing.
    expect(onFindRoutes).not.toHaveBeenCalled();

    // Destination: focus To, pick MOA — this completes the pair and auto-fires.
    await user.click(screen.getByLabelText('To'));
    await user.type(screen.getByLabelText('To'), 'Mall of Asia');
    const destList = screen.getByTestId('place-suggestions');
    await user.click(within(destList).getByText(/Mall of Asia/));

    expect(onFindRoutes).toHaveBeenCalledTimes(1);
    const [origin, destination] = onFindRoutes.mock.calls[0];
    expect(origin.label).toMatch(/PITX/);
    expect(destination.label).toMatch(/Mall of Asia/);
  });

  it('offers a Use current location action when provided', async () => {
    const onUseCurrentLocation = vi.fn();
    const user = userEvent.setup();
    render(<Harness onUseCurrentLocation={onUseCurrentLocation} />);
    await user.click(screen.getByRole('button', { name: /use current location/i }));
    expect(onUseCurrentLocation).toHaveBeenCalled();
  });

  it('shows an empty-state row when a query has no NCR match', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByLabelText('From'));
    await user.type(screen.getByLabelText('From'), 'zzzznowhere');
    expect(screen.getByText(/no matching places in ncr/i)).toBeInTheDocument();
  });
});
