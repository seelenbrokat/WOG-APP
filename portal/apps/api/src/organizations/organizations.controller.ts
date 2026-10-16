import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '@prisma/client';
import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

class UpdateOrgDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

class UpdateEzollInboundDto {
  /** Dateiname-Präfixe, die im eZoll-Drop ignoriert werden (z. B. 131., 671.). */
  @IsArray()
  @IsString({ each: true })
  filenameIgnorePrefixes!: string[];
}

@Controller('organizations')
@UseGuards(RolesGuard)
export class OrganizationsController {
  constructor(private service: OrganizationsService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.service.findMine(user);
  }

  @Patch('me')
  @Roles(UserRole.ORG_ADMIN)
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateOrgDto) {
    return this.service.update(user, dto);
  }

  @Get('me/settings/ezoll-inbound')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  getEzollInbound(@CurrentUser() user: AuthUser) {
    return this.service.getEzollInboundConfig(user);
  }

  @Patch('me/settings/ezoll-inbound')
  @Roles(UserRole.ORG_ADMIN)
  updateEzollInbound(@CurrentUser() user: AuthUser, @Body() dto: UpdateEzollInboundDto) {
    return this.service.updateEzollInboundConfig(user, dto.filenameIgnorePrefixes);
  }
}
