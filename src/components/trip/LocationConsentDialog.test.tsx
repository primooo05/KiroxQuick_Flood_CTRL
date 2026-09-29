// src/components/trip/LocationConsentDialog.test.tsx
//
// The consent dialog gates browser geolocation: it renders only when open,
// exposes clear Not now / Allow choices, is an accessible modal, and dismisses
// on Escape. It must never itself call geolocation.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LocationConsentDialog } from './LocationConsentDialog';

describe('LocationConsentDialog', () => {
  it('renders nothing when closed', () => {
    render(<LocationConsentDialog open={false} onAllow={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.queryByTestId('location-consent-dialog')).toBeNull();
  });

  it('is an accessible modal with a name and description when open', () => {
    render(<LocationConsentDialog open onAllow={vi.fn()} onDismiss={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(dialog).toHaveAttribute('aria-describedby');
    expect(screen.getByTestId('location-consent-allow')).toHaveTextContent(/allow location/i);
    expect(screen.getByTestId('location-consent-decline')).toHaveTextContent(/not now/i);
  });

  it('calls onAllow when Allow location is pressed', async () => {
    const onAllow = vi.fn();
    const user = userEvent.setup();
    render(<LocationConsentDialog open onAllow={onAllow} onDismiss={vi.fn()} />);
    await user.click(screen.getByTestId('location-consent-allow'));
    expect(onAllow).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss when Not now is pressed', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(<LocationConsentDialog open onAllow={vi.fn()} onDismiss={onDismiss} />);
    await user.click(screen.getByTestId('location-consent-decline'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses on Escape', async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(<LocationConsentDialog open onAllow={vi.fn()} onDismiss={onDismiss} />);
    await user.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
