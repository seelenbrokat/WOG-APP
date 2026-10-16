import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '@prisma/client';

@Controller('notifications')
@UseGuards(RolesGuard)
export class NotificationsController {
  constructor(private prisma: PrismaService) {}

  @Get('outbox')
  @Roles(UserRole.ORG_ADMIN)
  outbox(@CurrentUser() user: AuthUser) {
    return this.prisma.emailOutbox.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
