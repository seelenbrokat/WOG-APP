import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ConfigService } from '@nestjs/config';
import { IntegrationSystem, UserRole } from '@prisma/client';
import { Allow, IsBoolean, IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { Roles, CurrentUser, AuthUser } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { ExchangeHubService } from './exchange-hub.service';
import { BusinessPartnerService } from './business-partner.service';

class CreateTransferDto {
  @IsEnum(IntegrationSystem)
  fromSystem!: IntegrationSystem;

  @IsEnum(IntegrationSystem)
  toSystem!: IntegrationSystem;

  @IsOptional()
  @IsString()
  customsOrderId?: string;

  @IsOptional()
  @IsString()
  shipmentId?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsBoolean()
  processNow?: boolean;
}

class ImportBusinessPartnersDto {
  @IsOptional()
  @IsIn(['CUSTOMER', 'PARTNER'])
  kind?: 'CUSTOMER' | 'PARTNER';

  /** Roh-JSON (PORTALGP.v1-BusinessPartner oder Array) */
  @Allow()
  payload!: unknown;
}

@Controller('integrations')
@UseGuards(RolesGuard)
export class IntegrationsController {
  constructor(
    private config: ConfigService,
    private hub: ExchangeHubService,
    private businessPartners: BusinessPartnerService,
  ) {}

  @Get('soloplan/status')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  soloplanStatus(@CurrentUser() _user: AuthUser) {
    return {
      enabled: this.config.get('SOLOPLAN_ENABLED') === 'true',
      mode: this.config.get('SOLOPLAN_MODE') || 'stub',
      baseUrlConfigured: Boolean(this.config.get('SOLOPLAN_BASE_URL')),
      businessPartnerImportDir: 'data/integrations/soloplan/business-partners/in',
    };
  }

  @Get('soloplan/business-partners')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  listBusinessPartners(@CurrentUser() user: AuthUser) {
    return this.businessPartners.list(user);
  }

  @Post('soloplan/business-partners/import')
  @Roles(UserRole.ORG_ADMIN)
  importBusinessPartners(@CurrentUser() user: AuthUser, @Body() dto: ImportBusinessPartnersDto) {
    return this.businessPartners.importJson(user, dto.payload, { kind: dto.kind });
  }

  @Post('soloplan/business-partners/import-file')
  @Roles(UserRole.ORG_ADMIN)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }))
  importBusinessPartnerFile(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body('kind') kind?: 'CUSTOMER' | 'PARTNER',
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Keine Datei hochgeladen');
    }
    return this.businessPartners.importFileBuffer(
      user,
      file.originalname || 'upload.json',
      file.buffer,
      kind,
    );
  }

  @Post('soloplan/business-partners/poll-inbox')
  @Roles(UserRole.ORG_ADMIN)
  pollBusinessPartners(@CurrentUser() user: AuthUser) {
    return this.businessPartners.processInboundDir(user.organizationId);
  }

  @Get('hub/status')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  hubStatus(@CurrentUser() _user: AuthUser) {
    return this.hub.status();
  }

  @Get('hub/transfers')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  transfers(@CurrentUser() user: AuthUser) {
    return this.hub.listTransfers(user);
  }

  @Post('hub/transfers')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  createTransfer(@CurrentUser() user: AuthUser, @Body() dto: CreateTransferDto) {
    return this.hub.createTransfer(user, dto);
  }

  @Post('hub/transfers/:id/process')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  process(@Param('id') id: string) {
    return this.hub.processTransfer(id);
  }

  @Post('hub/poll-inbox')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  pollInbox(@CurrentUser() user: AuthUser) {
    return this.hub.processInboundQueues(user.organizationId);
  }
}
