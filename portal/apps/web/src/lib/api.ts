const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

export type SessionUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  organizationId: string;
  customerId?: string | null;
  customerName?: string;
  mandantIds: string[];
  mustChangePassword?: boolean;
};

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('wog_token');
}

export function setSession(token: string, user: SessionUser) {
  localStorage.setItem('wog_token', token);
  localStorage.setItem('wog_user', JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem('wog_token');
  localStorage.removeItem('wog_user');
}

export function getUser(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('wog_user');
  return raw ? (JSON.parse(raw) as SessionUser) : null;
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (options.auth !== false) {
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || `Fehler ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return res as unknown as T;
}

export function statusLabel(status: string) {
  const map: Record<string, string> = {
    DRAFT: 'Entwurf',
    SUBMITTED: 'Übermittelt',
    ACCEPTED: 'Angenommen',
    PICKED_UP: 'Abgeholt',
    IN_TRANSIT: 'Unterwegs',
    OUT_FOR_DELIVERY: 'In Zustellung',
    DELIVERED: 'Zugestellt',
    EXCEPTION: 'Störung',
    CANCELLED: 'Storniert',
  };
  return map[status] || status;
}
