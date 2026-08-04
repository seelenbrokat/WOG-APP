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

type QrResult = {
  expiresAt: string;
  ttlHours: number;
  payload: string;
  qrDataUrl: string;
  vehicle: {
    id: string;
    soloplanVehicleId: string;
    licensePlate: string | null;
    number: string | null;
  };
  driver: {
    id: string;
    telematicsId: string;
    firstName: string | null;
    lastName: string | null;
  };
};

function driverLabel(d: Driver) {
  const name = [d.firstName, d.lastName].filter(Boolean).join(' ');
  return name ? `${name} (${d.telematicsId})` : d.telematicsId;
}

function vehicleLabel(v: Vehicle) {
  const parts = [v.soloplanVehicleId, v.number, v.licensePlate].filter(Boolean);
  return parts.join(' · ');
}

export default function FahrerPrepPage() {
  const user = getUser();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [qrVehicleId, setQrVehicleId] = useState('');
  const [qrDriverId, setQrDriverId] = useState('');
  const [qrTtlHours, setQrTtlHours] = useState(72);
  const [qrCreating, setQrCreating] = useState(false);
  const [qrResult, setQrResult] = useState<QrResult | null>(null);
  const [copyOk, setCopyOk] = useState(false);

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
      if (!qrVehicleId && v.length > 0) {
        setQrVehicleId(v[0].id);
      }
    } catch (e: any) {
      setError(e?.message || 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  async function createQr(vehicleId = qrVehicleId, driverId = qrDriverId) {
    if (!vehicleId) {
      setError('Bitte Fahrzeug wählen');
      return;
    }
    setQrCreating(true);
    setError(null);
    setInfo(null);
    setCopyOk(false);
    try {
      const res = await api<QrResult>('/fahrer/auth/qr-create', {
        method: 'POST',
        body: JSON.stringify({
          vehicleId,
          driverId: driverId || undefined,
          ttlHours: qrTtlHours,
        }),
      });
      setQrResult(res);
      setQrVehicleId(vehicleId);
      setInfo(
        `QR erzeugt für Fahrzeug ${res.vehicle.soloplanVehicleId}` +
          (res.vehicle.licensePlate ? ` (${res.vehicle.licensePlate})` : '') +
          ` · Fahrer ${[res.driver.firstName, res.driver.lastName].filter(Boolean).join(' ') || res.driver.telematicsId}. ` +
          `Gültig bis ${new Date(res.expiresAt).toLocaleString('de-AT')}. Einmalig nutzbar.`,
      );
    } catch (e: any) {
      setError(e?.message || 'QR-Erzeugung fehlgeschlagen');
      setQrResult(null);
    } finally {
      setQrCreating(false);
    }
  }

  async function copyPayload() {
    if (!qrResult?.payload) return;
    try {
      await navigator.clipboard.writeText(qrResult.payload);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 2000);
    } catch {
      setError('Kopieren fehlgeschlagen');
    }
  }

  function printQr() {
    if (!qrResult) return;
    const w = window.open('', '_blank', 'noopener,noreferrer,width=480,height=720');
    if (!w) {
      setError('Druckfenster blockiert – bitte Pop-ups erlauben');
      return;
    }
    const title = `QR Login · ${qrResult.vehicle.soloplanVehicleId}`;
    const driverName =
      [qrResult.driver.firstName, qrResult.driver.lastName].filter(Boolean).join(' ') ||
      qrResult.driver.telematicsId;
    w.document.write(`<!doctype html><html><head><title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; text-align: center; padding: 24px; color: #111; }
  img { width: 320px; height: 320px; image-rendering: pixelated; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { margin: 4px 0; font-size: 14px; }
  .muted { color: #555; font-size: 12px; margin-top: 16px; word-break: break-all; }
</style></head><body>
  <h1>VLB Zustellapp – Anmeldung</h1>
  <p><strong>Fahrzeug</strong> ${qrResult.vehicle.soloplanVehicleId}${
    qrResult.vehicle.licensePlate ? ` · ${qrResult.vehicle.licensePlate}` : ''
  }</p>
  <p><strong>Fahrer</strong> ${driverName}</p>
  <p>Gültig bis ${new Date(qrResult.expiresAt).toLocaleString('de-AT')} · einmalig</p>
  <img src="${qrResult.qrDataUrl}" alt="QR Login" />
  <p class="muted">${qrResult.payload}</p>
  <script>window.onload=()=>{window.print();}</script>
</body></html>`);
    w.document.close();
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

        <section
          style={{
            borderTop: '1px solid var(--border, #ddd)',
            paddingTop: 20,
            display: 'grid',
            gap: 16,
          }}
        >
          <div>
            <h2 style={{ fontSize: 20, margin: '0 0 8px' }}>QR-Login für Zustellapp</h2>
            <p style={{ margin: 0, color: 'var(--muted, #666)', maxWidth: 720 }}>
              Erzeugt einen einmaligen QR-Code. In der Zustellapp nur scannen – kein PIN nötig.
              Standardgültig 72 Stunden.
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              alignItems: 'flex-end',
            }}
          >
            <label style={{ display: 'grid', gap: 4, minWidth: 220 }}>
              <span style={{ fontSize: 13, color: 'var(--muted, #666)' }}>Fahrzeug</span>
              <select
                value={qrVehicleId}
                onChange={(e) => setQrVehicleId(e.target.value)}
                disabled={loading || vehicles.length === 0}
                style={{ minWidth: 220, padding: '8px 10px' }}
              >
                {vehicles.length === 0 ? (
                  <option value="">Keine Fahrzeuge</option>
                ) : (
                  vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {vehicleLabel(v)}
                    </option>
                  ))
                )}
              </select>
            </label>

            <label style={{ display: 'grid', gap: 4, minWidth: 220 }}>
              <span style={{ fontSize: 13, color: 'var(--muted, #666)' }}>
                Fahrer (optional)
              </span>
              <select
                value={qrDriverId}
                onChange={(e) => setQrDriverId(e.target.value)}
                disabled={loading}
                style={{ minWidth: 220, padding: '8px 10px' }}
              >
                <option value="">Automatisch (letzter Fahrer)</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {driverLabel(d)}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'grid', gap: 4, width: 100 }}>
              <span style={{ fontSize: 13, color: 'var(--muted, #666)' }}>Gültig (h)</span>
              <input
                type="number"
                min={1}
                max={168}
                value={qrTtlHours}
                onChange={(e) => setQrTtlHours(Number(e.target.value) || 72)}
                style={{ padding: '8px 10px' }}
              />
            </label>

            <button
              type="button"
              onClick={() => void createQr()}
              disabled={qrCreating || !qrVehicleId}
            >
              {qrCreating ? 'Erzeuge…' : 'QR erzeugen'}
            </button>
          </div>

          {qrResult && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(200px, 280px) 1fr',
                gap: 20,
                alignItems: 'start',
              }}
              className="qr-result"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrResult.qrDataUrl}
                alt="QR-Code Login Zustellapp"
                width={280}
                height={280}
                style={{
                  width: '100%',
                  maxWidth: 280,
                  height: 'auto',
                  imageRendering: 'pixelated',
                  background: '#fff',
                  border: '1px solid var(--border, #ddd)',
                }}
              />
              <div style={{ display: 'grid', gap: 10 }}>
                <p style={{ margin: 0 }}>
                  <strong>Fahrzeug:</strong> {qrResult.vehicle.soloplanVehicleId}
                  {qrResult.vehicle.licensePlate
                    ? ` · ${qrResult.vehicle.licensePlate}`
                    : ''}
                </p>
                <p style={{ margin: 0 }}>
                  <strong>Fahrer:</strong>{' '}
                  {[qrResult.driver.firstName, qrResult.driver.lastName]
                    .filter(Boolean)
                    .join(' ') || qrResult.driver.telematicsId}{' '}
                  (<code>{qrResult.driver.telematicsId}</code>)
                </p>
                <p style={{ margin: 0 }}>
                  <strong>Gültig bis:</strong>{' '}
                  {new Date(qrResult.expiresAt).toLocaleString('de-AT')} ({qrResult.ttlHours}{' '}
                  h, einmalig)
                </p>
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    wordBreak: 'break-all',
                    color: 'var(--muted, #666)',
                  }}
                >
                  <code>{qrResult.payload}</code>
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button type="button" onClick={() => void copyPayload()}>
                    {copyOk ? 'Kopiert' : 'Payload kopieren'}
                  </button>
                  <button type="button" onClick={printQr}>
                    Drucken
                  </button>
                  <button
                    type="button"
                    onClick={() => void createQr(qrResult.vehicle.id, qrResult.driver.id)}
                    disabled={qrCreating}
                  >
                    Neu erzeugen
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

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
                  <th align="left">QR</th>
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
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          setQrVehicleId(v.id);
                          void createQr(v.id, qrDriverId);
                        }}
                        disabled={qrCreating}
                      >
                        QR
                      </button>
                    </td>
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
