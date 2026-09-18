'use client';

import Link from 'next/link';
import { AppShell } from '@/components/AppShell';

export default function LagerHomePage() {
  return (
    <AppShell title="Lager" eyebrow="WOG Lager">
      <p className="muted" style={{ marginTop: 0 }}>
        Interne Lagerprozesse – nur für WOG-Personal. Weitere Untermenüs folgen.
      </p>
      <div className="grid-2" style={{ marginTop: '1rem' }}>
        <Link href="/lager/lademittelscheine" className="panel" style={{ textDecoration: 'none', color: 'inherit' }}>
          <strong>Lademittelscheine</strong>
          <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.9rem' }}>
            Digitaler Palettenschein auf Toureben – Tablet-Erfassung, Unterschriften, PDF &amp; Partner-Mail.
          </p>
        </Link>
        <Link href="/lager/login-qr" className="panel" style={{ textDecoration: 'none', color: 'inherit' }}>
          <strong>Login-QR</strong>
          <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.9rem' }}>
            QR-Code für Lager-Tablet erzeugen – Scan meldet an und öffnet z.&nbsp;B. WE TC57.
          </p>
        </Link>
      </div>
    </AppShell>
  );
}
