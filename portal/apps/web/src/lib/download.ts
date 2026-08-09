import { getToken } from '@/lib/api';

function resolveMime(blob: Blob, fileName: string, mimeHint?: string | null): string {
  if (blob.type && blob.type !== 'application/octet-stream') return blob.type;
  if (mimeHint && mimeHint !== 'application/octet-stream') return mimeHint;
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

function isAppleTouchDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS meldet sich teils als MacIntel mit Touch
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
}

/**
 * Blob als Datei speichern / öffnen.
 * Safari/iOS: Object-URL nicht sofort revoke; PDF in neuem Tab (download-Attribut oft wirkungslos).
 */
export function triggerBlobDownload(blob: Blob, fileName: string, mimeHint?: string | null) {
  const type = resolveMime(blob, fileName, mimeHint);
  const typed = blob.type === type ? blob : new Blob([blob], { type });
  const url = URL.createObjectURL(typed);
  const isPdf = type === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');

  if (isPdf && isAppleTouchDevice()) {
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (!win) {
      // Popup blockiert → gleiche Seite
      window.location.assign(url);
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    return;
  }

  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

/** Authentifizierten Dokument-Download auslösen. */
export async function downloadAuthenticated(path: string, fileName: string) {
  const base = process.env.NEXT_PUBLIC_API_URL || '/api';
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const token = getToken();
  if (!token) {
    throw new Error('Nicht angemeldet – bitte erneut einloggen');
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    const msg = Array.isArray(err?.message) ? err.message.join(', ') : err?.message;
    throw new Error(msg || `Download fehlgeschlagen (${res.status})`);
  }
  const blob = await res.blob();
  if (!blob.size) {
    throw new Error('Leere Datei empfangen');
  }
  triggerBlobDownload(blob, fileName, res.headers.get('content-type'));
}
