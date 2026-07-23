import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsNumber, IsOptional, IsString, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { UserRole } from '@prisma/client';
import { GoodsReceiptService } from './goods-receipt.service';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';

class OpenSessionDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsString()
  date!: string;

  @IsString()
  externalRef!: string;

  @IsOptional()
  @IsBoolean()
  allCustomerShipments?: boolean;

  /** z. B. Kunden-Auftragsnummer RPK1002343 */
  @IsOptional()
  @IsString()
  sessionLabel?: string;
}

class ScanDto {
  @IsString()
  sscc!: string;

  @IsOptional()
  @IsBoolean()
  damaged?: boolean;

  @IsOptional()
  @IsString()
  note?: string;
}

class DamageDto {
  @IsOptional()
  @IsString()
  note?: string;
}

class PhotoMetaDto {
  @IsOptional()
  @IsString()
  colloId?: string;

  @IsOptional()
  @IsString()
  surplusId?: string;

  @IsString()
  documentId!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

class DimensionsDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsNumber()
  lengthCm?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsNumber()
  widthCm?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsNumber()
  heightCm?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Type(() => Number)
  @IsNumber()
  weightKg?: number | null;
}

class CloseDto {
  @IsOptional()
  @IsString()
  notes?: string;
}

@Controller('goods-receipt')
@UseGuards(RolesGuard)
@Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
export class GoodsReceiptController {
  constructor(private service: GoodsReceiptService) {}

  @Get('entladeberichte')
  listEntladeberichte(@CurrentUser() user: AuthUser) {
    return this.service.listEntladeberichte(user);
  }

  @Get('groups')
  listGroups(
    @CurrentUser() user: AuthUser,
    @Query('customerId') customerId?: string,
    @Query('date') date?: string,
    @Query('q') q?: string,
  ) {
    return this.service.listGroups(user, { customerId, date, q });
  }

  @Post('sessions')
  openSession(@CurrentUser() user: AuthUser, @Body() dto: OpenSessionDto) {
    return this.service.openSession(user, dto);
  }

  @Get('sessions/:id')
  getSession(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getSession(user, id);
  }

  @Post('sessions/:id/scan')
  scan(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ScanDto) {
    return this.service.scan(user, id, dto.sscc, { damaged: dto.damaged, note: dto.note });
  }

  @Post('sessions/:id/colli/:colloId/damage')
  markDamaged(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('colloId') colloId: string,
    @Body() dto: DamageDto,
  ) {
    return this.service.markDamaged(user, id, colloId, dto.note);
  }

  @Post('sessions/:id/colli/:colloId/cancel')
  cancelMissing(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('colloId') colloId: string,
    @Body() dto: DamageDto,
  ) {
    return this.service.cancelMissingCollo(user, id, colloId, dto.note);
  }

  @Patch('sessions/:id/colli/:colloId/dimensions')
  updateDimensions(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('colloId') colloId: string,
    @Body() dto: DimensionsDto,
  ) {
    return this.service.updateColloDimensions(user, id, colloId, dto);
  }

  @Post('sessions/:id/photo')
  attachPhoto(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: PhotoMetaDto) {
    return this.service.attachPhotoMeta(user, id, dto);
  }

  @Post('sessions/:id/close')
  close(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CloseDto) {
    return this.service.closeSession(user, id, dto.notes);
  }

  /** ETB neu erzeugen und erneut an die Notify-Empfänger mailen. */
  @Post('sessions/:id/resend-etb')
  resendEtb(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.resendEntladebericht(user, id);
  }
}
