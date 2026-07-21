import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { isValidZipForCountry } from '@wog/shared';

export type AddressValidationInput = {
  street?: string;
  zip?: string;
  city?: string;
  country?: string;
  company?: string;
};

export type AddressSuggestion = {
  street: string;
  zip: string;
  city: string;
  country: string;
  displayName: string;
  lat?: number;
  lon?: number;
  confidence: number;
};

export type AddressValidationResult = {
  ok: boolean;
  status: 'VALID' | 'AMBIGUOUS' | 'INVALID' | 'FORMAT_ERROR';
  message: string;
  normalized?: AddressSuggestion;
  suggestions: AddressSuggestion[];
};

@Injectable()
export class AddressValidationService {
  private readonly logger = new Logger(AddressValidationService.name);
  private lastCallAt = 0;

  async validate(input: AddressValidationInput): Promise<AddressValidationResult> {
    const street = String(input.street || '').trim();
    const zip = String(input.zip || '').trim();
    const city = String(input.city || '').trim();
    const country = String(input.country || '').trim().toUpperCase();

    if (!street || !zip || !city || !country) {
      throw new BadRequestException('Straße, PLZ, Ort und Land sind für die Adressprüfung nötig.');
    }
    if (country.length !== 2) {
      throw new BadRequestException('Land muss als ISO-Code (z. B. AT, CH, DE) angegeben werden.');
    }
    if (!isValidZipForCountry(zip, country)) {
      return {
        ok: false,
        status: 'FORMAT_ERROR',
        message: `PLZ-Format für ${country} ungültig (${zip}).`,
        suggestions: [],
      };
    }

    // Nominatim: max. 1 Request/Sekunde
    const wait = Math.max(0, 1100 - (Date.now() - this.lastCallAt));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    this.lastCallAt = Date.now();

    const query = `${street}, ${zip} ${city}, ${country}`;
    const url =
      `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5` +
      `&countrycodes=${encodeURIComponent(country.toLowerCase())}` +
      `&q=${encodeURIComponent(query)}`;

    let raw: any[] = [];
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'WOG-Portal/1.0 (https://wog.logistikberater.at; address-check)',
        },
      });
      if (!res.ok) {
        this.logger.warn(`Nominatim HTTP ${res.status}`);
        return {
          ok: false,
          status: 'INVALID',
          message: 'Adressprüfung vorübergehend nicht erreichbar. Bitte später erneut versuchen.',
          suggestions: [],
        };
      }
      raw = (await res.json()) as any[];
    } catch (err: any) {
      this.logger.warn(`Nominatim error: ${err?.message || err}`);
      return {
        ok: false,
        status: 'INVALID',
        message: 'Adressprüfung fehlgeschlagen (Netzwerk).',
        suggestions: [],
      };
    }

    const suggestions = raw
      .map((row) => this.mapNominatim(row, country))
      .filter((s): s is AddressSuggestion => !!s);

    if (!suggestions.length) {
      return {
        ok: false,
        status: 'INVALID',
        message: 'Adresse nicht gefunden. Bitte Straße, PLZ, Ort und Land prüfen.',
        suggestions: [],
      };
    }

    const best = suggestions[0];
    const zipMatch = best.zip && best.zip.replace(/\s/g, '') === zip.replace(/\s/g, '');
    const cityMatch =
      best.city &&
      best.city.toLowerCase().includes(city.toLowerCase().slice(0, 3));
    const strong = best.confidence >= 0.7 && (zipMatch || cityMatch);

    if (suggestions.length === 1 && strong) {
      return {
        ok: true,
        status: 'VALID',
        message: 'Adresse gefunden und plausibel.',
        normalized: best,
        suggestions,
      };
    }

    if (strong) {
      return {
        ok: true,
        status: 'AMBIGUOUS',
        message: 'Adresse gefunden – bitte Treffer prüfen und ggf. übernehmen.',
        normalized: best,
        suggestions,
      };
    }

    return {
      ok: false,
      status: 'AMBIGUOUS',
      message: 'Mehrere oder ungenaue Treffer – bitte auswählen oder korrigieren.',
      normalized: best,
      suggestions,
    };
  }

  private mapNominatim(row: any, fallbackCountry: string): AddressSuggestion | null {
    const addr = row?.address || {};
    const street =
      [addr.road || addr.pedestrian || addr.footway, addr.house_number].filter(Boolean).join(' ') ||
      String(row?.name || '').trim();
    const zip = String(addr.postcode || '').trim();
    const city = String(
      addr.city || addr.town || addr.village || addr.municipality || addr.suburb || '',
    ).trim();
    const country = String(addr.country_code || fallbackCountry)
      .trim()
      .toUpperCase();
    if (!street && !city) return null;
    const importance = Number(row?.importance);
    const confidence = Number.isFinite(importance)
      ? Math.max(0.35, Math.min(0.99, importance))
      : 0.5;
    return {
      street: street || '—',
      zip: zip || '',
      city: city || '',
      country: country.slice(0, 2),
      displayName: String(row?.display_name || `${street}, ${zip} ${city}`),
      lat: row?.lat != null ? Number(row.lat) : undefined,
      lon: row?.lon != null ? Number(row.lon) : undefined,
      confidence,
    };
  }
}
