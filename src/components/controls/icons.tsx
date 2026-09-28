// src/components/controls/icons.tsx
//
// Enhancement: small inline SVG icons for the floating map controls. Inline
// SVG avoids adding an icon dependency. Every icon is decorative
// (aria-hidden); the accessible name always comes from the owning button.

import type { ReactNode } from 'react';

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const PlusIcon = () => (
  <Svg>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const MinusIcon = () => (
  <Svg>
    <path d="M5 12h14" />
  </Svg>
);

/** Frame / overview icon for "Recenter to Metro Manila". */
export const RecenterIcon = () => (
  <Svg>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    <circle cx="12" cy="12" r="2.5" />
  </Svg>
);

/** Location arrow for "Show my location". */
export const LocationIcon = () => (
  <Svg>
    <path d="M20 4 4 11l7 2 2 7 7-16Z" />
  </Svg>
);

/** Stacked sheets for "Map layers". */
export const LayersIcon = () => (
  <Svg>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 13 9 5 9-5" />
  </Svg>
);

export const CloseIcon = () => (
  <Svg>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
