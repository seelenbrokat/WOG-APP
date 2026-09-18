import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import {
  describeImportPayload,
  extractBusinessPartners,
  ParsedBusinessPartner,
} from './business-partner.parser';

@Injectable()
export class BusinessPartnerService {
  private readonly logger = new Logger(BusinessPartnerService.name);
  /** SFTP: inbound/soloplan/business-partners */
  private inboundDir: string;
  /** Alter Pfad integrations/.../in (falls noch genutzt) */
  private legacyInboundDir?: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private audit: AuditService,
  ) {
    // Primär: SFTP-Upload-Pfad (Chroot data/sftp → inbound/soloplan/business-partners)
    const sftpInbound =
      this.config.get('SFTP_INBOUND_DIR') ||
      join(process.cwd(), '../../data/sftp/inbound');
    this.inboundDir = join(sftpInbound, 'soloplan', 'business-partners');
    if (!existsSync(this.inboundDir)) mkdirSync(this.inboundDir, { recursive: true });

    // Kompatibilität: alter Integrations-Pfad weiter mitlesen
    const legacy =
      this.config.get('SOLOPLAN_BP_IN_DIR') ||
      join(
        this.config.get('INTEGRATION_DIR') || join(process.cwd(), '../../data/integrations'),
        'soloplan',
        'business-partners',
        'in',
      );
    if (existsSync(legacy) && legacy !== this.inboundDir) {
      this.legacyInboundDir = legacy;
    }
  }

  async list(user: AuthUser) {
    const [customers, partners] = await Promise.all([
      this.prisma.customer.findMany({
        where: {
          organizationId: user.organizationId,
          soloplanBusinessPartnerId: { not: null },
        },
        include: {
          contacts: { orderBy: { name: 'asc' } },
          users: { select: { id: true, email: true, firstName: true, lastName: true, active: true } },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.partner.findMany({
        where: {
          organizationId: user.organizationId,
          soloplanBusinessPartnerId: { not: null },
        },
        include: {
          contacts: { orderBy: { name: 'asc' } },
        },
        orderBy: { name: 'asc' },
      }),
    ]);
    return { customers, partners };
  }

  async importJson(
    actor: AuthUser,
    payload: unknown,
    opts: { kind?: 'CUSTOMER' | 'PARTNER'; fileName?: string } = {},
  ) {
    const parsed = extractBusinessPartners(payload, opts.kind);
    if (!parsed.length) {
      throw new BadRequestException(
        `Keine BusinessPartner in der Datei gefunden (PORTALGP.v1-BusinessPartner, Soloplan-Tour-JSON mit OriginalBusinessPartner oder BP-Array erwartet). Erkannt: ${describeImportPayload(payload)}`,
      );
    }

    const results = [];
    for (const bp of parsed) {
      results.push(await this.upsertParsed(actor.organizationId, bp));
    }

    await this.audit.log(
      actor.id,
      'soloplan.businessPartner.import',
      'Customer',
      undefined,
      { count: results.length, fileName: opts.fileName },
    );

    return {
      ok: true,
      imported: results.length,
      fileName: opts.fileName,
      items: results,
    };
  }

  async importFileBuffer(actor: AuthUser, fileName: string, content: Buffer, kind?: 'CUSTOMER' | 'PARTNER') {
    let data: unknown;
    try {
      data = this.parseJsonBuffer(content);
    } catch (err: any) {
      throw new BadRequestException(err?.message || 'Ungültiges JSON');
    }
    return this.importJson(actor, data, { kind, fileName });
  }

  /** UTF-8/UTF-16 + optional NDJSON (eine BP-Zeile pro Zeile). */
  private parseJsonBuffer(content: Buffer): unknown {
    let text = '';
    if (content.length >= 2 && content[0] === 0xff && content[1] === 0xfe) {
      text = content.toString('utf16le');
    } else if (content.length >= 2 && content[0] === 0xfe && content[1] === 0xff) {
      // UTF-16 BE → über swap grob nach LE
      const swapped = Buffer.alloc(content.length - 2);
      for (let i = 2; i + 1 < content.length; i += 2) {
        swapped[i - 2] = content[i + 1];
        swapped[i - 1] = content[i];
      }
      text = swapped.toString('utf16le');
    } else {
      text = content.toString('utf8');
    }
    text = text.replace(/^\uFEFF/, '').trim();
    if (!text) throw new Error('Leere Datei');

    try {
      return JSON.parse(text);
    } catch {
      // NDJSON: mehrere JSON-Objekte zeilenweise
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length > 1) {
        const items = [];
        for (const line of lines) {
          try {
            items.push(JSON.parse(line));
          } catch {
            throw new Error('Ungültiges JSON');
          }
        }
        return items;
      }
      throw new Error('Ungültiges JSON');
    }
  }

  /** Worker: Dateien aus SFTP inbound/soloplan/business-partners (+ Legacy-Pfad) */
  async processInboundDir(organizationId?: string) {
    const org =
      (organizationId
        ? await this.prisma.organization.findUnique({ where: { id: organizationId } })
        : null) ||
      (await this.prisma.organization.findFirst({ where: { slug: 'wog' } }));
    if (!org) return { processed: 0 };

    let processed = 0;
    for (const dir of [this.inboundDir, this.legacyInboundDir].filter(Boolean) as string[]) {
      if (!existsSync(dir)) continue;
      processed += await this.processDir(dir, org.id);
    }
    return { processed };
  }

  private async processDir(dir: string, organizationId: string) {
    // Soloplan liefert oft ".Json" (Großschreibung) – case-insensitive filtern.
    const files = readdirSync(dir).filter((f) => {
      const lower = f.toLowerCase();
      if (!lower.endsWith('.json')) return false;
      return (
        f.includes('BusinessPartner') ||
        lower.includes('businesspartner') ||
        f.startsWith('PORTALGP') ||
        lower.includes('business-partner') ||
        lower.includes('gpportal')
      );
    });
    let processed = 0;
    const processedDir = join(dir, 'processed');
    if (!existsSync(processedDir)) mkdirSync(processedDir, { recursive: true });

    for (const fileName of files) {
      const full = join(dir, fileName);
      try {
        const data = this.parseJsonBuffer(readFileSync(full));
        const parsed = extractBusinessPartners(data);
        for (const bp of parsed) {
          await this.upsertParsed(organizationId, bp);
        }
        renameSync(full, join(processedDir, `${Date.now()}_${fileName}`));
        processed += 1;
        this.logger.log(`BusinessPartner import ${fileName}: ${parsed.length} Datensätze`);
      } catch (err: any) {
        this.logger.error(`BusinessPartner import failed ${fileName}`, err?.message || err);
      }
    }
    return processed;
  }

  private async upsertParsed(organizationId: string, bp: ParsedBusinessPartner) {
    if (bp.kind === 'PARTNER') {
      return this.upsertPartner(organizationId, bp);
    }
    return this.upsertCustomer(organizationId, bp);
  }

  private async upsertCustomer(organizationId: string, bp: ParsedBusinessPartner) {
    const customerNumber = bp.matchcode || `BP-${bp.businessPartnerId}`;
    const existing = await this.prisma.customer.findFirst({
      where: {
        organizationId,
        OR: [
          { soloplanBusinessPartnerId: bp.businessPartnerId },
          { customerNumber },
          ...(bp.matchcode ? [{ matchcode: bp.matchcode }] : []),
        ],
      },
    });

    const data = {
      name: bp.name2 ? `${bp.name} ${bp.name2}` : bp.name,
      email: bp.email,
      phone: bp.phone,
      vatId: bp.vatId,
      soloplanBusinessPartnerId: bp.businessPartnerId,
      matchcode: bp.matchcode,
      active: true,
    };

    const customer = existing
      ? await this.prisma.customer.update({ where: { id: existing.id }, data })
      : await this.prisma.customer.create({
          data: {
            organizationId,
            customerNumber,
            ...data,
          },
        });

    if (bp.street && bp.zip && bp.city) {
      const addrCount = await this.prisma.address.count({ where: { customerId: customer.id } });
      if (addrCount === 0) {
        await this.prisma.address.create({
          data: {
            customerId: customer.id,
            label: 'Soloplan Hauptadresse',
            company: customer.name,
            street: bp.street,
            zip: bp.zip,
            city: bp.city,
            country: (bp.country || 'AT').slice(0, 2).toUpperCase(),
            usage: 'BOTH',
            isDefault: true,
          },
        });
      }
    }

    const contacts = await this.syncContacts({ customerId: customer.id }, bp);
    return { kind: 'CUSTOMER' as const, id: customer.id, businessPartnerId: bp.businessPartnerId, matchcode: bp.matchcode, name: customer.name, contacts };
  }

  private async upsertPartner(organizationId: string, bp: ParsedBusinessPartner) {
    const code = bp.matchcode || `BP-${bp.businessPartnerId}`;
    const existing = await this.prisma.partner.findFirst({
      where: {
        organizationId,
        OR: [
          { soloplanBusinessPartnerId: bp.businessPartnerId },
          { code },
          ...(bp.matchcode ? [{ matchcode: bp.matchcode }] : []),
        ],
      },
    });

    const data = {
      name: bp.name2 ? `${bp.name} ${bp.name2}` : bp.name,
      email: bp.email,
      phone: bp.phone,
      soloplanBusinessPartnerId: bp.businessPartnerId,
      matchcode: bp.matchcode,
      active: true,
    };

    const partner = existing
      ? await this.prisma.partner.update({ where: { id: existing.id }, data })
      : await this.prisma.partner.create({
          data: { organizationId, code, ...data },
        });

    const contacts = await this.syncContacts({ partnerId: partner.id }, bp);
    return { kind: 'PARTNER' as const, id: partner.id, businessPartnerId: bp.businessPartnerId, matchcode: bp.matchcode, name: partner.name, contacts };
  }

  private async syncContacts(
    link: { customerId?: string; partnerId?: string },
    bp: ParsedBusinessPartner,
  ) {
    const saved = [];
    const keepIds = new Set<string>();
    for (const c of bp.contacts) {
      if (!c.email && !c.name) continue;
      let existing =
        (c.email
          ? await this.prisma.contact.findFirst({
              where: { ...link, email: c.email.toLowerCase() },
            })
          : null) ||
        (c.number !== undefined
          ? await this.prisma.contact.findFirst({
              where: { ...link, soloplanContactNumber: c.number },
            })
          : null);

      // Alte Imports ohne E-Mail: gleicher Name am Kunden/Partner
      if (!existing && c.email) {
        existing = await this.prisma.contact.findFirst({
          where: {
            ...link,
            OR: [{ email: null }, { email: '' }],
            name: c.name,
          },
        });
      }

      const data = {
        name: c.name,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email?.toLowerCase(),
        phone: c.phone,
        role: c.role,
        department: c.department,
        soloplanContactNumber: c.number,
        customerId: link.customerId,
        partnerId: link.partnerId,
      };

      const row = existing
        ? await this.prisma.contact.update({ where: { id: existing.id }, data })
        : await this.prisma.contact.create({ data });
      keepIds.add(row.id);
      saved.push(row);
    }

    // Kontakte, die nicht mehr im Soloplan-Export sind, entfernen
    // (inkl. früherem Firmen-E-Mail-Fallback).
    if (keepIds.size && (link.customerId || link.partnerId)) {
      await this.prisma.contact.deleteMany({
        where: {
          ...link,
          id: { notIn: [...keepIds] },
        },
      });
    }
    return saved;
  }

  async getContact(organizationId: string, contactId: string) {
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      include: { customer: true, partner: true },
    });
    if (!contact) throw new NotFoundException('Kontakt nicht gefunden');
    const orgId = contact.customer?.organizationId || contact.partner?.organizationId;
    if (orgId !== organizationId) throw new NotFoundException('Kontakt nicht gefunden');
    return contact;
  }
}
