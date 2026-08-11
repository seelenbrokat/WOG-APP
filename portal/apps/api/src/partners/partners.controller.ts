import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { PartnersService } from './partners.service';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '@prisma/client';
import { IsOptional, IsString } from 'class-validator';
import { Public } from '../auth/public.decorator';

class CreatePartnerDto {
  @IsString()
  name!: string;

  @IsString()
  code!: string;

  @IsOptional()
  @IsString()
  sftpUsername?: string;
}

@Controller('partners')
@UseGuards(RolesGuard)
export class PartnersController {
  constructor(private service: PartnersService) {}

  @Get()
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user);
  }

  @Post()
  @Roles(UserRole.ORG_ADMIN)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePartnerDto) {
    return this.service.create(user, dto);
  }

  @Get('jobs')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  jobs(@CurrentUser() user: AuthUser, @Query('partnerId') partnerId?: string) {
    return this.service.listJobs(user, partnerId);
  }

  @Public()
  @Get('external/jobs')
  partnerApi(@Headers('x-api-key') apiKey: string) {
    return this.service.partnerShipments(apiKey);
  }

  @Get(':id')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user, id);
  }
}
