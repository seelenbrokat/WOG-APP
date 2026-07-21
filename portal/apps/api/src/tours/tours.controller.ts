import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { TourService } from '../integrations/tour.service';

@Controller('tours')
@UseGuards(RolesGuard)
export class ToursController {
  constructor(private tours: TourService) {}

  @Get()
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  list(
    @CurrentUser() user: AuthUser,
    @Query('vehicleId') vehicleId?: string,
    @Query('date') date?: string,
    @Query('q') q?: string,
    @Query('includeCancelled') includeCancelled?: string,
  ) {
    return this.tours.listTours(user, {
      vehicleId,
      date,
      q,
      includeCancelled: includeCancelled === '1' || includeCancelled === 'true',
    });
  }

  @Get('vehicles')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  vehicles(@CurrentUser() user: AuthUser) {
    return this.tours.listVehicles(user);
  }

  @Get(':id')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tours.getTour(user, id);
  }

  @Post('poll-inbox')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  poll(@CurrentUser() user: AuthUser) {
    return this.tours.processInboundDir(user.organizationId);
  }
}
