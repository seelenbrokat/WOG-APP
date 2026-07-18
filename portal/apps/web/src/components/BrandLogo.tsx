type BrandLogoProps = {
  variant?: 'full' | 'mark';
  className?: string;
  onLight?: boolean;
};

/** Globus-Mark aus dem WOG-Logo (ohne Text – Fonts kommen von der Seite). */
function GlobeMark({ size = 72 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 140 140"
      width={size}
      height={size}
      aria-hidden="true"
      className="brand-globe"
    >
      <defs>
        <linearGradient id="wogGlobe" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#A8D0E8" />
          <stop offset="100%" stopColor="#7AADCF" />
        </linearGradient>
      </defs>
      <path
        d="M8 86 C36 112, 104 112, 132 86"
        fill="none"
        stroke="#8AB8D9"
        strokeWidth="10"
        strokeLinecap="round"
      />
      <circle cx="70" cy="70" r="50" fill="url(#wogGlobe)" stroke="#1B7340" strokeWidth="4" />
      <ellipse cx="70" cy="70" rx="20" ry="48" fill="none" stroke="#fff" strokeWidth="2.5" opacity="0.9" />
      <line x1="70" y1="22" x2="70" y2="118" stroke="#fff" strokeWidth="2.5" opacity="0.9" />
      <ellipse cx="70" cy="70" rx="48" ry="17" fill="none" stroke="#fff" strokeWidth="2.5" opacity="0.9" />
      <path d="M28 54 Q70 42 112 54" fill="none" stroke="#fff" strokeWidth="2" opacity="0.75" />
      <path d="M28 88 Q70 100 112 88" fill="none" stroke="#fff" strokeWidth="2" opacity="0.75" />
      <path d="M96 20 C112 4, 130 10, 132 26 C116 24, 104 30, 96 20Z" fill="#1B7340" />
      <path d="M108 30 C122 18, 140 26, 138 42 C124 36, 114 40, 108 30Z" fill="#155C33" />
    </svg>
  );
}

/**
 * WOG-Logo korrekt gerendert: Buchstaben/Tagline als HTML (Montserrat),
 * Globus als SVG – funktioniert auf hellem Untergrund wie im Original.
 */
export function BrandLogo({ variant = 'full', className, onLight = true }: BrandLogoProps) {
  if (variant === 'mark') {
    return (
      <div className={className || 'brand-logo-mark'} role="img" aria-label="WOG – World of Green Logistics">
        <span className="brand-letter">W</span>
        <GlobeMark size={56} />
        <span className="brand-letter">G</span>
      </div>
    );
  }

  return (
    <div
      className={className || `brand-lockup${onLight ? ' brand-lockup--light' : ''}`}
      role="img"
      aria-label="WOG – World of Green Logistics"
    >
      <div className="brand-lockup-row">
        <span className="brand-letter brand-letter--lg">W</span>
        <GlobeMark size={88} />
        <span className="brand-letter brand-letter--lg">G</span>
      </div>
      <div className="brand-tagline">
        <span className="brand-tagline-green">WORLD OF GREEN</span>
        <span className="brand-tagline-blue">LOGISTICS</span>
      </div>
    </div>
  );
}
