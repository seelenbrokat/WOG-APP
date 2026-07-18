import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { NotificationEvent, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private notifications: NotificationsService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (existing) throw new BadRequestException('E-Mail bereits registriert');

    const org = await this.prisma.organization.findFirst({ where: { slug: 'wog' } });
    if (!org) throw new BadRequestException('Organisation nicht initialisiert');

    let customerId: string | undefined;
    if (dto.customerNumber) {
      const customer = await this.prisma.customer.findUnique({
        where: {
          organizationId_customerNumber: {
            organizationId: org.id,
            customerNumber: dto.customerNumber,
          },
        },
      });
      if (!customer) throw new BadRequestException('Kundennummer nicht gefunden');
      customerId = customer.id;
    }

    const verifyToken = randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        organizationId: org.id,
        customerId,
        email: dto.email.toLowerCase(),
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: UserRole.CUSTOMER_USER,
        verifyToken,
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

    return { message: 'Registrierung erfolgreich. Bitte E-Mail bestätigen.' };
  }

  async verifyEmail(token: string) {
    const user = await this.prisma.user.findFirst({ where: { verifyToken: token } });
    if (!user) throw new BadRequestException('Ungültiger Token');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date(), verifyToken: null },
    });
    return { message: 'E-Mail bestätigt. Sie können sich anmelden.' };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      include: { mandantAccess: true, customer: true },
    });
    if (!user || !user.active) throw new UnauthorizedException('Ungültige Anmeldedaten');
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Ungültige Anmeldedaten');
    if (!user.emailVerifiedAt && user.role === UserRole.CUSTOMER_USER) {
      throw new UnauthorizedException('E-Mail noch nicht bestätigt');
    }

    const token = await this.jwt.signAsync({ sub: user.id, role: user.role });
    return {
      accessToken: token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organizationId: user.organizationId,
        customerId: user.customerId,
        customerName: user.customer?.name,
        mandantIds: user.mandantAccess.map((a) => a.mandantId),
      },
    };
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
      },
    });
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
