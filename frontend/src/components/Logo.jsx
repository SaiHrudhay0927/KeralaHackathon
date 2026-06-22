import React from 'react';

// Original "investigation eye" mark: an eye set inside a magnifying-glass lens.
// Uses currentColor so it inherits the header text / accent color and adapts
// to light and dark themes automatically.
export default function Logo({ size = 24, className }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="Sakshi logo"
    >
      {/* magnifying-glass lens */}
      <circle cx="10" cy="10" r="7.5" />
      {/* handle */}
      <line x1="15.6" y1="15.6" x2="21" y2="21" strokeWidth="2.2" />
      {/* eye outline inside the lens */}
      <path d="M4.7 10 Q10 5.4 15.3 10 Q10 14.6 4.7 10 Z" />
      {/* iris */}
      <circle cx="10" cy="10" r="2.1" fill="currentColor" stroke="none" />
    </svg>
  );
}
