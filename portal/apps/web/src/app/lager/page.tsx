'use client';

import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { getUser } from '@/lib/api';

export default function LagerHomePage() {
  const user = getUser();
  const isCustomer = user?.role === 'CUSTOMER_USER';

  if (isCustomer) {
    return (
      <AppShell title="Mein Lager" eyebrow="Kundenportal">
        <p className="muted" style={{ marginTop: 0 }}>
          Eingelagerte Paletten und Monatsabrechnung (nur Anzeige).
        </p>
        <div className="grid-2" style={{ marginTop: '1rem' }}>
          <Link href="/lager/bestand" className="panel" style={{ textDecoration: 'none', color: 'inherit' }}>
            <strong>Mein Bestand</strong>
            <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.9rem' }}>
              Aktuell eingelagerte Paletten, Artikel und Seriennummern.
            </p>
          </Link>
          <Link
            href="/lager/abrechnung"
            className="panel"
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <strong>Abrechnung</strong>
            <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.9rem' }}>
              Monatshöchststand und Ein-/Auslagerkosten.
            </p>
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Lager" eyebrow="WOG Lager">
      <p className="muted" style={{ marginTop: 0 }}>
        Interne Lagerprozesse – Einlagerung, Bestand, Auslagerung und Abrechnung.
      </p>
      <div className="grid-2" style={{ marginTop: '1rem' }}>
        <Link href="/lager/uebersicht" className="panel" style={{ textDecoration: 'none', color: 'inherit' }}>
          <strong>Übersicht</strong>
          <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.9rem' }}>
            Lagerkunden und Belegung auf einen Blick.
          </p>
        </Link>
        <Link href="/lager/einlagern" className="panel" style={{ textDecoration: 'none', color: 'inherit' }}>
          <strong>Einlagern</strong>
          <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.9rem' }}>
            Palette aufnehmen: Platz, Kunde, Artikel, Seriennummer.
          </p>
        </Link>
        <Link href="/lager/bestand" className="panel" style={{ textDecoration: 'none', color: 'inherit' }}>
          <strong>Bestand / Auslagern</strong>
          <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.9rem' }}>
            Aktueller Lagerbestand suchen und ausbuchen.
          </p>
        </Link>
        <Link href="/lager/plaetze" className="panel" style={{ textDecoration: 'none', color: 'inherit' }}>
          <strong>Lagerplätze</strong>
          <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.9rem' }}>
            Hochregal &amp; Blocklager – anpassbares Layout.
          </p>
        </Link>
        <Link href="/lager/preise" className="panel" style={{ textDecoration: 'none', color: 'inherit' }}>
          <strong>Preise</strong>
          <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.9rem' }}>
            Ein-/Auslagerung und Lagergebühr je Kunde und Palettentyp.
          </p>
        </Link>
        <Link href="/lager/abrechnung" className="panel" style={{ textDecoration: 'none', color: 'inherit' }}>
          <strong>Monatsabrechnung</strong>
          <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.9rem' }}>
            Höchststand + Bewegungen für die Abrechnung.
          </p>
        </Link>
        <Link
          href="/lager/lademittelscheine"
          className="panel"
          style={{ textDecoration: 'none', color: 'inherit' }}
        >
          <strong>Lademittelscheine</strong>
          <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.9rem' }}>
            Digitaler Palettenschein auf Toureben.
          </p>
        </Link>
        <Link href="/lager/login-qr" className="panel" style={{ textDecoration: 'none', color: 'inherit' }}>
          <strong>Login-QR</strong>
          <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.9rem' }}>
            QR-Code für Lager-Tablet.
          </p>
        </Link>
      </div>
    </AppShell>
  );
}
