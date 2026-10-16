import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { NotificationEvent, UserRole } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BusinessPartnerService } from '../integrations/business-partner.service';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private config: ConfigService,
    private businessPartners: BusinessPartnerService,
  ) {}

  /** Einmaliges Zufallspasswort – kein gemeinsames Default mehr. */
  private generateTempPassword() {
    return randomBytes(9).toString('base64url');
  }

  private appUrl() {
    return (this.config.get('APP_URL') || 'https://wog.logistikberater.at').replace(/\/$/, '');
  }

  /** Login-Link mit vorausgefüllter E-Mail. */
  private loginLink(email: string) {
    return `${this.appUrl()}/?email=${encodeURIComponent(email.toLowerCase())}`;
  }

  private accessEmailBody(opts: {
    firstName: string;
    email: string;
    temporaryPassword: string;
    kind: 'invite' | 'reset';
  }) {
    const login = this.loginLink(opts.email);
    const intro =
      opts.kind === 'invite'
        ? 'Ihr Zugang zum WOG Portal wurde angelegt.'
        : 'Ihr Passwort wurde zurückgesetzt. Hier sind Ihre neuen Zugangsdaten.';
    return [
      `Hallo ${opts.firstName},`,
      '',
      intro,
      '',
      `Direktlink zur Anmeldung:`,
      login,
      '',
      `E-Mail: ${opts.email}`,
      `Einmal-Passwort: ${opts.temporaryPassword}`,
      '',
      'Bitte melden Sie sich über den Link an und ändern Sie das Passwort nach dem ersten Login.',
      '',
      'WOG – World of Green Logistics',
      this.appUrl(),
    ].join('\n');
  }

  list(user: AuthUser) {
    return this.prisma.user.findMany({
      where: { organizationId: user.organizationId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        active: true,
        customerId: true,
        emailVerifiedAt: true,
        mustChangePassword: true,
        customer: { select: { id: true, name: true, customerNumber: true, soloplanBusinessPartnerId: true, matchcode: true } },
        mandantAccess: { include: { mandant: true } },
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async invite(
    actor: AuthUser,
    data: {
      email: string;
      firstName: string;
      lastName: string;
      role: UserRole;
      customerId?: string;
      mandantIds?: string[];
    },
  ) {
    if (data.role === UserRole.CUSTOMER_USER || data.role === UserRole.PARTNER) {
      if (!data.customerId && data.role === UserRole.CUSTOMER_USER) {
        throw new BadRequestException(
          'Externe Kunden müssen zuerst als Soloplan-BusinessPartner importiert und einem Kunden zugeordnet werden.',
        );
      }
      if (data.customerId) {
        const customer = await this.prisma.customer.findFirst({
          where: { id: data.customerId, organizationId: actor.organizationId },
        });
        if (!customer) throw new BadRequestException('Kunde nicht gefunden');
        if (!customer.soloplanBusinessPartnerId) {
          throw new BadRequestException(
            'Kunde hat keine Soloplan-BusinessPartnerId. Bitte zuerst Soloplan-BusinessPartner importieren.',
          );
        }
      }
    }

    return this.createUserWithDefaultPassword(actor, {
      ...data,
      emailVerified: true,
    });
  }

  /** Admin legt User aus Soloplan-Ansprechpartner (E-Mail) an */
  async inviteFromContact(
    actor: AuthUser,
    data: { contactId: string; role?: UserRole; mandantIds?: string[] },
  ) {
    const contact = await this.businessPartners.getContact(actor.organizationId, data.contactId);
    if (!contact.email) {
      throw new BadRequestException('Kontakt hat keine E-Mail-Adresse in Soloplan');
    }

    const role =
      data.role ||
      (contact.partnerId ? UserRole.PARTNER : UserRole.CUSTOMER_USER);

    if (role === UserRole.CUSTOMER_USER && !contact.customerId) {
      throw new BadRequestException('Kontakt ist keinem Kunden zugeordnet');
    }

    if (contact.customerId) {
      const customer = await this.prisma.customer.findUnique({ where: { id: contact.customerId } });
      if (!customer?.soloplanBusinessPartnerId) {
        throw new BadRequestException('Kunde ohne Soloplan-BusinessPartnerId');
      }
    }

    return this.createUserWithDefaultPassword(actor, {
      email: contact.email,
      firstName: contact.firstName || contact.name.split(/\s+/)[0] || 'Portal',
      lastName: contact.lastName || contact.name.split(/\s+/).slice(1).join(' ') || 'User',
      role,
      customerId: contact.customerId || undefined,
      mandantIds: data.mandantIds,
      emailVerified: true,
      partnerId: contact.partnerId || undefined,
    });
  }

  private async createUserWithDefaultPassword(
    actor: AuthUser,
    data: {
      email: string;
      firstName: string;
      lastName: string;
      role: UserRole;
      customerId?: string;
      mandantIds?: string[];
      emailVerified?: boolean;
      partnerId?: string;
    },
  ) {
    const existing = await this.prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
    if (existing) {
      throw new ConflictException({
        message: `Portal-User für ${existing.email} existiert bereits`,
        existingUserId: existing.id,
        email: existing.email,
        mustChangePassword: existing.mustChangePassword,
      });
    }

    const tempPassword = this.generateTempPassword();
    const user = await this.prisma.user.create({
      data: {
        organizationId: actor.organizationId,
        email: data.email.toLowerCase(),
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role,
        customerId: data.customerId,
        passwordHash: await bcrypt.hash(tempPassword, 10),
        mustChangePassword: true,
        emailVerifiedAt: data.emailVerified ? new Date() : null,
        verifyToken: data.emailVerified ? null : randomBytes(32).toString('hex'),
        mandantAccess: data.mandantIds?.length
          ? { create: data.mandantIds.map((mandantId) => ({ mandantId })) }
          : undefined,
        notificationPrefs: {
          create: Object.values(NotificationEvent).map((event) => ({ event, email: true })),
        },
      },
    });

    if (data.partnerId && data.role === UserRole.PARTNER) {
      await this.prisma.partner.update({
        where: { id: data.partnerId },
        data: { userId: user.id },
      });
    }

    await this.notifications.sendRaw(
      user.email,
      'WOG Portal – Ihr Zugang / Einladung',
      this.accessEmailBody({
        firstName: user.firstName,
        email: user.email,
        temporaryPassword: tempPassword,
        kind: 'invite',
      }),
    );
    await this.audit.log(actor.id, 'user.invite', 'User', user.id, {
      email: user.email,
      role: user.role,
      customerId: data.customerId,
      partnerId: data.partnerId,
    });

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      mustChangePassword: true,
      temporaryPassword: tempPassword,
      loginUrl: this.loginLink(user.email),
    };
  }

  async adminResetPassword(actor: AuthUser, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId: actor.organizationId },
    });
    if (!user) throw new NotFoundException();

    const tempPassword = this.generateTempPassword();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(tempPassword, 10),
        mustChangePassword: true,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    await this.notifications.sendRaw(
      user.email,
      'WOG Portal – Ihr Zugang / Einladung',
      this.accessEmailBody({
        firstName: user.firstName,
        email: user.email,
        temporaryPassword: tempPassword,
        kind: 'reset',
      }),
    );
    await this.audit.log(actor.id, 'user.passwordReset', 'User', user.id, { email: user.email });

    return {
      id: user.id,
      email: user.email,
      mustChangePassword: true,
      temporaryPassword: tempPassword,
      loginUrl: this.loginLink(user.email),
    };
  }

  /**
   * Alle Kontakte eines Kunden/Partners mit E-Mail einladen.
   * Neue User anlegen; bestehende mit mustChangePassword erneut per Mail einladen.
   * User, die ihr Passwort schon geändert haben, werden übersprungen (außer forceResend).
   */
  async inviteContactsForCustomerOrPartner(
    actor: AuthUser,
    opts: {
      customerId?: string;
      partnerId?: string;
      forceResend?: boolean;
    },
  ) {
    if (!opts.customerId && !opts.partnerId) {
      throw new BadRequestException('customerId oder partnerId erforderlich');
    }
    if (opts.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: opts.customerId, organizationId: actor.organizationId },
      });
      if (!customer) throw new NotFoundException('Kunde nicht gefunden');
    }
    if (opts.partnerId) {
      const partner = await this.prisma.partner.findFirst({
        where: { id: opts.partnerId, organizationId: actor.organizationId },
      });
      if (!partner) throw new NotFoundException('Partner nicht gefunden');
    }

    const contacts = await this.prisma.contact.findMany({
      where: {
        ...(opts.customerId ? { customerId: opts.customerId } : {}),
        ...(opts.partnerId ? { partnerId: opts.partnerId } : {}),
        email: { not: null },
      },
      orderBy: { email: 'asc' },
    });

    const results: Array<{
      contactId: string;
      email: string;
      action: 'invited' | 'resent' | 'skipped';
      reason?: string;
      temporaryPassword?: string;
      loginUrl?: string;
    }> = [];

    for (const contact of contacts) {
      const email = (contact.email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) {
        results.push({
          contactId: contact.id,
          email: contact.email || '',
          action: 'skipped',
          reason: 'keine gültige E-Mail',
        });
        continue;
      }

      // Interne Test-Adressen nicht anfassen, außer forceResend
      if (
        !opts.forceResend &&
        (email.endsWith('@worldofgreen.at') || email.endsWith('@logistikberater.at'))
      ) {
        results.push({
          contactId: contact.id,
          email,
          action: 'skipped',
          reason: 'interne Adresse',
        });
        continue;
      }

      const existing = await this.prisma.user.findUnique({ where: { email } });
      try {
        if (!existing) {
          const created = await this.inviteFromContact(actor, { contactId: contact.id });
          results.push({
            contactId: contact.id,
            email,
            action: 'invited',
            temporaryPassword: created.temporaryPassword,
            loginUrl: created.loginUrl,
          });
        } else if (existing.mustChangePassword || opts.forceResend) {
          const reset = await this.adminResetPassword(actor, existing.id);
          results.push({
            contactId: contact.id,
            email,
            action: 'resent',
            temporaryPassword: reset.temporaryPassword,
            loginUrl: reset.loginUrl,
          });
        } else {
          results.push({
            contactId: contact.id,
            email,
            action: 'skipped',
            reason: 'Passwort bereits geändert',
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ contactId: contact.id, email, action: 'skipped', reason: msg });
      }
    }

    return {
      ok: true,
      invited: results.filter((r) => r.action === 'invited').length,
      resent: results.filter((r) => r.action === 'resent').length,
      skipped: results.filter((r) => r.action === 'skipped').length,
      results,
    };
  }

  async setMandantAccess(actor: AuthUser, userId: string, mandantIds: string[]) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId: actor.organizationId },
    });
    if (!user) throw new NotFoundException();
    await this.prisma.userMandantAccess.deleteMany({ where: { userId } });
    await this.prisma.userMandantAccess.createMany({
      data: mandantIds.map((mandantId) => ({ userId, mandantId })),
    });
    await this.audit.log(actor.id, 'user.mandantAccess', 'User', userId, { mandantIds });
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: { mandantAccess: { include: { mandant: true } } },
    });
  }

  async updatePrefs(userId: string, prefs: { event: NotificationEvent; email: boolean }[]) {
    for (const pref of prefs) {
      await this.prisma.notificationPreference.upsert({
        where: { userId_event: { userId, event: pref.event } },
        create: { userId, event: pref.event, email: pref.email },
        update: { email: pref.email },
      });
    }
    return this.prisma.notificationPreference.findMany({ where: { userId } });
  }
}
