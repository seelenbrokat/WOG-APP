import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { DamageStatus, UserRole } from '@prisma/client';
import { DamagesService } from './damages.service';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';

class CreateDamageDto {
  @IsString()
  @MinLength(2)
  title!: string;

  @IsString()
  @MinLength(2)
  description!: string;

  @IsOptional()
  @IsString()
  shipmentId?: string;

  @IsOptional()
  @IsString()
  location?: string;
}

class StatusDto {
  @IsEnum(DamageStatus)
  status!: DamageStatus;
}

const STAFF = [UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.WAREHOUSE_STAFF] as const;

@Controller('damages')
@UseGuards(RolesGuard)
export class DamagesController {
  constructor(private service: DamagesService) {}

  @Get()
  @Roles(...STAFF)
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user);
  }

  @Get(':id')
  @Roles(...STAFF)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user, id);
  }

  @Post()
  @Roles(...STAFF)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDamageDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id/status')
  @Roles(...STAFF)
  status(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: StatusDto) {
    return this.service.updateStatus(user, id, dto.status);
  }

  @Post(':id/photos')
  @Roles(...STAFF)
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }),
  )
  photo(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Datei fehlt');
    return this.service.addPhoto(user, id, file);
  }
}
