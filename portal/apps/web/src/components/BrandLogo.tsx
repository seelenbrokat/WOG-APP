type BrandLogoProps = {
  variant?: 'full' | 'mark';
  className?: string;
};

export function BrandLogo({ variant = 'full', className }: BrandLogoProps) {
  const src = variant === 'mark' ? '/wog-mark.svg' : '/wog-logo.svg';
  const alt = 'WOG – World of Green Logistics';
  return (
    <img
      src={src}
      alt={alt}
      className={className || (variant === 'mark' ? 'brand-logo-mark' : 'brand-logo')}
    />
  );
}
