import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationSystem, UserRole } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { Roles, CurrentUser, AuthUser } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { ExchangeHubService } from './exchange-hub.service';

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

@Controller('integrations')
@UseGuards(RolesGuard)
export class IntegrationsController {
  constructor(
    private config: ConfigService,
    private hub: ExchangeHubService,
  ) {}

  @Get('soloplan/status')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  soloplanStatus(@CurrentUser() _user: AuthUser) {
    return {
      enabled: this.config.get('SOLOPLAN_ENABLED') === 'true',
      mode: this.config.get('SOLOPLAN_MODE') || 'stub',
      baseUrlConfigured: Boolean(this.config.get('SOLOPLAN_BASE_URL')),
    };
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
