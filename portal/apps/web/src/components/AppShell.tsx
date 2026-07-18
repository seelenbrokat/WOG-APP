'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { BrandLogo } from '@/components/BrandLogo';
import { clearSession, getToken, getUser, SessionUser } from '@/lib/api';

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

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
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

  if (!user) return <div className="main">Laden…</div>;

  const links = NAV.filter(
    (n) => n.roles.includes('*') || n.roles.includes(user.role),
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo">
          <BrandLogo variant="mark" />
        </div>
        <nav>
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={pathname === l.href ? 'active' : ''}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-user">
          <div>{user.firstName} {user.lastName}</div>
          <div className="muted" style={{ color: 'rgba(255,255,255,0.7)' }}>{user.role}</div>
          <button
            className="btn btn-ghost"
            style={{ marginTop: '0.75rem', width: '100%' }}
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
          <h1>{title}</h1>
        </div>
        {children}
      </main>
    </div>
  );
}
