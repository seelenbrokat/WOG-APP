import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '@prisma/client';

@Controller('audit')
@UseGuards(RolesGuard)
export class AuditController {
  constructor(
    private audit: AuditService,
    private prisma: PrismaService,
  ) {}

  @Get()
  @Roles(UserRole.ORG_ADMIN)
  async list(
    @CurrentUser() user: AuthUser,
    @Query('take') take?: string,
    @Query('entityType') entityType?: string,
    @Query('action') action?: string,
    @Query('q') q?: string,
  ) {
    const users = await this.prisma.user.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true },
    });
    return this.audit.list(users.map((u) => u.id), {
      take: take ? Number(take) : 150,
      entityType,
      action,
      q,
    });
  }
}
