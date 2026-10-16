import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { PartnerOrdersInboundService } from './partner-orders-inbound.service';

function sanitizeUsername(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '')
    .slice(0, 32);
}

function suggestUsername(name: string, matchcode?: string | null, number?: string | null): string {
  const fromMatch = sanitizeUsername(matchcode || '');
  if (fromMatch.length >= 3) return fromMatch;
  const fromNum = sanitizeUsername(number || '');
  if (fromNum.length >= 3) return fromNum;
  const fromName = sanitizeUsername(name).slice(0, 20);
  return fromName || `partner${randomBytes(3).toString('hex')}`;
}

@Injectable()
export class PartnerOrdersSftpService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private config: ConfigService,
    private inbound: PartnerOrdersInboundService,
  ) {}

  async getCustomerConfig(user: AuthUser, customerId: string) {
    this.assertAdmin(user);
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId: user.organizationId },
      select: {
        id: true,
        name: true,
        customerNumber: true,
        matchcode: true,
        sftpInboundEnabled: true,
        sftpUsername: true,
        sftpInboundFormat: true,
      },
    });
    if (!customer) throw new NotFoundException('Kunde nicht gefunden');
    return this.toConfigView('CUSTOMER', customer);
  }

  async setCustomerConfig(
    user: AuthUser,
    customerId: string,
    data: {
      sftpInboundEnabled: boolean;
      sftpUsername?: string;
      sftpInboundFormat?: string;
      regeneratePassword?: boolean;
    },
  ) {
    this.assertAdmin(user);
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId: user.organizationId },
    });
    if (!customer) throw new NotFoundException('Kunde nicht gefunden');

    let username = sanitizeUsername(data.sftpUsername || customer.sftpUsername || '');
    if (data.sftpInboundEnabled && !username) {
      username = suggestUsername(
        customer.name,
        customer.matchcode,
        customer.customerNumber,
      );
    }
    if (data.sftpInboundEnabled && !username) {
      throw new BadRequestException('sftpUsername erforderlich');
    }

    await this.assertUsernameFree(username, { customerId });

    const format = (data.sftpInboundFormat || customer.sftpInboundFormat || 'BORD512').toUpperCase();
    if (!['BORD512', 'AUTO'].includes(format)) {
      throw new BadRequestException('sftpInboundFormat muss BORD512 oder AUTO sein');
    }

    const updated = await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        sftpInboundEnabled: data.sftpInboundEnabled,
        sftpUsername: data.sftpInboundEnabled ? username : customer.sftpUsername || username,
        sftpInboundFormat: format,
      },
      select: {
        id: true,
        name: true,
        customerNumber: true,
        matchcode: true,
        sftpInboundEnabled: true,
        sftpUsername: true,
        sftpInboundFormat: true,
      },
    });

    let password: string | undefined;
    if (updated.sftpInboundEnabled && updated.sftpUsername) {
      this.inbound.ensureDropDirs(updated.sftpUsername);
      if (data.regeneratePassword || data.sftpInboundEnabled) {
        password = this.persistCredentialsHint(updated.sftpUsername, {
          kind: 'CUSTOMER',
          name: updated.name,
          id: updated.id,
          forceNew: Boolean(data.regeneratePassword),
        });
      }
    }

    await this.audit.log(user.id, 'customer.sftpInbound', 'Customer', customerId, {
      enabled: updated.sftpInboundEnabled,
      username: updated.sftpUsername,
      format: updated.sftpInboundFormat,
    });

    return {
      ...this.toConfigView('CUSTOMER', updated),
      ...(password
        ? {
            temporaryPassword: password,
            provisionHint:
              'OS-SFTP-User auf dem Server anlegen: portal/scripts/provision-partner-sftp.sh',
          }
        : {}),
    };
  }

  async getPartnerConfig(user: AuthUser, partnerId: string) {
    this.assertAdmin(user);
    const partner = await this.prisma.partner.findFirst({
      where: { id: partnerId, organizationId: user.organizationId },
      select: {
        id: true,
        name: true,
        code: true,
        matchcode: true,
        sftpInboundEnabled: true,
        sftpUsername: true,
        sftpInboundFormat: true,
      },
    });
    if (!partner) throw new NotFoundException('Partner nicht gefunden');
    return this.toConfigView('PARTNER', {
      ...partner,
      customerNumber: partner.code,
    });
  }

  async setPartnerConfig(
    user: AuthUser,
    partnerId: string,
    data: {
      sftpInboundEnabled: boolean;
      sftpUsername?: string;
      sftpInboundFormat?: string;
      regeneratePassword?: boolean;
    },
  ) {
    this.assertAdmin(user);
    const partner = await this.prisma.partner.findFirst({
      where: { id: partnerId, organizationId: user.organizationId },
    });
    if (!partner) throw new NotFoundException('Partner nicht gefunden');

    let username = sanitizeUsername(data.sftpUsername || partner.sftpUsername || '');
    if (data.sftpInboundEnabled && !username) {
      username = suggestUsername(partner.name, partner.matchcode, partner.code);
    }
    if (data.sftpInboundEnabled && !username) {
      throw new BadRequestException('sftpUsername erforderlich');
    }

    await this.assertUsernameFree(username, { partnerId });

    const format = (data.sftpInboundFormat || partner.sftpInboundFormat || 'BORD512').toUpperCase();
    if (!['BORD512', 'AUTO'].includes(format)) {
      throw new BadRequestException('sftpInboundFormat muss BORD512 oder AUTO sein');
    }

    const updated = await this.prisma.partner.update({
      where: { id: partnerId },
      data: {
        sftpInboundEnabled: data.sftpInboundEnabled,
        sftpUsername: data.sftpInboundEnabled ? username : partner.sftpUsername || username,
        sftpInboundFormat: format,
      },
      select: {
        id: true,
        name: true,
        code: true,
        matchcode: true,
        sftpInboundEnabled: true,
        sftpUsername: true,
        sftpInboundFormat: true,
      },
    });

    let password: string | undefined;
    if (updated.sftpInboundEnabled && updated.sftpUsername) {
      this.inbound.ensureDropDirs(updated.sftpUsername);
      password = this.persistCredentialsHint(updated.sftpUsername, {
        kind: 'PARTNER',
        name: updated.name,
        id: updated.id,
        forceNew: Boolean(data.regeneratePassword),
      });
    }

    await this.audit.log(user.id, 'partner.sftpInbound', 'Partner', partnerId, {
      enabled: updated.sftpInboundEnabled,
      username: updated.sftpUsername,
      format: updated.sftpInboundFormat,
    });

    return {
      ...this.toConfigView('PARTNER', {
        ...updated,
        customerNumber: updated.code,
      }),
      ...(password
        ? {
            temporaryPassword: password,
            provisionHint:
              'OS-SFTP-User auf dem Server anlegen: portal/scripts/provision-partner-sftp.sh',
          }
        : {}),
    };
  }

  private toConfigView(
    kind: 'CUSTOMER' | 'PARTNER',
    row: {
      id: string;
      name: string;
      customerNumber?: string | null;
      matchcode?: string | null;
      sftpInboundEnabled: boolean;
      sftpUsername?: string | null;
      sftpInboundFormat?: string | null;
    },
  ) {
    const username = row.sftpUsername || '';
    const host =
      this.config.get('PUBLIC_SFTP_HOST') ||
      this.config.get('PUBLIC_APP_URL')?.replace(/^https?:\/\//, '') ||
      'wog.logistikberater.at';
    return {
      kind,
      id: row.id,
      name: row.name,
      sftpInboundEnabled: row.sftpInboundEnabled,
      sftpUsername: username || null,
      sftpInboundFormat: row.sftpInboundFormat || 'BORD512',
      dropPath: username ? `inbound/partner-orders/${username}/` : null,
      host,
      port: 22,
      suggestedUsername: suggestUsername(
        row.name,
        row.matchcode,
        row.customerNumber || undefined,
      ),
    };
  }

  private async assertUsernameFree(
    username: string,
    except: { customerId?: string; partnerId?: string },
  ) {
    if (!username) return;
    const [c, p] = await Promise.all([
      this.prisma.customer.findFirst({
        where: {
          sftpUsername: username,
          ...(except.customerId ? { NOT: { id: except.customerId } } : {}),
        },
        select: { id: true, name: true },
      }),
      this.prisma.partner.findFirst({
        where: {
          sftpUsername: username,
          ...(except.partnerId ? { NOT: { id: except.partnerId } } : {}),
        },
        select: { id: true, name: true },
      }),
    ]);
    if (c) throw new BadRequestException(`SFTP-User „${username}“ bereits bei Kunde ${c.name}`);
    if (p) throw new BadRequestException(`SFTP-User „${username}“ bereits bei Partner ${p.name}`);
  }

  /**
   * Speichert Zugangsdaten-Hinweis unter data/sftp/credentials/ (nicht in DB).
   * Gibt Passwort nur zurück, wenn neu erzeugt.
   */
  private persistCredentialsHint(
    username: string,
    meta: { kind: string; name: string; id: string; forceNew: boolean },
  ): string | undefined {
    const sftpRoot =
      this.config.get('SFTP_ROOT_DIR') ||
      join(
        this.config.get('SFTP_INBOUND_DIR') || join(process.cwd(), '../../data/sftp/inbound'),
        '..',
      );
    const credDir = join(sftpRoot, 'credentials');
    if (!existsSync(credDir)) mkdirSync(credDir, { recursive: true });
    const file = join(credDir, `${username}.txt`);
    if (existsSync(file) && !meta.forceNew) return undefined;

    const password = randomBytes(12).toString('base64url');
    const host =
      this.config.get('PUBLIC_SFTP_HOST') ||
      this.config.get('PUBLIC_APP_URL')?.replace(/^https?:\/\//, '') ||
      'wog.logistikberater.at';
    const body = [
      `kind=${meta.kind}`,
      `name=${meta.name}`,
      `id=${meta.id}`,
      `user=${username}`,
      `password=${password}`,
      `host=${host}`,
      `port=22`,
      `path=inbound/partner-orders/${username}/`,
      `format=BORD512`,
      `protocol=SFTP`,
      `createdAt=${new Date().toISOString()}`,
      '',
      '# Nach Freischaltung auf dem Server ausführen:',
      `#   sudo bash portal/scripts/provision-partner-sftp.sh ${username}`,
      '',
    ].join('\n');
    writeFileSync(file, body, { mode: 0o600 });
    return password;
  }

  private assertAdmin(user: AuthUser) {
    if (user.role !== UserRole.ORG_ADMIN) {
      throw new ForbiddenException('Nur ORG_ADMIN darf SFTP-Inbound freischalten');
    }
  }
}
