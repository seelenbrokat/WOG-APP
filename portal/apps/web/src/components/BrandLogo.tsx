type BrandLogoProps = {
  variant?: 'full' | 'mark';
  className?: string;
};

/** Original-WOG-Logo (hochgeladenes Asset), nicht neu gezeichnet. */
export function BrandLogo({ variant = 'full', className }: BrandLogoProps) {
  const isMark = variant === 'mark';
  return (
    <img
      src="/wog-logo.jpg"
      alt="WOG – World of Green Logistics"
      width={718}
      height={426}
      className={className || (isMark ? 'brand-logo-mark' : 'brand-logo')}
      decoding="async"
    />
  );
}
