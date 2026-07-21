import { Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { TourService } from '../integrations/tour.service';
import { TelematicsService } from '../integrations/telematics.service';

@Controller('tours')
@UseGuards(RolesGuard)
export class ToursController {
  constructor(
    private tours: TourService,
    private telematics: TelematicsService,
  ) {}

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

  @Get('fleet-map')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  fleetMap(@CurrentUser() user: AuthUser) {
    return this.telematics.fleetMap(user);
  }

  @Get('events')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  events(
    @CurrentUser() user: AuthUser,
    @Query('tourId') tourId?: string,
    @Query('vehicleId') vehicleId?: string,
  ) {
    return this.telematics.listEvents(user, { tourId, vehicleId });
  }

  @Get('documents/:docId/download')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  async downloadDoc(
    @CurrentUser() user: AuthUser,
    @Param('docId') docId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { file, fileName, mimeType } = await this.telematics.downloadDocument(user, docId);
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="${fileName.replace(/"/g, '')}"`,
    });
    return file;
  }

  @Get(':id')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const tour = await this.tours.getTour(user, id);
    const extras = await this.telematics.getTourExtras(user, id);
    return { ...tour, ...extras };
  }

  @Post('poll-inbox')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  async poll(@CurrentUser() user: AuthUser) {
    const tours = await this.tours.processInboundDir(user.organizationId);
    const telematics = await this.telematics.processInboundDir(user.organizationId, 200);
    return { tours, telematics };
  }
}
