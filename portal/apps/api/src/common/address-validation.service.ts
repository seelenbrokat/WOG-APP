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

const COUNTRY_NAME: Record<string, string> = {
  AT: 'Austria',
  CH: 'Switzerland',
  DE: 'Germany',
  LI: 'Liechtenstein',
  IT: 'Italy',
};

function norm(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/strasse/g, 'str')
    .replace(/straße/g, 'str')
    .replace(/[^a-z0-9]/g, '');
}

function extractHouseNumber(street: string): string | null {
  const m = String(street || '').match(/\b(\d+[a-zA-Z]?)\s*$/);
  return m ? m[1].toLowerCase() : null;
}

function streetCore(street: string): string {
  return norm(String(street || '').replace(/\b\d+[a-zA-Z]?\s*$/, ''));
}

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

    const raw = await this.searchNominatim({ street, zip, city, country });
    const scored = raw
      .map((row) => this.mapNominatim(row, country))
      .filter((s): s is AddressSuggestion => !!s)
      .map((s) => ({
        ...s,
        confidence: this.scoreAgainstInput(s, { street, zip, city, country }),
      }))
      .sort((a, b) => b.confidence - a.confidence);

    // Dedup ähnliche Treffer
    const suggestions: AddressSuggestion[] = [];
    const seen = new Set<string>();
    for (const s of scored) {
      const key = `${norm(s.street)}|${s.zip}|${norm(s.city)}|${s.country}`;
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push(s);
      if (suggestions.length >= 5) break;
    }

    if (!suggestions.length) {
      return {
        ok: false,
        status: 'INVALID',
        message: 'Adresse nicht gefunden. Bitte Straße, PLZ, Ort und Land prüfen.',
        suggestions: [],
      };
    }

    const best = suggestions[0];
    const zipOk = this.zipEquals(best.zip, zip);
    const cityOk = this.cityMatches(best.city, city);
    const streetOk = this.streetMatches(best.street, street);
    const houseIn = extractHouseNumber(street);
    const houseBest = extractHouseNumber(best.street);
    const houseOk = !houseIn || !houseBest || houseIn === houseBest;

    // Starker Treffer: PLZ + Ort, Straße oder zumindest Hausnummer am gleichen Ort
    if (best.confidence >= 0.82 && zipOk && cityOk && streetOk) {
      return {
        ok: true,
        status: 'VALID',
        message: 'Adresse gefunden und plausibel.',
        normalized: best,
        suggestions,
      };
    }

    // Plausible Adresse (z. B. anderer Straßenname in OSM, gleiche PLZ/Ort/Hausnr.)
    if (best.confidence >= 0.65 && zipOk && cityOk && houseOk) {
      const streetDiff = !streetOk;
      return {
        ok: true,
        status: streetDiff || suggestions.length > 1 ? 'AMBIGUOUS' : 'VALID',
        message: streetDiff
          ? 'Adresse gefunden – Straßennamen prüfen und ggf. Vorschlag übernehmen.'
          : suggestions.length > 1
            ? 'Adresse gefunden – bitte Treffer prüfen und ggf. übernehmen.'
            : 'Adresse gefunden und plausibel.',
        normalized: best,
        suggestions,
      };
    }

    if (best.confidence >= 0.5 && (zipOk || cityOk)) {
      return {
        ok: true,
        status: 'AMBIGUOUS',
        message: 'Mehrere oder ungenaue Treffer – bitte auswählen oder korrigieren.',
        normalized: best,
        suggestions,
      };
    }

    return {
      ok: false,
      status: 'INVALID',
      message: 'Adresse nicht eindeutig gefunden. Bitte korrigieren oder einen Vorschlag übernehmen.',
      normalized: best,
      suggestions,
    };
  }

  private async searchNominatim(input: {
    street: string;
    zip: string;
    city: string;
    country: string;
  }): Promise<any[]> {
    // 1) Strukturierte Suche (zuverlässiger für Hausnummern)
    const structured = await this.fetchNominatim(
      new URLSearchParams({
        format: 'jsonv2',
        addressdetails: '1',
        limit: '5',
        street: input.street,
        city: input.city,
        postalcode: input.zip,
        country: COUNTRY_NAME[input.country] || input.country,
        countrycodes: input.country.toLowerCase(),
      }),
    );
    if (structured.length) return structured;

    // 2) Freitext-Fallback
    const q = `${input.street}, ${input.zip} ${input.city}, ${input.country}`;
    return this.fetchNominatim(
      new URLSearchParams({
        format: 'jsonv2',
        addressdetails: '1',
        limit: '5',
        countrycodes: input.country.toLowerCase(),
        q,
      }),
    );
  }

  private async fetchNominatim(params: URLSearchParams): Promise<any[]> {
    const wait = Math.max(0, 1100 - (Date.now() - this.lastCallAt));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    this.lastCallAt = Date.now();

    const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'WOG-Portal/1.0 (https://wog.logistikberater.at; address-check)',
        },
      });
      if (!res.ok) {
        this.logger.warn(`Nominatim HTTP ${res.status}`);
        return [];
      }
      const raw = (await res.json()) as any[];
      return Array.isArray(raw) ? raw : [];
    } catch (err: any) {
      this.logger.warn(`Nominatim error: ${err?.message || err}`);
      return [];
    }
  }

  private scoreAgainstInput(
    suggestion: AddressSuggestion,
    input: { street: string; zip: string; city: string; country: string },
  ): number {
    let score = 0.2;
    if (this.zipEquals(suggestion.zip, input.zip)) score += 0.35;
    if (this.cityMatches(suggestion.city, input.city)) score += 0.25;
    if (suggestion.country === input.country) score += 0.05;

    if (this.streetMatches(suggestion.street, input.street)) {
      score += 0.25;
    } else {
      // Hausnummer am gleichen Ort oft trotzdem korrekt (z. B. Bundesstraße vs. Vorarlberger Straße)
      const hin = extractHouseNumber(input.street);
      const hsug = extractHouseNumber(suggestion.street);
      if (hin && hsug && hin === hsug && this.zipEquals(suggestion.zip, input.zip)) {
        score += 0.12;
      }
    }
    return Math.max(0.05, Math.min(0.99, score));
  }

  private zipEquals(a: string, b: string): boolean {
    return String(a || '').replace(/\s/g, '') === String(b || '').replace(/\s/g, '');
  }

  private cityMatches(a: string, b: string): boolean {
    const na = norm(a);
    const nb = norm(b);
    if (!na || !nb) return false;
    return na === nb || na.includes(nb) || nb.includes(na);
  }

  private streetMatches(a: string, b: string): boolean {
    const ca = streetCore(a);
    const cb = streetCore(b);
    if (!ca || !cb) return false;
    if (ca === cb) return true;
    if (ca.includes(cb) || cb.includes(ca)) return true;
    const ha = extractHouseNumber(a);
    const hb = extractHouseNumber(b);
    if (ha && hb && ha !== hb) return false;
    return false;
  }

  private mapNominatim(row: any, fallbackCountry: string): AddressSuggestion | null {
    const addr = row?.address || {};
    const street =
      [addr.road || addr.pedestrian || addr.footway || addr.residential, addr.house_number]
        .filter(Boolean)
        .join(' ') || String(row?.name || '').trim();
    const zip = String(addr.postcode || '').trim();
    const city = String(
      addr.city ||
        addr.town ||
        addr.village ||
        addr.municipality ||
        addr.city_district ||
        addr.suburb ||
        '',
    ).trim();
    const country = String(addr.country_code || fallbackCountry)
      .trim()
      .toUpperCase();
    if (!street && !city) return null;
    return {
      street: street || '—',
      zip: zip || '',
      city: city || '',
      country: country.slice(0, 2),
      displayName: String(row?.display_name || `${street}, ${zip} ${city}`),
      lat: row?.lat != null ? Number(row.lat) : undefined,
      lon: row?.lon != null ? Number(row.lon) : undefined,
      confidence: 0.5,
    };
  }
}
