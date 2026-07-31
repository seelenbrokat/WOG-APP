import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { createRequire } from 'module';
import { NotificationEvent, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from './auth.types';
import { RegisterDto, LoginDto, CreateLoginQrDto } from './dto/auth.dto';

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

const nodeRequire = createRequire(__filename);
const bwipjs = nodeRequire('bwip-js') as {
  toBuffer: (opts: {
    bcid: string;
    text: string;
    scale?: number;
    height?: number;
    includetext?: boolean;
  }) => Promise<Buffer>;
};

const STAFF_ROLES: UserRole[] = [UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER];
const DEFAULT_LAGER_EMAIL = 'lager@wog.logistikberater.at';
const DEFAULT_QR_REDIRECT = '/scanning/we-tc57';

function sanitizeRedirectPath(path?: string) {
  const raw = (path || DEFAULT_QR_REDIRECT).trim();
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('://')) {
    throw new BadRequestException('Ungültiger Redirect-Pfad');
  }
  return raw;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private notifications: NotificationsService,
    private audit: AuditService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (existing) throw new BadRequestException('E-Mail bereits registriert');

    const org = await this.prisma.organization.findFirst({ where: { slug: 'wog' } });
    if (!org) throw new BadRequestException('Organisation nicht initialisiert');

    if (!dto.customerNumber) {
      throw new BadRequestException(
        'Zugang nur für Soloplan-BusinessPartner. Bitte Administrator kontaktieren oder Kundennummer/Matchcode angeben.',
      );
    }

    const customer = await this.prisma.customer.findFirst({
      where: {
        organizationId: org.id,
        OR: [
          { customerNumber: dto.customerNumber },
          { matchcode: dto.customerNumber },
          { soloplanBusinessPartnerId: dto.customerNumber },
        ],
      },
    });
    if (!customer) throw new BadRequestException('Kundennummer nicht gefunden');
    if (!customer.soloplanBusinessPartnerId) {
      throw new BadRequestException(
        'Kunde ist nicht aus Soloplan importiert (BusinessPartnerId fehlt).',
      );
    }
    const contact = await this.prisma.contact.findFirst({
      where: { customerId: customer.id, email: dto.email.toLowerCase() },
    });
    if (!contact) {
      throw new BadRequestException(
        'E-Mail ist bei diesem BusinessPartner in Soloplan nicht als Ansprechpartner hinterlegt.',
      );
    }

    const verifyToken = randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        organizationId: org.id,
        customerId: customer.id,
        email: dto.email.toLowerCase(),
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: UserRole.CUSTOMER_USER,
        verifyToken,
        mustChangePassword: false,
        notificationPrefs: {
          create: Object.values(NotificationEvent).map((event) => ({
            event,
            email: true,
          })),
        },
      },
    });

    const appUrl = this.config.get('APP_URL') || 'http://localhost:3000';
    await this.notifications.sendRaw(
      user.email,
      'WOG Portal – E-Mail bestätigen',
      `Hallo ${user.firstName},\n\nbitte bestätigen Sie Ihre E-Mail:\n${appUrl}/verify-email?token=${verifyToken}\n`,
    );
    await this.audit.log(user.id, 'auth.register', 'User', user.id, {
      email: user.email,
      customerId: customer.id,
    });

    return { message: 'Registrierung erfolgreich. Bitte E-Mail bestätigen.' };
  }

  async verifyEmail(token: string) {
    const user = await this.prisma.user.findFirst({ where: { verifyToken: token } });
    if (!user) throw new BadRequestException('Ungültiger Token');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date(), verifyToken: null },
    });
    await this.audit.log(user.id, 'auth.verifyEmail', 'User', user.id, { email: user.email });
    return { message: 'E-Mail bestätigt. Sie können sich anmelden.' };
  }

  private async issuePortalSession(
    user: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      role: UserRole;
      organizationId: string;
      customerId: string | null;
      mustChangePassword: boolean;
      customer?: { name: string } | null;
      partner?: { id: string; name: string } | null;
      mandantAccess: Array<{ mandantId: string }>;
    },
    auditAction = 'auth.login',
    auditMeta: Record<string, unknown> = {},
  ) {
    const token = await this.jwt.signAsync({ sub: user.id, role: user.role });
    await this.audit.log(user.id, auditAction, 'User', user.id, {
      email: user.email,
      ...auditMeta,
    });
    return {
      accessToken: token,
      mustChangePassword: user.mustChangePassword,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organizationId: user.organizationId,
        customerId: user.customerId,
        customerName: user.customer?.name,
        partnerId: user.partner?.id ?? null,
        partnerName: user.partner?.name,
        mandantIds: user.mandantAccess.map((a) => a.mandantId),
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { mandantAccess: true, customer: true, partner: true },
    });
    if (!user || !user.active) {
      await this.audit.log(null, 'auth.login.failed', 'User', undefined, {
        email,
        reason: 'unknown_or_inactive',
      });
      throw new UnauthorizedException('Ungültige Anmeldedaten');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      await this.audit.log(user.id, 'auth.login.failed', 'User', user.id, {
        email: user.email,
        reason: 'bad_password',
      });
      throw new UnauthorizedException('Ungültige Anmeldedaten');
    }
    if (!user.emailVerifiedAt && user.role === UserRole.CUSTOMER_USER) {
      await this.audit.log(user.id, 'auth.login.failed', 'User', user.id, {
        email: user.email,
        reason: 'email_unverified',
      });
      throw new UnauthorizedException('E-Mail noch nicht bestätigt');
    }

    return this.issuePortalSession(user);
  }

  /** Dispo/Admin: QR für Lager-Tablet erzeugen (Standard: lager@… → WE TC57). */
  async createLoginQr(actor: AuthUser, dto: CreateLoginQrDto) {
    if (!STAFF_ROLES.includes(actor.role)) {
      throw new ForbiddenException('Keine Berechtigung');
    }

    const email = (dto.email || DEFAULT_LAGER_EMAIL).toLowerCase();
    const target = dto.userId
      ? await this.prisma.user.findFirst({
          where: {
            id: dto.userId,
            organizationId: actor.organizationId,
            active: true,
          },
        })
      : await this.prisma.user.findFirst({
          where: {
            email,
            organizationId: actor.organizationId,
            active: true,
          },
        });

    if (!target) {
      throw new BadRequestException(
        dto.userId
          ? 'Benutzer nicht gefunden'
          : `Lager-Benutzer nicht gefunden (${email})`,
      );
    }
    if (!STAFF_ROLES.includes(target.role)) {
      throw new BadRequestException(
        'QR-Login nur für interne Lager-/Dispo-Benutzer (ORG_ADMIN / MANDANT_DISPATCHER)',
      );
    }

    const ttlDays = dto.ttlDays ?? 90;
    const singleUse = dto.singleUse === true;
    const redirectPath = sanitizeRedirectPath(dto.redirectPath);
    const label =
      dto.label?.trim() ||
      `Lager · ${target.firstName} ${target.lastName}`.trim() ||
      target.email;

    // Alte Tokens desselben Users widerrufen – ein aktueller Station-QR
    await this.prisma.userLoginQrToken.updateMany({
      where: {
        userId: target.id,
        organizationId: actor.organizationId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    const raw = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 3600 * 1000);
    await this.prisma.userLoginQrToken.create({
      data: {
        organizationId: actor.organizationId,
        userId: target.id,
        tokenHash: hashToken(raw),
        label,
        redirectPath,
        singleUse,
        expiresAt,
        createdByUserId: actor.id,
      },
    });

    const appUrl = (this.config.get<string>('APP_URL') || 'http://localhost:3000').replace(
      /\/$/,
      '',
    );
    const payload = `${appUrl}/?qr=${raw}`;

    const png = await bwipjs.toBuffer({
      bcid: 'qrcode',
      text: payload,
      scale: 6,
      includetext: false,
    });

    await this.audit.log(actor.id, 'auth.loginQr.create', 'User', target.id, {
      email: target.email,
      ttlDays,
      singleUse,
      redirectPath,
      label,
    });

    return {
      expiresAt: expiresAt.toISOString(),
      ttlDays,
      singleUse,
      redirectPath,
      label,
      payload,
      qrPngBase64: png.toString('base64'),
      qrDataUrl: `data:image/png;base64,${png.toString('base64')}`,
      user: {
        id: target.id,
        email: target.email,
        firstName: target.firstName,
        lastName: target.lastName,
        role: target.role,
      },
    };
  }

  async loginWithQr(token: string) {
    const qr = await this.prisma.userLoginQrToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        user: {
          include: { mandantAccess: true, customer: true, partner: true },
        },
      },
    });

    if (!qr || qr.revokedAt || qr.expiresAt < new Date()) {
      await this.audit.log(null, 'auth.loginQr.failed', 'User', undefined, {
        reason: 'invalid_or_expired',
      });
      throw new UnauthorizedException('QR-Code ungültig oder abgelaufen');
    }
    if (qr.singleUse && qr.usedAt) {
      await this.audit.log(qr.userId, 'auth.loginQr.failed', 'User', qr.userId, {
        reason: 'already_used',
      });
      throw new UnauthorizedException('QR-Code bereits verwendet');
    }
    if (!qr.user.active || !STAFF_ROLES.includes(qr.user.role)) {
      throw new UnauthorizedException('Benutzer für QR-Login nicht freigeschaltet');
    }

    if (qr.singleUse || !qr.usedAt) {
      await this.prisma.userLoginQrToken.update({
        where: { id: qr.id },
        data: { usedAt: new Date() },
      });
    }

    const session = await this.issuePortalSession(qr.user, 'auth.loginQr', {
      qrTokenId: qr.id,
      singleUse: qr.singleUse,
    });

    return {
      ...session,
      redirectPath: qr.redirectPath || DEFAULT_QR_REDIRECT,
    };
  }

  async listStaffForQr(actor: AuthUser) {
    if (!STAFF_ROLES.includes(actor.role)) {
      throw new ForbiddenException('Keine Berechtigung');
    }
    return this.prisma.user.findMany({
      where: {
        organizationId: actor.organizationId,
        active: true,
        role: { in: STAFF_ROLES },
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException();
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Aktuelles Passwort ungültig');
    if (currentPassword === newPassword) {
      throw new BadRequestException('Neues Passwort muss sich vom aktuellen unterscheiden');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await bcrypt.hash(newPassword, 10),
        mustChangePassword: false,
      },
    });
    await this.audit.log(user.id, 'auth.changePassword', 'User', user.id, { email: user.email });
    return { message: 'Passwort geändert.' };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return { message: 'Falls die E-Mail existiert, wurde ein Link gesendet.' };
    const token = randomBytes(32).toString('hex');
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetToken: token,
        resetTokenExpiry: new Date(Date.now() + 1000 * 60 * 60),
      },
    });
    const appUrl = this.config.get('APP_URL') || 'http://localhost:3000';
    await this.notifications.sendRaw(
      user.email,
      'WOG Portal – Passwort zurücksetzen',
      `Hallo ${user.firstName},\n\nPasswort zurücksetzen:\n${appUrl}/reset-password?token=${token}\n`,
    );
    await this.audit.log(user.id, 'auth.forgotPassword', 'User', user.id, { email: user.email });
    return { message: 'Falls die E-Mail existiert, wurde ein Link gesendet.' };
  }

  async resetPassword(token: string, password: string) {
    const user = await this.prisma.user.findFirst({
      where: { resetToken: token, resetTokenExpiry: { gt: new Date() } },
    });
    if (!user) throw new BadRequestException('Token ungültig oder abgelaufen');
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(password, 10),
        resetToken: null,
        resetTokenExpiry: null,
        mustChangePassword: false,
      },
    });
    await this.audit.log(user.id, 'auth.resetPassword', 'User', user.id, { email: user.email });
    return { message: 'Passwort aktualisiert.' };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        mandantAccess: { include: { mandant: true } },
        customer: true,
        notificationPrefs: true,
      },
    });
    if (!user) throw new NotFoundException();
    const { passwordHash, verifyToken, resetToken, ...safe } = user;
    return safe;
  }
}
