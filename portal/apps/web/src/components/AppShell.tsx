'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { clearSession, getToken, getUser, SessionUser } from '@/lib/api';

const NAV = [
  { href: '/dashboard', label: 'Übersicht', roles: ['*'] },
  { href: '/shipments', label: 'Sendungen', roles: ['*'] },
  { href: '/shipments/new', label: 'Neuer Auftrag', roles: ['ORG_ADMIN', 'MANDANT_DISPATCHER', 'CUSTOMER_USER'] },
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
    setUser(getUser());
  }, [router]);

  if (!user) return <div className="main">Laden…</div>;

  const links = NAV.filter(
    (n) => n.roles.includes('*') || n.roles.includes(user.role),
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo">WOG</div>
        <nav>
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={pathname === l.href ? 'active' : ''}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div style={{ marginTop: 'auto', padding: '0.5rem', fontSize: '0.85rem', opacity: 0.8 }}>
          <div>{user.firstName} {user.lastName}</div>
          <div>{user.role}</div>
          <button
            className="btn btn-ghost"
            style={{ marginTop: '0.75rem', color: 'white', borderColor: 'rgba(255,255,255,0.2)' }}
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
