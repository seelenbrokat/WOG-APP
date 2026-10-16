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
 * Vor async Arbeit synchron öffnen (Firefox/Chrome Popup-Blocker).
 * Nach dem Fetch: showBlobInWindow(win, blob, …).
 */
export function openBlankTabForAsyncWork(): Window | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.open('about:blank', '_blank');
  } catch {
    return null;
  }
}

/** Blob im neuen Tab anzeigen; bei Popup-Block Download-Fallback. */
export function openBlobInNewTab(
  blob: Blob,
  fileName: string,
  mimeHint?: string | null,
  targetWin?: Window | null,
) {
  const type = resolveMime(blob, fileName, mimeHint);
  const typed = blob.type === type ? blob : new Blob([blob], { type });
  const url = URL.createObjectURL(typed);

  if (targetWin && !targetWin.closed) {
    try {
      targetWin.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
      return;
    } catch {
      try {
        targetWin.close();
      } catch {
        /* ignore */
      }
    }
  }

  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

/**
 * Blob als Datei speichern / öffnen.
 * PDFs: immer neuen Tab (wie früher erwartet); Download nur als Fallback.
 */
export function triggerBlobDownload(blob: Blob, fileName: string, mimeHint?: string | null) {
  const type = resolveMime(blob, fileName, mimeHint);
  const isPdf = type === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');

  if (isPdf) {
    openBlobInNewTab(blob, fileName, mimeHint);
    return;
  }

  const typed = blob.type === type ? blob : new Blob([blob], { type });
  const url = URL.createObjectURL(typed);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

/** Authentifizierten Dokument-Download / PDF-Tab auslösen. */
export async function downloadAuthenticated(
  path: string,
  fileName: string,
  opts?: { targetWin?: Window | null },
) {
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
  const mime = res.headers.get('content-type');
  const isPdf =
    (mime || '').includes('pdf') || fileName.toLowerCase().endsWith('.pdf') || isAppleTouchDevice();
  if (isPdf) {
    openBlobInNewTab(blob, fileName, mime, opts?.targetWin);
  } else {
    if (opts?.targetWin && !opts.targetWin.closed) {
      try {
        opts.targetWin.close();
      } catch {
        /* ignore */
      }
    }
    triggerBlobDownload(blob, fileName, mime);
  }
}

/** Shortcut: /documents/:id/download im neuen Tab (Etiketten/Ladeliste). */
export async function openDocumentInNewTab(
  docId: string,
  fileName: string,
  opts?: { targetWin?: Window | null },
) {
  return downloadAuthenticated(`/documents/${docId}/download`, fileName, opts);
}
