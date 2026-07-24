import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  log(actorId: string | null, action: string, entityType: string, entityId?: string, meta?: unknown) {
    return this.prisma.auditLog.create({
      data: {
        actorId: actorId || undefined,
        action,
        entityType,
        entityId,
        meta: meta as object | undefined,
      },
    });
  }

  list(organizationUserIds: string[], take = 100) {
    return this.prisma.auditLog.findMany({
      where: { actorId: { in: organizationUserIds } },
      orderBy: { createdAt: 'desc' },
      take,
      include: { actor: { select: { email: true, firstName: true, lastName: true } } },
    });
  }
}
