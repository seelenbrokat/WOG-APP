import { Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { TourService } from '../integrations/tour.service';
import { TelematicsService } from '../integrations/telematics.service';
import { IntouchService } from '../integrations/intouch.service';
import { LoadingUnitService } from '../integrations/loading-unit.service';

@Controller('tours')
@UseGuards(RolesGuard)
export class ToursController {
  constructor(
    private tours: TourService,
    private telematics: TelematicsService,
    private intouch: IntouchService,
    private loadingUnits: LoadingUnitService,
  ) {}

  @Get()
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  list(
    @CurrentUser() user: AuthUser,
    @Query('vehicleId') vehicleId?: string,
    @Query('mandantId') mandantId?: string,
    @Query('date') date?: string,
    @Query('q') q?: string,
    @Query('includeCancelled') includeCancelled?: string,
  ) {
    return this.tours.listTours(user, {
      vehicleId,
      mandantId,
      date,
      q,
      includeCancelled: includeCancelled === '1' || includeCancelled === 'true',
    });
  }

  @Get('vehicles')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  vehicles(@CurrentUser() user: AuthUser, @Query('mandantId') mandantId?: string) {
    return this.tours.listVehicles(user, { mandantId });
  }

  @Get('fleet-map')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  fleetMap(@CurrentUser() user: AuthUser, @Query('mandantId') mandantId?: string) {
    return this.telematics.fleetMap(user, { mandantId });
  }

  @Get('ops-dashboard')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  opsDashboard(@CurrentUser() user: AuthUser, @Query('mandantId') mandantId?: string) {
    return this.tours.opsDashboard(user, { mandantId });
  }

  @Get('intouch/status')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  intouchStatus() {
    return this.intouch.status();
  }

  @Get('intouch/files')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  intouchFiles(@CurrentUser() user: AuthUser, @Query('channel') channel?: string) {
    return this.intouch.list(user, channel);
  }

  @Post('intouch/poll-inbox')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  intouchPoll(@CurrentUser() user: AuthUser) {
    return this.intouch.processInboundDir(user.organizationId);
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

  @Get('loading-units/balances')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  loadingUnitBalances(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
    @Query('matchcode') matchcode?: string,
    @Query('includeZero') includeZero?: string,
  ) {
    return this.loadingUnits.listBalances(user, {
      q,
      matchcode,
      includeZero: includeZero === '1' || includeZero === 'true',
    });
  }

  @Get('loading-units/postings')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  loadingUnitPostings(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
    @Query('matchcode') matchcode?: string,
    @Query('partnerNumber') partnerNumber?: string,
    @Query('partnerName') partnerName?: string,
    @Query('includeSkipped') includeSkipped?: string,
    @Query('take') take?: string,
  ) {
    return this.loadingUnits.listPostings(user, {
      q,
      matchcode,
      partnerNumber,
      partnerName,
      includeSkipped: includeSkipped === '1' || includeSkipped === 'true',
      take: take ? Number(take) : undefined,
    });
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

  @Get('documents/:docId/zustellnachweis')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  async zustellnachweis(
    @CurrentUser() user: AuthUser,
    @Param('docId') docId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { file, fileName, mimeType } = await this.telematics.generateZustellnachweis(user, docId);
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
    const intouch = await this.intouch.processInboundDir(user.organizationId);
    return { tours, telematics, intouch };
  }
}
