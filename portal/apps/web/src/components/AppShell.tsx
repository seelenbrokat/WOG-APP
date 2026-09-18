'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { BrandLogo } from '@/components/BrandLogo';
import { api, clearSession, getToken, getUser, SessionUser, setSession } from '@/lib/api';

const ROLE_LABEL: Record<string, string> = {
  ORG_ADMIN: 'Administrator',
  MANDANT_DISPATCHER: 'Disposition',
  CUSTOMER_USER: 'Kunde',
  PARTNER: 'Partner',
};

type NavItem = {
  href: string;
  label: string;
  roles: string[];
  children?: Array<{ href: string; label: string }>;
};

type ImpersonationCustomer = {
  id: string;
  name: string;
  customerNumber: string | null;
  matchcode: string | null;
};

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Übersicht', roles: ['*'] },
  { href: '/shipments', label: 'Sendungen', roles: ['*'] },
  { href: '/shipments/new', label: 'Neuer Auftrag', roles: ['ORG_ADMIN', 'MANDANT_DISPATCHER', 'CUSTOMER_USER'] },
  { href: '/tours/dashboard', label: 'Dispo-Dashboard', roles: ['ORG_ADMIN', 'MANDANT_DISPATCHER'] },
  { href: '/tours', label: 'Touren & Fahrzeuge', roles: ['ORG_ADMIN', 'MANDANT_DISPATCHER'] },
  { href: '/partner/tours', label: 'Meine Touren', roles: ['PARTNER'] },
  { href: '/partner/lademittelscheine', label: 'Lademittelverwaltung', roles: ['PARTNER'] },
  { href: '/fahrer', label: 'Fahrer / Zustell-App', roles: ['ORG_ADMIN', 'MANDANT_DISPATCHER'] },
  { href: '/tours/lademittel', label: 'Lademittel', roles: ['ORG_ADMIN', 'MANDANT_DISPATCHER'] },
  {
    href: '/lager',
    label: 'Lager',
    roles: ['ORG_ADMIN', 'MANDANT_DISPATCHER'],
    children: [
      { href: '/lager/lademittelscheine', label: 'Lademittelscheine' },
      { href: '/lager/login-qr', label: 'Login-QR' },
    ],
  },
  { href: '/scanning', label: 'Scanning', roles: ['ORG_ADMIN', 'MANDANT_DISPATCHER'] },
  { href: '/scanning/we-tc57', label: 'WE TC57', roles: ['ORG_ADMIN', 'MANDANT_DISPATCHER'] },
  { href: '/scanning/entladeberichte', label: 'Entladeberichte', roles: ['ORG_ADMIN', 'MANDANT_DISPATCHER'] },
  { href: '/tours/map', label: 'Kartenmonitor', roles: ['ORG_ADMIN', 'MANDANT_DISPATCHER'] },
  { href: '/customs', label: 'Verzollungsauftrag', roles: ['ORG_ADMIN', 'MANDANT_DISPATCHER', 'CUSTOMER_USER'] },
  { href: '/integrations', label: 'EZOLL-Hub', roles: ['ORG_ADMIN', 'MANDANT_DISPATCHER'] },
  { href: '/addresses', label: 'Adressbuch', roles: ['ORG_ADMIN', 'MANDANT_DISPATCHER', 'CUSTOMER_USER'] },
  { href: '/customers', label: 'Kunden', roles: ['ORG_ADMIN', 'MANDANT_DISPATCHER'] },
  { href: '/mandanten', label: 'Mandanten', roles: ['ORG_ADMIN', 'MANDANT_DISPATCHER'] },
  { href: '/partners', label: 'Partner', roles: ['ORG_ADMIN', 'MANDANT_DISPATCHER'] },
  { href: '/users', label: 'Benutzer', roles: ['ORG_ADMIN'] },
  { href: '/audit', label: 'Protokoll', roles: ['ORG_ADMIN'] },
  { href: '/settings', label: 'Einstellungen', roles: ['*'] },
  { href: '/change-password', label: 'Passwort ändern', roles: ['*'] },
  { href: '/track', label: 'Track & Trace', roles: ['*'] },
];

function isActive(pathname: string, href: string) {
  if (pathname === href) return true;
  if (href === '/shipments' && /^\/shipments\/[^/]+$/.test(pathname)) return true;
  if (
    href === '/tours' &&
    (pathname === '/tours' || /^\/tours\/(?!map$|dashboard$|lademittel$)[^/]+$/.test(pathname))
  ) {
    return true;
  }
  if (href === '/tours/dashboard' && pathname.startsWith('/tours/dashboard')) return true;
  if (href === '/tours/lademittel' && pathname.startsWith('/tours/lademittel')) return true;
  if (href === '/tours/map' && pathname.startsWith('/tours/map')) return true;
  if (href === '/partner/tours' && pathname === '/partner/tours') return true;
  if (href === '/partner/lademittelscheine' && pathname.startsWith('/partner/lademittelscheine')) return true;
  if (href === '/lager' && pathname.startsWith('/lager')) return true;
  if (href === '/lager/lademittelscheine' && pathname.startsWith('/lager/lademittelscheine')) return true;
  if (href === '/lager/login-qr' && pathname.startsWith('/lager/login-qr')) return true;
  if (href === '/audit' && pathname.startsWith('/audit')) return true;
  if (href === '/customs' && pathname.startsWith('/customs')) return true;
  return false;
}

function canUseCustomerView(user: SessionUser | null) {
  if (!user) return false;
  return user.realRole === 'ORG_ADMIN' || user.role === 'ORG_ADMIN' || Boolean(user.impersonating);
}

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
  const [customers, setCustomers] = useState<ImpersonationCustomer[]>([]);
  const [customerFilter, setCustomerFilter] = useState('');
  const [busy, setBusy] = useState(false);

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

  useEffect(() => {
    if (!canUseCustomerView(user)) return;
    api<ImpersonationCustomer[]>('/auth/impersonate/customers')
      .then(setCustomers)
      .catch(() => setCustomers([]));
  }, [user?.id, user?.realRole, user?.role, user?.impersonating]);

  const filteredCustomers = useMemo(() => {
    const q = customerFilter.trim().toLowerCase();
    const matches = !q
      ? customers
      : customers.filter((c) => {
          const hay = `${c.name} ${c.customerNumber || ''} ${c.matchcode || ''}`.toLowerCase();
          return hay.includes(q);
        });
    const currentId = user?.impersonating ? user.customerId : null;
    const withCurrent =
      currentId && !matches.some((c) => c.id === currentId)
        ? [
            ...matches,
            ...customers.filter((c) => c.id === currentId),
          ]
        : matches;
    return withCurrent.slice(0, 100);
  }, [customers, customerFilter, user?.impersonating, user?.customerId]);

  async function applySession(res: { accessToken: string; user: SessionUser }) {
    setSession(res.accessToken, res.user);
    setUser(res.user);
    router.replace('/dashboard');
    router.refresh();
  }

  async function startViewAs(customerId: string) {
    if (!customerId || busy) return;
    setBusy(true);
    try {
      const res = await api<{ accessToken: string; user: SessionUser }>('/auth/impersonate', {
        method: 'POST',
        body: JSON.stringify({ customerId }),
      });
      await applySession(res);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : 'Kundenansicht konnte nicht gestartet werden');
    } finally {
      setBusy(false);
    }
  }

  async function stopViewAs() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api<{ accessToken: string; user: SessionUser }>('/auth/impersonate/stop', {
        method: 'POST',
      });
      await applySession(res);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : 'Kundenansicht konnte nicht beendet werden');
    } finally {
      setBusy(false);
    }
  }

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
  const showCustomerSwitcher = canUseCustomerView(user);
  const viewName =
    user.impersonatingCustomerName || user.customerName || 'Kunde';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/dashboard" className="logo" aria-label="Zur Übersicht" title="Zur Übersicht">
          <BrandLogo variant="mark" />
        </Link>
        <div>
          <p className="sidebar-label">Navigation</p>
          <nav>
            {links.map((l) => {
              const active = isActive(pathname, l.href);
              return (
                <div key={l.href} className="nav-block">
                  <Link href={l.href} className={active ? 'active' : undefined}>
                    {l.label}
                  </Link>
                  {l.children?.length ? (
                    <div className="nav-children">
                      {l.children.map((c) => (
                        <Link
                          key={c.href}
                          href={c.href}
                          className={isActive(pathname, c.href) ? 'active' : undefined}
                        >
                          {c.label}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </nav>
        </div>
        {showCustomerSwitcher && (
          <div className="sidebar-impersonate">
            <p className="sidebar-label">Kundenansicht</p>
            <input
              type="search"
              placeholder="Kunde suchen…"
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              disabled={busy}
              aria-label="Kunde für Ansicht suchen"
            />
            <select
              value={user.impersonating ? user.customerId || '' : ''}
              onChange={(e) => {
                const id = e.target.value;
                if (!id) {
                  stopViewAs();
                  return;
                }
                startViewAs(id);
              }}
              disabled={busy}
              aria-label="Als Kunde anzeigen"
            >
              <option value="">Admin-Ansicht</option>
              {filteredCustomers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.customerNumber ? ` (${c.customerNumber})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="sidebar-user">
          <div className="name">
            {user.firstName} {user.lastName}
          </div>
          <div className="role">
            {user.impersonating
              ? `Ansicht: ${viewName}`
              : ROLE_LABEL[user.role] || user.role}
          </div>
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
        {user.impersonating && (
          <div className="impersonation-banner" role="status">
            <span>
              Kundenansicht aktiv: <strong>{viewName}</strong>
            </span>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={stopViewAs}>
              Beenden
            </button>
          </div>
        )}
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
