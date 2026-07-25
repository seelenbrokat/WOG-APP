'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api, getUser } from '@/lib/api';

type Driver = {
  id: string;
  telematicsId: string;
  firstName: string | null;
  lastName: string | null;
  pin: string | null;
  active: boolean;
  lastVehicle?: {
    id: string;
    soloplanVehicleId: string;
    number: string | null;
    licensePlate: string | null;
    matchcode: string | null;
  } | null;
};

type Vehicle = {
  id: string;
  soloplanVehicleId: string;
  number: string | null;
  licensePlate: string | null;
  matchcode: string | null;
  pin: string | null;
  lastDriverId: string | null;
  active: boolean;
};

export default function FahrerPrepPage() {
  const user = getUser();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [d, v] = await Promise.all([
        api<Driver[]>('/drivers'),
        api<Vehicle[]>('/drivers/vehicles'),
      ]);
      setDrivers(d);
      setVehicles(v);
    } catch (e: any) {
      setError(e?.message || 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function bootstrap() {
    setBootstrapping(true);
    setError(null);
    setInfo(null);
    try {
      const res = await api<{
        vehicle103: { soloplanVehicleId: string; licensePlate: string | null };
        telematicsConfig: string;
        driver: { telematicsId: string; firstName: string | null; lastName: string | null };
      }>('/drivers/bootstrap-telematics', { method: 'POST' });
      setInfo(
        `Angelegt/aktualisiert: Fahrzeug ${res.vehicle103.soloplanVehicleId} (${res.vehicle103.licensePlate || '—'}), ` +
          `Fahrer ${res.driver.telematicsId} (${res.driver.firstName || ''} ${res.driver.lastName || ''}). ` +
          `Telematikkonfiguration: ${res.telematicsConfig}.`,
      );
      await load();
    } catch (e: any) {
      setError(e?.message || 'Bootstrap fehlgeschlagen');
    } finally {
      setBootstrapping(false);
    }
  }

  if (!user) {
    return (
      <AppShell title="Fahrer / Zustell-App">
        <p>Bitte anmelden.</p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Fahrer / Zustell-App">
      <div style={{ display: 'grid', gap: 24, maxWidth: 1100 }}>
        <header>
          <p style={{ margin: 0, color: 'var(--muted, #666)', maxWidth: 720 }}>
            Vorbereitung der Fahrer-Zustellapp (Web / iOS / Android). Jedes Fahrzeug behält seine
            Soloplan-ID; die Telematikkonfiguration heißt <strong>VLBPortal</strong>.
            Statusmeldungen der App landen im SFTP-Ordner{' '}
            <code>outbound/soloplan/telematics</code> (Soloplan-Download) – inkl. Lademittel und
            Ablieferbeleg bei Unterschrift.
          </p>
        </header>

        <section
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'center',
          }}
        >
          <button type="button" onClick={() => void bootstrap()} disabled={bootstrapping}>
            {bootstrapping ? 'Lege an…' : 'Fahrzeug 103 + Fahrer THNE anlegen'}
          </button>
          <button type="button" onClick={() => void load()} disabled={loading}>
            Aktualisieren
          </button>
        </section>

        {error && (
          <p style={{ color: '#b00020', margin: 0 }} role="alert">
            {error}
          </p>
        )}
        {info && (
          <p style={{ color: '#0a5', margin: 0 }} role="status">
            {info}
          </p>
        )}

        <section>
          <h2 style={{ fontSize: 20, marginBottom: 12 }}>Fahrer</h2>
          {loading ? (
            <p>Laden…</p>
          ) : drivers.length === 0 ? (
            <p>Noch keine Fahrer – Bootstrap ausführen.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th align="left">TelematicsId</th>
                  <th align="left">Name</th>
                  <th align="left">Fahrzeug</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <code>{d.telematicsId}</code>
                    </td>
                    <td>
                      {[d.firstName, d.lastName].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td>
                      {d.lastVehicle
                        ? `${d.lastVehicle.soloplanVehicleId} · ${d.lastVehicle.licensePlate || '—'}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h2 style={{ fontSize: 20, marginBottom: 12 }}>Fahrzeuge</h2>
          {loading ? (
            <p>Laden…</p>
          ) : vehicles.length === 0 ? (
            <p>Noch keine Fahrzeuge.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th align="left">Soloplan-ID</th>
                  <th align="left">Nr.</th>
                  <th align="left">Kennzeichen</th>
                  <th align="left">Letzter Fahrer</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <code>{v.soloplanVehicleId}</code>
                    </td>
                    <td>{v.number || '—'}</td>
                    <td>{v.licensePlate || '—'}</td>
                    <td>{v.lastDriverId || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </AppShell>
  );
}
