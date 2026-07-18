import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { NotificationEvent, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private config: ConfigService,
  ) {}

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
    const existing = await this.prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
    if (existing) throw new BadRequestException('E-Mail bereits vorhanden');

    const tempPassword = randomBytes(9).toString('base64url');
    const verifyToken = randomBytes(32).toString('hex');
    const user = await this.prisma.user.create({
      data: {
        organizationId: actor.organizationId,
        email: data.email.toLowerCase(),
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role,
        customerId: data.customerId,
        passwordHash: await bcrypt.hash(tempPassword, 10),
        verifyToken,
        emailVerifiedAt: data.role === UserRole.CUSTOMER_USER ? null : new Date(),
        mandantAccess: data.mandantIds?.length
          ? { create: data.mandantIds.map((mandantId) => ({ mandantId })) }
          : undefined,
        notificationPrefs: {
          create: Object.values(NotificationEvent).map((event) => ({ event, email: true })),
        },
      },
      include: { mandantAccess: true },
    });

    const appUrl = this.config.get('APP_URL') || 'http://localhost:3000';
    await this.notifications.sendRaw(
      user.email,
      'WOG Portal – Einladung',
      `Hallo ${user.firstName},\n\nSie wurden zum WOG Portal eingeladen.\nTemporäres Passwort: ${tempPassword}\nAnmelden: ${appUrl}/login\n`,
    );
    await this.audit.log(actor.id, 'user.invite', 'User', user.id, { email: user.email, role: user.role });
    return { id: user.id, email: user.email, role: user.role };
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
