// src/components/driving/RerouteOffer.tsx
//
// Route choice shown when a demo flood report is within 1 km and a
// flood-avoiding alternative exists. Two options, following the existing
// option-selection pattern in the driving HUD (real buttons in a labeled
// group). The car keeps moving while this is shown; if the driver passes the
// branch point, the parent swaps in the next reroute (`offer.isRetry`).
//
// Wording follows docs/FLOOD_SEMANTICS.md: the alternative "avoids the
// reported flooding"; it is never called "safe" or "clear".

import { floodStateLabel } from '../../layers/visualMapping';
import { FLOOD_STATE_COLORS } from '../../map/basemap/colorTokens';
import type { DriveHazard } from '../../data/fixtures/driveHazards';
import { formatDistance } from '../../simulation/navigation';
import { formatRerouteDelta, type RerouteOffer as Offer } from '../../simulation/reroute';
import { rerouteReason, routingStanceForHazard } from '../../simulation/routingPolicy';

export interface RerouteOfferProps {
  offer: Offer;
  hazard: DriveHazard;
  toHazardM: number;
  onReroute: () => void;
  onKeep: () => void;
}

export function RerouteOffer({ offer, hazard, toHazardM, onReroute, onKeep }: RerouteOfferProps) {
  return (
    <section
      className="baharoute-reroute"
      role="alertdialog"
      aria-live="assertive"
      aria-labelledby="baharoute-reroute-title"
      aria-describedby="baharoute-reroute-desc"
      style={{ borderTopColor: FLOOD_STATE_COLORS[hazard.state].hex }}
    >
      <h2 id="baharoute-reroute-title" className="baharoute-reroute__title">
        {floodStateLabel(hazard.state)} ahead · {formatDistance(toHazardM)}
      </h2>
      <p id="baharoute-reroute-desc" className="baharoute-reroute__desc">
        {offer.isRetry && (
          <strong className="baharoute-reroute__retry">
            Earlier alternative missed. New alternative available.{' '}
          </strong>
        )}
        {rerouteReason(routingStanceForHazard(hazard.state), hazard.street)} Demo
        report, unconfirmed.
      </p>
      <div role="group" aria-label="Route options" className="baharoute-reroute__options">
        <button
          type="button"
          className="baharoute-reroute__option baharoute-reroute__option--primary baharoute-focus-ring"
          onClick={onReroute}
        >
          <strong>Lower-risk alternative</strong>
          <span>Avoids the flood-risk area · {formatRerouteDelta(offer)}</span>
          <span>Turn-off in {formatDistance(offer.toBranchM)}</span>
        </button>
        <button
          type="button"
          className="baharoute-reroute__option baharoute-focus-ring"
          onClick={onKeep}
        >
          <strong>Keep recommended route</strong>
          <span>Passes the flood-risk area</span>
        </button>
      </div>
    </section>
  );
}

export default RerouteOffer;
