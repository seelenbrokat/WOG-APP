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

  list(
    organizationUserIds: string[],
    opts?: { take?: number; entityType?: string; action?: string; q?: string },
  ) {
    const take = Math.min(Math.max(opts?.take ?? 100, 1), 500);
    const where: Record<string, unknown> = {
      actorId: { in: organizationUserIds },
    };
    if (opts?.entityType?.trim()) where.entityType = opts.entityType.trim();
    if (opts?.action?.trim()) {
      where.action = { contains: opts.action.trim(), mode: 'insensitive' };
    }
    if (opts?.q?.trim()) {
      const q = opts.q.trim();
      where.OR = [
        { action: { contains: q, mode: 'insensitive' } },
        { entityType: { contains: q, mode: 'insensitive' } },
        { entityId: { contains: q, mode: 'insensitive' } },
      ];
    }
    return this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      include: { actor: { select: { email: true, firstName: true, lastName: true } } },
    });
  }
}
