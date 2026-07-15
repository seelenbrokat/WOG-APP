import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Roles, CurrentUser, AuthUser } from '../auth/auth.types';
import { UserRole } from '@prisma/client';
import { UseGuards } from '@nestjs/common';
import { RolesGuard } from '../auth/roles.guard';

@Controller('integrations')
@UseGuards(RolesGuard)
export class IntegrationsController {
  constructor(private config: ConfigService) {}

  @Get('soloplan/status')
  @Roles(UserRole.ORG_ADMIN)
  status(@CurrentUser() _user: AuthUser) {
    return {
      enabled: this.config.get('SOLOPLAN_ENABLED') === 'true',
      mode: this.config.get('SOLOPLAN_MODE') || 'stub',
      baseUrlConfigured: Boolean(this.config.get('SOLOPLAN_BASE_URL')),
    };
  }
}
