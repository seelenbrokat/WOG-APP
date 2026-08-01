import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';

@Injectable()
export class OrganizationsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  findMine(user: AuthUser) {
    return this.prisma.organization.findUnique({
      where: { id: user.organizationId },
      include: { mandanten: { orderBy: { name: 'asc' } } },
    });
  }

  async update(user: AuthUser, data: { name?: string; active?: boolean }) {
    const org = await this.prisma.organization.update({
      where: { id: user.organizationId },
      data,
    });
    await this.audit.log(user.id, 'organization.update', 'Organization', org.id, data);
    return org;
  }

  async getOrThrow(id: string) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organisation nicht gefunden');
    return org;
  }
}
