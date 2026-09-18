import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';
import { UserRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class MandantenService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  list(user: AuthUser, opts?: { includeInactive?: boolean }) {
    // Inaktive Mandanten (z. B. WOG GmbH) standardmäßig ausblenden
    const activeFilter = opts?.includeInactive ? {} : { active: true };

    if (user.role === UserRole.CUSTOMER_USER) {
      return this.prisma.mandant.findMany({
        where: { organizationId: user.organizationId, ...activeFilter },
        orderBy: { name: 'asc' },
      });
    }

    const where =
      user.role === UserRole.ORG_ADMIN
        ? { organizationId: user.organizationId, ...activeFilter }
        : {
            organizationId: user.organizationId,
            id: { in: user.mandantIds },
            ...activeFilter,
          };

    return this.prisma.mandant.findMany({ where, orderBy: { name: 'asc' } });
  }

  async create(
    user: AuthUser,
    data: { code: string; name: string; legalName?: string },
  ) {
    const mandant = await this.prisma.mandant.create({
      data: {
        organizationId: user.organizationId,
        code: data.code.toUpperCase(),
        name: data.name,
        legalName: data.legalName,
      },
    });
    await this.audit.log(user.id, 'mandant.create', 'Mandant', mandant.id, data);
    return mandant;
  }

  async update(
    user: AuthUser,
    id: string,
    data: { name?: string; legalName?: string; active?: boolean },
  ) {
    const existing = await this.prisma.mandant.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!existing) throw new NotFoundException();
    const mandant = await this.prisma.mandant.update({ where: { id }, data });
    await this.audit.log(user.id, 'mandant.update', 'Mandant', id, data);
    return mandant;
  }

  async ensureAccess(user: AuthUser, mandantId: string) {
    const mandant = await this.prisma.mandant.findFirst({
      where: { id: mandantId, organizationId: user.organizationId },
    });
    if (!mandant) throw new NotFoundException('Mandant nicht gefunden');
    if (user.role === UserRole.ORG_ADMIN || user.role === UserRole.CUSTOMER_USER) return mandant;
    if (!user.mandantIds.includes(mandantId)) {
      throw new ForbiddenException('Kein Zugriff auf diesen Mandanten');
    }
    return mandant;
  }
}
