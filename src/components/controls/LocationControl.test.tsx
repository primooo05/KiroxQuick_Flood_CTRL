// src/components/controls/LocationControl.test.tsx
//
// Verifies each LocationControl branch with an injected fake requestLocation:
// granted in-NCR → onLocated called, no "NCR only" message; granted out-of-NCR
// → onLocated + onOutsideNcr called AND the NCR-only message shown; denied /
// unavailable / timeout each show the correct message. Also checks the button
// is keyboard-focusable with an accessible name (Req 6.2–6.6, 11.1, 11.3).

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LocationControl } from './LocationControl';
import { LOCATION_MESSAGES } from './locationMessages';
import type { LocationResult } from '../../services/geolocation';

/** A fake requestLocation that always resolves to the given result. */
function fakeRequest(result: LocationResult) {
  return vi.fn(async () => result);
}

// A point inside METRO_MANILA_EXTENT ([[120.9, 14.4], [121.15, 14.78]]).
const IN_NCR = { lng: 121.0, lat: 14.6 };
// A point well outside the extent.
const OUTSIDE_NCR = { lng: 125.0, lat: 10.0 };

describe('LocationControl', () => {
  it('exposes a keyboard-focusable button with an accessible name (Req 11.1, 11.3)', () => {
    render(<LocationControl requestLocation={fakeRequest({ status: 'unavailable' })} />);
    const button = screen.getByRole('button', { name: 'Show my location' });
    expect(button).toBeInTheDocument();
    button.focus();
    expect(button).toHaveFocus();
  });

  it('granted in-NCR: calls onLocated with coords and shows no NCR-only message (Req 6.2)', async () => {
    const onLocated = vi.fn();
    const onOutsideNcr = vi.fn();
    const user = userEvent.setup();

    render(
      <LocationControl
        requestLocation={fakeRequest({ status: 'granted', ...IN_NCR })}
        onLocated={onLocated}
        onOutsideNcr={onOutsideNcr}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Show my location' }));

    await waitFor(() =>
      expect(onLocated).toHaveBeenCalledWith(IN_NCR.lng, IN_NCR.lat),
    );
    expect(onOutsideNcr).not.toHaveBeenCalled();
    expect(screen.queryByTestId('location-message')).not.toBeInTheDocument();
    expect(
      screen.queryByText(LOCATION_MESSAGES.outsideNcr),
    ).not.toBeInTheDocument();
  });

  it('granted outside NCR: calls onLocated + onOutsideNcr and shows the NCR-only message (Req 6.6)', async () => {
    const onLocated = vi.fn();
    const onOutsideNcr = vi.fn();
    const user = userEvent.setup();

    render(
      <LocationControl
        requestLocation={fakeRequest({ status: 'granted', ...OUTSIDE_NCR })}
        onLocated={onLocated}
        onOutsideNcr={onOutsideNcr}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Show my location' }));

    await waitFor(() =>
      expect(onLocated).toHaveBeenCalledWith(OUTSIDE_NCR.lng, OUTSIDE_NCR.lat),
    );
    expect(onOutsideNcr).toHaveBeenCalledWith(OUTSIDE_NCR.lng, OUTSIDE_NCR.lat);
    expect(await screen.findByText(LOCATION_MESSAGES.outsideNcr)).toBeInTheDocument();
  });

  it('denied: shows the location-access-denied message (Req 6.3)', async () => {
    const user = userEvent.setup();
    render(<LocationControl requestLocation={fakeRequest({ status: 'denied' })} />);

    await user.click(screen.getByRole('button', { name: 'Show my location' }));

    const msg = await screen.findByText(LOCATION_MESSAGES.denied);
    expect(msg).toBeInTheDocument();
    expect(msg).toHaveAttribute('role', 'alert');
  });

  it('unavailable: shows the location-unavailable message (Req 6.4)', async () => {
    const user = userEvent.setup();
    render(
      <LocationControl requestLocation={fakeRequest({ status: 'unavailable' })} />,
    );

    await user.click(screen.getByRole('button', { name: 'Show my location' }));

    expect(await screen.findByText(LOCATION_MESSAGES.unavailable)).toBeInTheDocument();
  });

  it('timeout: shows the could-not-be-determined message (Req 6.5)', async () => {
    const user = userEvent.setup();
    render(<LocationControl requestLocation={fakeRequest({ status: 'timeout' })} />);

    await user.click(screen.getByRole('button', { name: 'Show my location' }));

    expect(await screen.findByText(LOCATION_MESSAGES.timeout)).toBeInTheDocument();
  });

  it('delegated mode: calls onActivate and never requests geolocation itself', async () => {
    const onActivate = vi.fn();
    const requestLocation = fakeRequest({ status: 'granted', ...IN_NCR });
    const onLocated = vi.fn();
    const user = userEvent.setup();

    render(
      <LocationControl
        onActivate={onActivate}
        requestLocation={requestLocation}
        onLocated={onLocated}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Show my location' }));

    // Delegates to the parent; no direct geolocation, no own status message.
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(requestLocation).not.toHaveBeenCalled();
    expect(onLocated).not.toHaveBeenCalled();
    expect(screen.queryByTestId('location-message')).not.toBeInTheDocument();
  });

  it('does not use any "safe"/score language in its messages (Req 13)', () => {
    const banned = /safe|clear|no risk|score/i;
    for (const message of Object.values(LOCATION_MESSAGES)) {
      expect(message).not.toMatch(banned);
    }
  });
});
