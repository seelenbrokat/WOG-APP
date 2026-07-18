import { ReactNode } from 'react';
import Link from 'next/link';
import { BrandLogo } from '@/components/BrandLogo';

type AuthLayoutProps = {
  headline: string;
  sub: string;
  children: ReactNode;
  showTrackCta?: boolean;
};

export function AuthLayout({ headline, sub, children, showTrackCta = false }: AuthLayoutProps) {
  return (
    <div className="hero">
      <div className="hero-atmosphere" aria-hidden="true">
        <div className="globe-ring" />
        <div className="swoosh" />
        <div className="leaf leaf-a" />
        <div className="leaf leaf-b" />
        <div className="leaf leaf-c" />
      </div>
      <section className="hero-brand">
        <BrandLogo variant="full" />
        <h1 className="brand-headline">{headline}</h1>
        <p className="brand-sub">{sub}</p>
        {showTrackCta && (
          <div className="hero-cta row">
            <Link className="btn btn-ghost" href="/track">
              Sendung verfolgen
            </Link>
          </div>
        )}
      </section>
      <section className="hero-panel">{children}</section>
    </div>
  );
}
