import { createHmac, timingSafeEqual } from 'crypto';

const PURPOSE = 'doc-dl';

type TokenPayload = {
  p: typeof PURPOSE;
  d: string;
  e: number;
};

/** Signierter Download-Token (z. B. für E-Mail-Links ohne Login). */
export function createDocumentDownloadToken(
  docId: string,
  secret: string,
  ttlSeconds = 30 * 24 * 60 * 60,
): string {
  const payload: TokenPayload = {
    p: PURPOSE,
    d: docId,
    e: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** Prüft Token und liefert documentId oder null. */
export function verifyDocumentDownloadToken(
  token: string,
  secret: string,
): { docId: string } | null {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (payload?.p !== PURPOSE || !payload.d || typeof payload.e !== 'number') return null;
    if (payload.e < Math.floor(Date.now() / 1000)) return null;
    return { docId: payload.d };
  } catch {
    return null;
  }
}
