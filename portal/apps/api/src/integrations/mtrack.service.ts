import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type MtrackFleetPosition = {
  id: string;
  vehicleId: number;
  vehicleName: string;
  latitude: number;
  longitude: number;
  locationAt: string | null;
  heading: number | null;
  speed: number | null;
  vehicleStatus: string | null;
  ignition: boolean | null;
  driverId: string | null;
  driverName: string | null;
  address: string | null;
  vehicleGroupName: string | null;
  gprsOnline: boolean | null;
};

type LoginResponse = {
  success?: boolean;
  message?: string | null;
  data?: { appToken?: string; twoFaValueRequired?: boolean } | null;
};

type PositionRow = {
  vehicleId?: number;
  vehicleName?: string | null;
  lat?: number | null;
  lon?: number | null;
  eventTime?: string | null;
  heading?: number | null;
  speed?: number | null;
  vehicleStatus?: string | null;
  ignition?: boolean | null;
  driverId?: number | string | null;
  driverName?: string | null;
  lastDriverId?: number | string | null;
  lastDriverName?: string | null;
  country?: string | null;
  zipCode?: string | null;
  city?: string | null;
  street?: string | null;
  houseNumber?: string | null;
  poiName?: string | null;
  vehicleGroupName?: string | null;
  gprsOnline?: boolean | null;
};

@Injectable()
export class MtrackService {
  private readonly logger = new Logger(MtrackService.name);
  private cookieToken: string | null = null;
  private cookieExpiresAtMs = 0;

  constructor(private config: ConfigService) {}

  enabled() {
    return (
      String(this.config.get('MTRACK_ENABLED') || '').toLowerCase() === 'true' &&
      !!this.username() &&
      !!this.password()
    );
  }

  private baseUrl() {
    return String(this.config.get('MTRACK_BASE_URL') || 'https://mtrack.eu').replace(/\/$/, '');
  }

  private username() {
    return String(this.config.get('MTRACK_USERNAME') || this.config.get('MTRACK_USER') || '').trim();
  }

  private password() {
    return String(this.config.get('MTRACK_PASSWORD') || '').trim();
  }

  private loginTo() {
    const raw = String(this.config.get('MTRACK_LOGIN_TO') || 'desktop').trim().toLowerCase();
    return ['desktop', 'app', 'mobile'].includes(raw) ? raw : 'desktop';
  }

  /** Live-Positionen aller sichtbaren mTrack-Fahrzeuge. */
  async getFleetPositions(): Promise<MtrackFleetPosition[]> {
    if (!this.enabled()) return [];

    try {
      const token = await this.ensureCookieToken();
      const res = await fetch(`${this.baseUrl()}/api/vehicle/position`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          Cookie: `CookieToken=${token}`,
        },
      });
      if (res.status === 401 || res.status === 403) {
        this.cookieToken = null;
        this.cookieExpiresAtMs = 0;
        const retryToken = await this.ensureCookieToken(true);
        const retry = await fetch(`${this.baseUrl()}/api/vehicle/position`, {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${retryToken}`,
            Cookie: `CookieToken=${retryToken}`,
          },
        });
        if (!retry.ok) {
          throw new Error(`mTrack positions HTTP ${retry.status}`);
        }
        return this.mapPositions(await retry.json());
      }
      if (!res.ok) {
        throw new Error(`mTrack positions HTTP ${res.status}`);
      }
      return this.mapPositions(await res.json());
    } catch (err) {
      this.logger.warn(
        `mTrack Positionen nicht geladen: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  private mapPositions(body: { success?: boolean; data?: PositionRow[] | null }): MtrackFleetPosition[] {
    const rows = Array.isArray(body?.data) ? body.data : [];
    return rows
      .filter((r) => r.vehicleId != null && r.lat != null && r.lon != null)
      .map((r) => {
        const driverName = (r.driverName || r.lastDriverName || '').trim() || null;
        const driverId = r.driverId != null ? String(r.driverId) : r.lastDriverId != null ? String(r.lastDriverId) : null;
        const address = [
          [r.street, r.houseNumber].filter(Boolean).join(' ').trim(),
          [r.zipCode, r.city].filter(Boolean).join(' ').trim(),
          r.country,
          r.poiName ? `(${r.poiName})` : null,
        ]
          .filter(Boolean)
          .join(', ');
        return {
          id: `mtrack:${r.vehicleId}`,
          vehicleId: Number(r.vehicleId),
          vehicleName: String(r.vehicleName || `Fahrzeug ${r.vehicleId}`).trim(),
          latitude: Number(r.lat),
          longitude: Number(r.lon),
          locationAt: r.eventTime || null,
          heading: r.heading ?? null,
          speed: r.speed ?? null,
          vehicleStatus: r.vehicleStatus || null,
          ignition: r.ignition ?? null,
          driverId,
          driverName,
          address: address || null,
          vehicleGroupName: r.vehicleGroupName || null,
          gprsOnline: r.gprsOnline ?? null,
        };
      });
  }

  private async ensureCookieToken(force = false): Promise<string> {
    const now = Date.now();
    if (!force && this.cookieToken && now < this.cookieExpiresAtMs - 60_000) {
      return this.cookieToken;
    }

    const loginRes = await fetch(`${this.baseUrl()}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        userName: this.username(),
        password: this.password(),
        loginTo: this.loginTo(),
        rememberMe: true,
        version: 'current',
        appNative: false,
        twoFaCode: '',
        smartphoneUuid: '',
        key: '',
      }),
    });
    if (!loginRes.ok) {
      throw new Error(`mTrack login HTTP ${loginRes.status}`);
    }
    const loginJson = (await loginRes.json()) as LoginResponse;
    const appToken = loginJson?.data?.appToken;
    if (!loginJson?.success || !appToken) {
      throw new Error(`mTrack login fehlgeschlagen: ${loginJson?.message || 'ohne Token'}`);
    }

    const redirectUrl = encodeURIComponent('/app/');
    const authRes = await fetch(
      `${this.baseUrl()}/api/auth/app?redirectUrl=${redirectUrl}&appToken=${encodeURIComponent(appToken)}`,
      {
        redirect: 'manual',
        headers: { Accept: 'application/json, text/html' },
      },
    );
    const setCookie = authRes.headers.getSetCookie?.() || [];
    const cookieHeader = authRes.headers.get('set-cookie') || '';
    const cookieParts = setCookie.length ? setCookie : cookieHeader ? [cookieHeader] : [];
    let cookieToken: string | null = null;
    for (const part of cookieParts) {
      const m = /(?:^|,\s*)CookieToken=([^;]+)/.exec(part);
      if (m?.[1]) {
        cookieToken = decodeURIComponent(m[1]);
        break;
      }
    }
    // Fallback: manche Node-Versionen liefern nur eine set-cookie Zeile
    if (!cookieToken) {
      const m = /CookieToken=([^;]+)/.exec(cookieHeader);
      if (m?.[1]) cookieToken = decodeURIComponent(m[1]);
    }
    if (!cookieToken) {
      throw new Error('mTrack CookieToken fehlt nach /api/auth/app');
    }

    this.cookieToken = cookieToken;
    this.cookieExpiresAtMs = this.readJwtExpMs(cookieToken) || now + 6 * 60 * 60 * 1000;
    this.logger.log(`mTrack Session aktiv (Login ${this.username()}, bis ${new Date(this.cookieExpiresAtMs).toISOString()})`);
    return cookieToken;
  }

  private readJwtExpMs(token: string): number | null {
    try {
      const payload = token.split('.')[1];
      if (!payload) return null;
      const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: number };
      return typeof json.exp === 'number' ? json.exp * 1000 : null;
    } catch {
      return null;
    }
  }
}
