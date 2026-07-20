'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { BrandLogo } from '@/components/BrandLogo';
import { clearSession, getToken, getUser, SessionUser } from '@/lib/api';

const ROLE_LABEL: Record<string, string> = {
  ORG_ADMIN: 'Administrator',
  MANDANT_DISPATCHER: 'Disposition',
  CUSTOMER_USER: 'Kunde',
  PARTNER_USER: 'Partner',
};

const NAV = [
  { href: '/dashboard', label: 'Übersicht', roles: ['*'] },
  { href: '/shipments', label: 'Sendungen', roles: ['*'] },
  { href: '/shipments/new', label: 'Neuer Auftrag', roles: ['ORG_ADMIN', 'MANDANT_DISPATCHER', 'CUSTOMER_USER'] },
  { href: '/customs', label: 'Verzollung', roles: ['ORG_ADMIN', 'MANDANT_DISPATCHER', 'CUSTOMER_USER'] },
  { href: '/integrations', label: 'EZOLL-Hub', roles: ['ORG_ADMIN', 'MANDANT_DISPATCHER'] },
  { href: '/addresses', label: 'Adressbuch', roles: ['ORG_ADMIN', 'MANDANT_DISPATCHER', 'CUSTOMER_USER'] },
  { href: '/customers', label: 'Kunden', roles: ['ORG_ADMIN', 'MANDANT_DISPATCHER', 'CUSTOMER_USER'] },
  { href: '/mandanten', label: 'Mandanten', roles: ['ORG_ADMIN', 'MANDANT_DISPATCHER', 'CUSTOMER_USER'] },
  { href: '/partners', label: 'Partner', roles: ['ORG_ADMIN', 'MANDANT_DISPATCHER'] },
  { href: '/users', label: 'Benutzer', roles: ['ORG_ADMIN'] },
  { href: '/settings', label: 'Einstellungen', roles: ['*'] },
  { href: '/track', label: 'Track & Trace', roles: ['*'] },
];

export function AppShell({
  title,
  eyebrow = 'WOG Portal',
  children,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    const session = getUser();
    if (session?.mustChangePassword && pathname !== '/change-password') {
      router.replace('/change-password');
      return;
    }
    setUser(session);
  }, [router, pathname]);

  if (!user) {
    return (
      <div className="main">
        <p className="muted">Portal wird geladen…</p>
      </div>
    );
  }

  const links = NAV.filter(
    (n) => n.roles.includes('*') || n.roles.includes(user.role),
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo">
          <BrandLogo variant="mark" />
        </div>
        <div>
          <p className="sidebar-label">Navigation</p>
          <nav>
            {links.map((l) => {
              const active =
                pathname === l.href ||
                (l.href === '/shipments' && /^\/shipments\/[^/]+$/.test(pathname));
              return (
                <Link key={l.href} href={l.href} className={active ? 'active' : undefined}>
                  {l.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="sidebar-user">
          <div className="name">
            {user.firstName} {user.lastName}
          </div>
          <div className="role">{ROLE_LABEL[user.role] || user.role}</div>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => {
              clearSession();
              router.push('/');
            }}
          >
            Abmelden
          </button>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
