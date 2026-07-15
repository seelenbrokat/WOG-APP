import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CustomsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private config: ConfigService,
  ) {}

  list(user: AuthUser) {
    const where =
      user.role === UserRole.CUSTOMER_USER
        ? { organizationId: user.organizationId, customerId: user.customerId || '__none__' }
        : { organizationId: user.organizationId };

    return this.prisma.customsOrder.findMany({
      where,
      include: {
        customer: { select: { name: true, customerNumber: true } },
        mandant: { select: { name: true, code: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(user: AuthUser, id: string) {
    const order = await this.prisma.customsOrder.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        customer: true,
        mandant: true,
      },
    });
    if (!order) throw new NotFoundException();
    if (user.role === UserRole.CUSTOMER_USER && order.customerId !== user.customerId) {
      throw new ForbiddenException();
    }
    return order;
  }

  async create(
    user: AuthUser,
    data: {
      kennzeichen: string;
      grenzuebergang: string;
      zeit: string;
      importeur: string;
      mandantId?: string;
      customerId?: string;
      notes?: string;
    },
  ) {
    let customerId = data.customerId;
    if (user.role === UserRole.CUSTOMER_USER) {
      if (!user.customerId) throw new ForbiddenException('Kein Kundenkonto verknüpft');
      customerId = user.customerId;
    }
    if (!customerId) throw new ForbiddenException('customerId erforderlich');

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId: user.organizationId },
    });
    if (!customer) throw new NotFoundException('Kunde nicht gefunden');

    if (data.mandantId) {
      const mandant = await this.prisma.mandant.findFirst({
        where: { id: data.mandantId, organizationId: user.organizationId },
      });
      if (!mandant) throw new NotFoundException('Mandant nicht gefunden');
    }

    const order = await this.prisma.customsOrder.create({
      data: {
        organizationId: user.organizationId,
        customerId,
        mandantId: data.mandantId,
        kennzeichen: data.kennzeichen.trim().toUpperCase(),
        grenzuebergang: data.grenzuebergang.trim(),
        zeit: new Date(data.zeit),
        importeur: data.importeur.trim(),
        notes: data.notes,
        status: 'SUBMITTED',
        createdById: user.id,
      },
      include: {
        customer: true,
        mandant: true,
      },
    });

    await this.audit.log(user.id, 'customs.create', 'CustomsOrder', order.id, {
      kennzeichen: order.kennzeichen,
      grenzuebergang: order.grenzuebergang,
    });

    const adminEmail = this.config.get('SEED_ADMIN_EMAIL') || 'admin@wog.logistikberater.at';
    const when = order.zeit.toLocaleString('de-AT');
    await this.notifications.sendRaw(
      adminEmail,
      `Verzollungsauftrag ${order.kennzeichen}`,
      [
        'Neuer Verzollungsauftrag:',
        `Kunde: ${order.customer.name}`,
        `Kennzeichen: ${order.kennzeichen}`,
        `Grenzübergang: ${order.grenzuebergang}`,
        `Zeit: ${when}`,
        `Importeur: ${order.importeur}`,
        order.mandant ? `Mandant: ${order.mandant.name}` : '',
        order.notes ? `Hinweis: ${order.notes}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );

    return order;
  }

  async updateStatus(user: AuthUser, id: string, status: string) {
    if (user.role === UserRole.CUSTOMER_USER) throw new ForbiddenException();
    await this.get(user, id);
    return this.prisma.customsOrder.update({
      where: { id },
      data: { status },
      include: { customer: true, mandant: true },
    });
  }
}
