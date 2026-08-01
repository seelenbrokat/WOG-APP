'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api, getToken } from '@/lib/api';

type EtbRow = {
  sessionId: string;
  externalRef: string;
  sessionDate: string;
  closedAt: string | null;
  customer: { id: string; name: string; customerNumber: string } | null;
  documentId: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  createdAt: string | null;
};

async function downloadEtb(docId: string, fileName: string) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || '/api'}/documents/${docId}/download`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new Error('Download fehlgeschlagen');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || `ETB-${docId}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function EntladeberichtePage() {
  const [rows, setRows] = useState<EtbRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const list = await api<EtbRow[]>('/goods-receipt/entladeberichte');
      setRows(list || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Laden fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <AppShell title="Entladeberichte">
      <div className="stack" style={{ gap: '0.85rem', maxWidth: 820 }}>
        <p className="muted" style={{ margin: 0, fontSize: '0.92rem', lineHeight: 1.4 }}>
          ETBs der letzten 30 Tage (Wareneingangskontrolle). Dateien liegen unter{' '}
          <code>uploads/entladeberichte/</code> auf dem Server und werden per Mail an
          info@worldofgreen.ch / mb@logistikberater.at gesendet.
        </p>

        <div className="row" style={{ gap: '0.5rem' }}>
          <button type="button" className="btn btn-secondary" style={{ minHeight: 44 }} onClick={() => void load()}>
            Aktualisieren
          </button>
        </div>

        {error ? <p className="error">{error}</p> : null}
        {loading ? <p className="muted">Laden…</p> : null}

        {!loading && !rows.length ? (
          <div className="panel">
            <p className="muted" style={{ margin: 0 }}>
              Noch keine Entladeberichte in den letzten 30 Tagen.
            </p>
          </div>
        ) : null}

        <div className="stack" style={{ gap: '0.45rem' }}>
          {rows.map((r) => (
            <div
              key={r.sessionId}
              className="panel row"
              style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>
                  {r.customer?.name || 'Kunde'} · {r.externalRef}
                </div>
                <div className="muted" style={{ fontSize: '0.85rem' }}>
                  Kontrolle {r.sessionDate}
                  {r.closedAt ? ` · abgeschlossen ${new Date(r.closedAt).toLocaleString('de-AT')}` : ''}
                  {r.fileName ? ` · ${r.fileName}` : ''}
                  {r.sizeBytes != null ? ` · ${Math.round(r.sizeBytes / 1024)} KB` : ''}
                </div>
              </div>
              {r.documentId ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ minHeight: 44 }}
                  onClick={() =>
                    void downloadEtb(r.documentId!, r.fileName || `ETB-${r.externalRef}.pdf`).catch((e) =>
                      setError(e.message),
                    )
                  }
                >
                  PDF laden
                </button>
              ) : (
                <span className="muted">kein PDF</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
