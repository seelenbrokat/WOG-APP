import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { OrdersService } from './orders.service';

class BulkLoadingListDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  orderIds!: string[];

  /** true = Entwürfe übermitteln + Soloplan-Export; false = nur PDF */
  @IsOptional()
  @IsBoolean()
  handover?: boolean;
}

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

  /** Sammelladeliste / Übergabe für mehrere markierte Aufträge (vor :id-Routen). */
  @Post('loading-list/bulk')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  bulkLoadingList(@CurrentUser() user: AuthUser, @Body() dto: BulkLoadingListDto) {
    return this.service.generateBulkLoadingList(user, dto.orderIds, {
      handover: dto.handover,
    });
  }

  @Get(':id')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user, id);
  }

  /** Ladeliste / Auftragsbestätigung (PDF) für einen Auftrag. */
  @Post(':id/loading-list')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  loadingList(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.generateLoadingList(user, id);
  }
}
