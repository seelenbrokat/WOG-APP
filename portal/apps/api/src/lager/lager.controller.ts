import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { createReadStream } from 'fs';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { LademittelscheinService } from './lademittelschein.service';

@Controller('lager')
@UseGuards(RolesGuard)
export class LagerController {
  constructor(private scheine: LademittelscheinService) {}

  @Get('lademittelscheine')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  list(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
    @Query('status') status?: string,
  ) {
    return this.scheine.list(user, { q, status });
  }

  @Get('lademittelscheine/partner')
  @Roles(UserRole.PARTNER)
  listPartner(@CurrentUser() user: AuthUser) {
    return this.scheine.listForPartner(user);
  }

  @Get('lademittelscheine/partner/balances')
  @Roles(UserRole.PARTNER)
  partnerBalances(@CurrentUser() user: AuthUser) {
    return this.scheine.balancesForPartner(user);
  }

  @Get('lademittelscheine/partner/export')
  @Roles(UserRole.PARTNER)
  async partnerExport(
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query('format') format?: 'csv' | 'pdf',
  ) {
    const out = await this.scheine.exportForPartner(user, format === 'pdf' ? 'pdf' : 'csv');
    res.setHeader('Content-Type', out.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${out.fileName.replace(/"/g, '')}"`,
    );
    res.send(out.buffer);
  }

  @Get('lademittelscheine/dirs')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  dirs() {
    return this.scheine.dirs();
  }

  @Get('lademittelscheine/:id')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.PARTNER)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.scheine.get(user, id);
  }

  @Get('lademittelscheine/:id/pdf')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.PARTNER)
  async pdf(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const doc = await this.scheine.openPdf(user, id);
    res.setHeader('Content-Type', doc.mimeType || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${doc.fileName}"`);
    createReadStream(doc.storagePath).pipe(res);
  }

  @Post('lademittelscheine/from-tour')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  fromTour(@CurrentUser() user: AuthUser, @Body() body: { tourId: string }) {
    return this.scheine.createFromTour(user, body.tourId);
  }

  @Post('lademittelscheine/process-inbound')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  processInbound(@CurrentUser() user: AuthUser) {
    return this.scheine.processInboundDir(user.organizationId);
  }

  @Post('lademittelscheine')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  create(@CurrentUser() user: AuthUser, @Body() body: Record<string, unknown>) {
    return this.scheine.createManual(user, body as any);
  }

  @Patch('lademittelscheine/:id')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.scheine.updateDraft(user, id, body as any);
  }

  @Post('lademittelscheine/:id/complete')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.scheine.complete(user, id, body as any);
  }
}
