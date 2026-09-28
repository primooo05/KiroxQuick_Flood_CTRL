// src/components/controls/LayersButton.tsx
//
// Enhancement: on-demand wrapper around the existing LayerControl. A round
// "Map layers" button opens/closes a floating panel holding the unchanged
// LayerControl list, so the toggles no longer permanently cover the map.
//
// The panel stays mounted (hidden via the `hidden` attribute) while closed so
// each toggle keeps its local on/off state between openings. Escape closes the
// panel and returns focus to the button.

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CloseIcon, LayersIcon } from './icons';

export interface LayersButtonProps {
  /** The panel content, normally the <LayerControl />. */
  children: ReactNode;
  /** Initial open state. Defaults to closed. */
  defaultOpen?: boolean;
}

export function LayersButton({ children, defaultOpen = false }: LayersButtonProps) {
  const [open, setOpen] = useState(defaultOpen);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  const close = (): void => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      close();
    }
  };

  return (
    <div className="baharoute-layers" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="baharoute-round-button baharoute-focus-ring"
        data-testid="layers-button"
        aria-label="Map layers"
        title="Map layers"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <LayersIcon />
      </button>
      <div
        id={panelId}
        className="baharoute-layers__panel"
        data-testid="layers-panel"
        hidden={!open}
      >
        <div className="baharoute-panel-header">
          <h2 className="baharoute-panel-title">Map layers</h2>
          <button
            type="button"
            className="baharoute-icon-button baharoute-focus-ring"
            aria-label="Close map layers"
            onClick={close}
          >
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default LayersButton;
