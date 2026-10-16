import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DriverAuthUser } from './fahrer.types';

export type SmartborderCase = {
  token: string;
  url: string;
  deepLink: string;
  corridorType?: string;
  corridorTypeLabel?: string;
  licensePlateFront?: string;
  licensePlateRear?: string;
  reference?: string;
  warenortReached?: boolean;
  customsCleared?: boolean;
  expiresAt?: string | null;
};

export type SmartborderStatus = {
  hasOpenCase: boolean;
  licensePlate: string | null;
  count: number;
  cases: SmartborderCase[];
  companionScheme: string;
  apkUrl: string;
  downloadUrl: string;
};

type CorridorSession = {
  token?: string;
  url?: string;
  corridorType?: string;
  corridorTypeLabel?: string;
  expiresAt?: string | null;
  reference?: {
    orderExternalNumber?: string;
    licensePlateFront?: string;
    licensePlateRear?: string;
  };
  status?: {
    warenortReached?: boolean;
    customsCleared?: boolean;
    completed?: boolean;
  };
};

@Injectable()
export class FahrerSmartborderService {
  private readonly log = new Logger(FahrerSmartborderService.name);
  /** Cache offener Session-Tokens pro Kennzeichen (GPS-Pings) */
  private tokenCache = new Map<string, { at: number; tokens: string[] }>();

  constructor(private config: ConfigService) {}

  async statusForDriver(driver: DriverAuthUser): Promise<SmartborderStatus> {
    const apkUrl =
      this.config.get<string>('SMARTBORDER_APK_URL') ||
      'https://smartborder.logistikberater.at/geotracker/downloads/wog-companion.apk';
    const downloadUrl =
      this.config.get<string>('SMARTBORDER_DOWNLOAD_URL') ||
      'https://smartborder.logistikberater.at/geotracker/app-download.php';
    const companionScheme =
      this.config.get<string>('SMARTBORDER_COMPANION_SCHEME') || 'wogcompanion';

    const plateRaw = (driver.licensePlate || '').trim();
    if (!plateRaw) {
      return {
        hasOpenCase: false,
        licensePlate: null,
        count: 0,
        cases: [],
        companionScheme,
        apkUrl,
        downloadUrl,
      };
    }

    const cases = await this.loadOpenCases(plateRaw, companionScheme);
    this.tokenCache.set(this.normalizePlate(plateRaw), {
      at: Date.now(),
      tokens: cases.map((c) => c.token),
    });

    return {
      hasOpenCase: cases.length > 0,
      licensePlate: plateRaw,
      count: cases.length,
      cases,
      companionScheme,
      apkUrl,
      downloadUrl,
    };
  }

  /**
   * GPS der Zustellapp an alle offenen SmartBorder-Sessions des Zugfahrzeugs.
   * Fire-and-forget-freundlich; Fehler blockieren Soloplan nicht.
   */
  async forwardLocation(
    driver: DriverAuthUser,
    location: { latitude: number; longitude: number; accuracy?: number },
  ): Promise<{ forwarded: number; tokens: string[] }> {
    const plateRaw = (driver.licensePlate || '').trim();
    if (!plateRaw) return { forwarded: 0, tokens: [] };
    if (!location.latitude && !location.longitude) {
      return { forwarded: 0, tokens: [] };
    }

    const tokens = await this.openTokensForPlate(plateRaw);
    if (!tokens.length) return { forwarded: 0, tokens: [] };

    let forwarded = 0;
    const stillValid: string[] = [];
    await Promise.all(
      tokens.map(async (token) => {
        const ok = await this.postLocation(
          token,
          location.latitude,
          location.longitude,
          location.accuracy,
        );
        if (ok) {
          forwarded += 1;
          stillValid.push(token);
        }
      }),
    );

    this.tokenCache.set(this.normalizePlate(plateRaw), {
      at: Date.now(),
      tokens: stillValid,
    });
    return { forwarded, tokens: stillValid };
  }

  private async openTokensForPlate(plateRaw: string): Promise<string[]> {
    const key = this.normalizePlate(plateRaw);
    const cached = this.tokenCache.get(key);
    if (cached && Date.now() - cached.at < 60_000) {
      return cached.tokens;
    }
    const cases = await this.loadOpenCases(plateRaw, 'wogcompanion');
    const tokens = cases.map((c) => c.token);
    this.tokenCache.set(key, { at: Date.now(), tokens });
    return tokens;
  }

  private async loadOpenCases(
    plateRaw: string,
    companionScheme: string,
  ): Promise<SmartborderCase[]> {
    const candidates = this.plateCandidates(plateRaw);
    const found = new Map<string, SmartborderCase>();

    for (const plate of candidates) {
      const sessions = await this.fetchSessions(plate);
      for (const s of sessions) {
        if (!this.isOpenCase(s)) continue;
        const token = String(s.token || '');
        if (!token || found.has(token)) continue;
        found.set(token, {
          token,
          url:
            s.url ||
            `https://smartborder.logistikberater.at/geotracker/?t=${token}`,
          deepLink: `${companionScheme}://?t=${token}`,
          corridorType: s.corridorType,
          corridorTypeLabel: s.corridorTypeLabel,
          licensePlateFront: s.reference?.licensePlateFront,
          licensePlateRear: s.reference?.licensePlateRear,
          reference: s.reference?.orderExternalNumber,
          warenortReached: !!s.status?.warenortReached,
          customsCleared: !!s.status?.customsCleared,
          expiresAt: s.expiresAt ?? null,
        });
      }
    }
    return [...found.values()];
  }

  private async postLocation(
    token: string,
    lat: number,
    lng: number,
    accuracy?: number,
  ): Promise<boolean> {
    const base =
      this.config.get<string>('SMARTBORDER_API_BASE') ||
      'https://api.logistikberater.at';
    const url = `${base.replace(/\/$/, '')}/smartborder/v1/location`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          token,
          lat,
          lng,
          ...(accuracy != null ? { accuracy } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 404 || res.status === 400) {
        this.log.debug(`SB location skip token …${token.slice(-8)}: ${res.status}`);
        return false;
      }
      if (!res.ok) {
        this.log.warn(`SB location ${res.status} for …${token.slice(-8)}`);
        return false;
      }
      const data = (await res.json()) as { ok?: boolean; trackingStopped?: boolean };
      if (data.trackingStopped) return false;
      return data.ok !== false;
    } catch (e: any) {
      this.log.warn(`SB location failed: ${e?.message || e}`);
      return false;
    }
  }

  /** Zugfahrzeug-Kennzeichen: "SG432203/SG408255" → Front zuerst */
  private plateCandidates(raw: string): string[] {
    const parts = raw
      .split(/[\/|,;]+/)
      .map((p) => this.normalizePlate(p))
      .filter(Boolean);
    const full = this.normalizePlate(raw);
    const out: string[] = [];
    for (const p of [parts[0], full, ...parts.slice(1)]) {
      if (p && !out.includes(p) && p.length >= 3) out.push(p);
    }
    return out;
  }

  private normalizePlate(p: string): string {
    return p.toUpperCase().replace(/[\s\-.]/g, '');
  }

  private isOpenCase(s: CorridorSession): boolean {
    // Offen = noch nicht verzollt/abgeschlossen (Kennzeichen-Match vom SmartBorder)
    if (s.status?.customsCleared || s.status?.completed) return false;
    return !!s.token;
  }

  private async fetchSessions(plate: string): Promise<CorridorSession[]> {
    const base =
      this.config.get<string>('SMARTBORDER_API_BASE') ||
      'https://api.logistikberater.at';
    const key =
      this.config.get<string>('SMARTBORDER_INGEST_KEY') ||
      this.config.get<string>('GEOTRACKER_INGEST_KEY') ||
      '';

    if (!key) {
      this.log.warn('SMARTBORDER_INGEST_KEY missing – SmartBorder status disabled');
      return [];
    }

    const url = `${base.replace(/\/$/, '')}/smartborder/v1/corridor-status?plate=${encodeURIComponent(plate)}`;
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'X-Ingest-Key': key,
        },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        this.log.warn(`corridor-status ${res.status} for plate ${plate}`);
        return [];
      }
      const data = (await res.json()) as {
        sessions?: CorridorSession[];
      };
      return Array.isArray(data.sessions) ? data.sessions : [];
    } catch (e: any) {
      this.log.warn(`corridor-status failed: ${e?.message || e}`);
      return [];
    }
  }
}
