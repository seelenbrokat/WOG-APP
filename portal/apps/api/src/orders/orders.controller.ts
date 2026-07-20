import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { OrdersService } from './orders.service';

@Controller('orders')
@UseGuards(RolesGuard)
export class OrdersController {
  constructor(private service: OrdersService) {}

  @Get()
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  list(
    @CurrentUser() user: AuthUser,
    @Query('customerId') customerId?: string,
    @Query('openOnly') openOnly?: string,
  ) {
    return this.service.list(user, {
      customerId,
      openOnly: openOnly === '1' || openOnly === 'true',
    });
  }

  @Get(':id')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user, id);
  }

  /** Kumulierte Ladeliste / Auftragsbestätigung (PDF) für alle Sendungen. */
  @Post(':id/loading-list')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  loadingList(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.generateLoadingList(user, id);
  }
}
