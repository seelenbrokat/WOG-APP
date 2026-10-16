import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { MandantenService } from './mandanten.service';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

class CreateMandantDto {
  @IsString()
  @MinLength(2)
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  legalName?: string;
}

class UpdateMandantDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  legalName?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

@Controller('mandanten')
@UseGuards(RolesGuard)
export class MandantenController {
  constructor(private service: MandantenService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user);
  }

  @Post()
  @Roles(UserRole.ORG_ADMIN)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateMandantDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  @Roles(UserRole.ORG_ADMIN)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateMandantDto) {
    return this.service.update(user, id, dto);
  }
}
