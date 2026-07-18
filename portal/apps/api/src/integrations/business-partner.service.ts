import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { extractBusinessPartners, ParsedBusinessPartner } from './business-partner.parser';

@Injectable()
export class BusinessPartnerService {
  private readonly logger = new Logger(BusinessPartnerService.name);
  private inboundDir: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private audit: AuditService,
  ) {
    const base =
      this.config.get('INTEGRATION_DIR') ||
      join(process.cwd(), '../../data/integrations');
    this.inboundDir = join(base, 'soloplan', 'business-partners', 'in');
    if (!existsSync(this.inboundDir)) mkdirSync(this.inboundDir, { recursive: true });
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
        'Keine BusinessPartner in der Datei gefunden (PORTALGP.v1-BusinessPartner erwartet).',
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
      data = JSON.parse(content.toString('utf8').replace(/^\uFEFF/, ''));
    } catch {
      throw new BadRequestException('Ungültiges JSON');
    }
    return this.importJson(actor, data, { kind, fileName });
  }

  /** Worker: Dateien aus integrations/soloplan/business-partners/in */
  async processInboundDir(organizationId?: string) {
    if (!existsSync(this.inboundDir)) return { processed: 0 };
    const org =
      (organizationId
        ? await this.prisma.organization.findUnique({ where: { id: organizationId } })
        : null) ||
      (await this.prisma.organization.findFirst({ where: { slug: 'wog' } }));
    if (!org) return { processed: 0 };

    const files = readdirSync(this.inboundDir).filter(
      (f) =>
        f.endsWith('.json') &&
        (f.includes('BusinessPartner') || f.startsWith('PORTALGP') || f.includes('business-partner')),
    );
    let processed = 0;
    const processedDir = join(this.inboundDir, 'processed');
    if (!existsSync(processedDir)) mkdirSync(processedDir, { recursive: true });

    for (const fileName of files) {
      const full = join(this.inboundDir, fileName);
      try {
        const data = JSON.parse(readFileSync(full, 'utf8').replace(/^\uFEFF/, ''));
        const parsed = extractBusinessPartners(data);
        for (const bp of parsed) {
          await this.upsertParsed(org.id, bp);
        }
        renameSync(full, join(processedDir, `${Date.now()}_${fileName}`));
        processed += 1;
        this.logger.log(`BusinessPartner import ${fileName}: ${parsed.length} Datensätze`);
      } catch (err: any) {
        this.logger.error(`BusinessPartner import failed ${fileName}`, err?.message || err);
      }
    }
    return { processed };
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
    for (const c of bp.contacts) {
      if (!c.email && !c.name) continue;
      const existing = c.email
        ? await this.prisma.contact.findFirst({
            where: {
              ...link,
              email: c.email.toLowerCase(),
            },
          })
        : c.number !== undefined
          ? await this.prisma.contact.findFirst({
              where: { ...link, soloplanContactNumber: c.number },
            })
          : null;

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
      saved.push(row);
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
