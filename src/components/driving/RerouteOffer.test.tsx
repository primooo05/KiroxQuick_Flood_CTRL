import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RerouteOffer } from './RerouteOffer';
import { findRerouteOffer } from '../../simulation/reroute';
import { measureRoute } from '../../simulation/routeGeometry';
import { PITX_TO_MOA_REROUTES } from '../../data/fixtures/floodReroutes';
import { PITX_TO_MOA_HAZARDS } from '../../data/fixtures/driveHazards';
import { PITX_TO_MOA_ROUTE } from '../../data/fixtures/pitxToMoaRoute';

describe('RerouteOffer', () => {
  const [hazard] = PITX_TO_MOA_HAZARDS;
  const m = hazard.atM - 1000;
  const offer = findRerouteOffer(
    measureRoute(PITX_TO_MOA_ROUTE),
    m,
    hazard.id,
    PITX_TO_MOA_REROUTES,
    new Set(),
    10,
  )!;

  function renderOffer(isRetry = false) {
    const onReroute = vi.fn();
    const onKeep = vi.fn();
    render(
      <RerouteOffer
        offer={{ ...offer, isRetry }}
        hazard={hazard}
        toHazardM={1000}
        onReroute={onReroute}
        onKeep={onKeep}
      />,
    );
    return { onReroute, onKeep };
  }

  it('presents two labeled route options with honest wording', async () => {
    const user = userEvent.setup();
    const { onReroute, onKeep } = renderOffer();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Reported Flooding ahead');
    expect(dialog).toHaveTextContent('unconfirmed');
    expect(dialog).not.toHaveTextContent('missed');
    // Honest wording: never "safe"/"clear"/"no risk".
    expect(dialog.textContent ?? '').not.toMatch(/\bsafe\b|\bclear\b|no risk/i);
    // Risk-aware wording: a lower-risk alternative vs. the recommended route.
    expect(dialog).toHaveTextContent('Lower-risk alternative');
    expect(dialog).toHaveTextContent('Keep recommended route');

    await user.click(screen.getByRole('button', { name: /Lower-risk alternative/ }));
    expect(onReroute).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Keep recommended route/ }));
    expect(onKeep).toHaveBeenCalled();
  });

  it('tells the driver when an earlier alternative was missed', () => {
    renderOffer(true);
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Earlier alternative missed. New alternative available.',
    );
  });
});
