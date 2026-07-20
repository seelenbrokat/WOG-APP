/** HTTP-Client für die WOG-Portal-API (JWT). */

export type WogUser = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  role: string;
  organizationId: string;
  customerId?: string | null;
  customerName?: string | null;
  mandantIds?: string[];
};

export class WogApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'WogApiError';
  }
}

export class WogApiClient {
  private baseUrl: string;
  private token: string | null;
  private email?: string;
  private password?: string;
  private user: WogUser | null = null;

  constructor(opts?: {
    baseUrl?: string;
    token?: string;
    email?: string;
    password?: string;
  }) {
    const raw =
      opts?.baseUrl ||
      process.env.WOG_API_URL ||
      'https://wog.logistikberater.at/api';
    this.baseUrl = raw.replace(/\/$/, '');
    this.token = opts?.token || process.env.WOG_ACCESS_TOKEN || null;
    this.email = opts?.email || process.env.WOG_EMAIL;
    this.password = opts?.password || process.env.WOG_PASSWORD;
  }

  getApiUrl() {
    return this.baseUrl;
  }

  getUser() {
    return this.user;
  }

  async ensureAuth(): Promise<string> {
    if (this.token) return this.token;
    if (!this.email || !this.password) {
      throw new Error(
        'Keine Anmeldedaten: WOG_ACCESS_TOKEN oder WOG_EMAIL + WOG_PASSWORD setzen.',
      );
    }
    const res = await this.requestRaw<{ accessToken: string; user: WogUser }>(
      'POST',
      '/auth/login',
      { email: this.email, password: this.password },
      false,
    );
    this.token = res.accessToken;
    this.user = res.user;
    return this.token;
  }

  async whoami(): Promise<WogUser> {
    await this.ensureAuth();
    this.user = await this.request<WogUser>('GET', '/auth/me');
    return this.user;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    auth = true,
  ): Promise<T> {
    if (auth) await this.ensureAuth();
    return this.requestRaw<T>(method, path, body, auth);
  }

  private async requestRaw<T>(
    method: string,
    path: string,
    body?: unknown,
    auth = true,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && this.token) headers.Authorization = `Bearer ${this.token}`;

    const url = path.startsWith('http') ? path : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!res.ok) {
      const msg =
        typeof data === 'object' && data && 'message' in data
          ? String((data as { message: unknown }).message)
          : `HTTP ${res.status}`;
      throw new WogApiError(msg, res.status, data);
    }
    return data as T;
  }
}

export function jsonResult(data: unknown, pretty = true) {
  return {
    content: [
      {
        type: 'text' as const,
        text: pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data),
      },
    ],
  };
}

export function errorResult(err: unknown) {
  const message =
    err instanceof WogApiError
      ? `API-Fehler ${err.status}: ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: message }],
  };
}
