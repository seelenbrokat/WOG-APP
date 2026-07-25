import { Injectable, Logger } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { ShipmentsService } from './shipments.service';
import { zurichDayKey } from '../common/zurich-date';
import { computeNextRun } from '../common/schedule';

@Injectable()
export class RecurringTemplatesService {
  private readonly logger = new Logger(RecurringTemplatesService.name);

  constructor(
    private prisma: PrismaService,
    private shipments: ShipmentsService,
  ) {}

  async runDueTemplates(limit = 25): Promise<{ created: number; failed: number }> {
    const now = new Date();
    const due = await this.prisma.shipmentTemplate.findMany({
      where: {
        scheduleEnabled: true,
        scheduleNextRun: { lte: now },
        mandantId: { not: null },
      },
      include: {
        customer: {
          select: {
            id: true,
            organizationId: true,
            users: {
              where: { active: true, role: UserRole.CUSTOMER_USER },
              take: 1,
              select: {
                id: true,
                email: true,
                role: true,
                organizationId: true,
                customerId: true,
              },
            },
          },
        },
      },
      orderBy: { scheduleNextRun: 'asc' },
      take: limit,
    });

    let created = 0;
    let failed = 0;

    for (const tpl of due) {
      const freq = tpl.scheduleFreq === 'WEEKLY' ? 'WEEKLY' : 'DAILY';
      try {
        if (!tpl.mandantId) {
          throw new Error('mandantId fehlt');
        }
        type ActorRow = {
          id: string;
          email: string;
          role: UserRole;
          organizationId: string;
          customerId: string | null;
        };
        let actorUser: ActorRow | undefined = tpl.customer.users[0];
        if (!actorUser) {
          actorUser =
            (await this.prisma.user.findFirst({
              where: {
                organizationId: tpl.customer.organizationId,
                role: UserRole.ORG_ADMIN,
                active: true,
              },
              select: {
                id: true,
                email: true,
                role: true,
                organizationId: true,
                customerId: true,
              },
            })) || undefined;
        }
        if (!actorUser) {
          throw new Error('Kein Benutzer für automatische Auftragserstellung');
        }
        const actor: AuthUser = {
          id: actorUser.id,
          email: actorUser.email,
          role: actorUser.role,
          organizationId: actorUser.organizationId,
          customerId: actorUser.customerId || tpl.customerId,
          mandantIds: [],
        };

        const pickupDay = zurichDayKey(now);
        await this.shipments.create(actor, {
          mandantId: tpl.mandantId,
          customerId: tpl.customerId,
          reference: tpl.reference || undefined,
          transportMode: tpl.transportMode || undefined,
          goodsDescription: tpl.goodsDescription || undefined,
          packageCount: tpl.packageCount || 1,
          weightKg: tpl.weightKg ?? undefined,
          volumeM3: tpl.volumeM3 ?? undefined,
          pickupCompany: tpl.pickupCompany || undefined,
          pickupStreet: tpl.pickupStreet || undefined,
          pickupZip: tpl.pickupZip || undefined,
          pickupCity: tpl.pickupCity || undefined,
          pickupCountry: tpl.pickupCountry || undefined,
          pickupDate: pickupDay,
          deliveryCompany: tpl.deliveryCompany || undefined,
          deliveryStreet: tpl.deliveryStreet || undefined,
          deliveryZip: tpl.deliveryZip || undefined,
          deliveryCity: tpl.deliveryCity || undefined,
          deliveryCountry: tpl.deliveryCountry || undefined,
          notes: tpl.notes
            ? `${tpl.notes}\n[Wiederkehrend: ${tpl.name}]`
            : `[Wiederkehrend: ${tpl.name}]`,
          submit: true,
          savePickupAddress: false,
          saveDeliveryAddress: false,
        });

        const next = computeNextRun(now, freq, tpl.scheduleWeekdays);
        await this.prisma.shipmentTemplate.update({
          where: { id: tpl.id },
          data: {
            scheduleLastRun: now,
            scheduleNextRun: next,
          },
        });
        created += 1;
      } catch (err) {
        failed += 1;
        this.logger.warn(
          `Wiederkehrende Vorlage ${tpl.id} (${tpl.name}) fehlgeschlagen: ${(err as Error).message}`,
        );
        const next = computeNextRun(now, freq, tpl.scheduleWeekdays);
        await this.prisma.shipmentTemplate.update({
          where: { id: tpl.id },
          data: { scheduleNextRun: next },
        });
      }
    }

    return { created, failed };
  }
}
