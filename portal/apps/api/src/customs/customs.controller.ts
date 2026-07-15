import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CustomsService } from './customs.service';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '@prisma/client';
import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

class CreateCustomsDto {
  @IsString()
  @MinLength(2)
  kennzeichen!: string;

  @IsString()
  @MinLength(2)
  grenzuebergang!: string;

  @IsDateString()
  zeit!: string;

  @IsString()
  @MinLength(2)
  importeur!: string;

  @IsOptional()
  @IsString()
  mandantId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class StatusDto {
  @IsString()
  status!: string;
}

@Controller('customs')
@UseGuards(RolesGuard)
export class CustomsController {
  constructor(private service: CustomsService) {}

  @Get()
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user);
  }

  @Get(':id')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user, id);
  }

  @Post()
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCustomsDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id/status')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  status(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: StatusDto) {
    return this.service.updateStatus(user, id, dto.status);
  }
}
