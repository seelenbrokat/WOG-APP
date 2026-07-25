import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '@prisma/client';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

class UpdateOrgDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
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
}
