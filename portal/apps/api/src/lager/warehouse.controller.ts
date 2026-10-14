import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole, WarehouseLocationKind, WarehousePalletType } from '@prisma/client';
import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { WarehouseStorageService } from './warehouse-storage.service';

class InboundDto {
  @IsString()
  customerId!: string;

  @IsString()
  locationId!: string;

  @IsOptional()
  @IsEnum(WarehousePalletType)
  palletType?: WarehousePalletType;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  slotUnits?: number;

  @IsOptional()
  @IsString()
  articleId?: string;

  @IsOptional()
  @IsString()
  articleName?: string;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsString()
  sscc?: string;

  @IsOptional()
  @IsString()
  externalRef?: string;

  @IsOptional()
  @IsString()
  shipmentId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class OutboundDto {
  @IsOptional()
  @IsString()
  note?: string;
}

class LocationDto {
  @IsString()
  code!: string;

  @IsOptional()
  @IsEnum(WarehouseLocationKind)
  kind?: WarehouseLocationKind;

  @IsOptional()
  @IsNumber()
  aisle?: number;

  @IsOptional()
  @IsNumber()
  level?: number;

  @IsOptional()
  @IsNumber()
  bay?: number;

  @IsOptional()
  @IsNumber()
  slot?: number;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  capacitySlots?: number;
}

class PatchLocationDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  capacitySlots?: number;
}

class RateDto {
  @IsString()
  customerId!: string;

  @IsEnum(WarehousePalletType)
  palletType!: WarehousePalletType;

  @IsNumber()
  inboundFee!: number;

  @IsNumber()
  outboundFee!: number;

  @IsNumber()
  storageFeePerSlot!: number;
}

class ArticleDto {
  @IsString()
  customerId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  articleNumber?: string;

  @IsOptional()
  @IsEnum(WarehousePalletType)
  palletType?: WarehousePalletType;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  slotUnits?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

class PatchArticleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  articleNumber?: string;

  @IsOptional()
  @IsEnum(WarehousePalletType)
  palletType?: WarehousePalletType;

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  slotUnits?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

class LayoutDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  aisles?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  levels?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  bays?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  slotsPerBay?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  blockZones?: number;
}

const STAFF = [UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER] as const;

@Controller('warehouse')
@UseGuards(RolesGuard)
export class WarehouseController {
  constructor(private warehouse: WarehouseStorageService) {}

  @Get('meta')
  @Roles(...STAFF, UserRole.CUSTOMER_USER)
  meta() {
    return this.warehouse.meta();
  }

  @Post('layout/ensure-default')
  @Roles(...STAFF)
  ensureLayout(@CurrentUser() user: AuthUser, @Body() dto: LayoutDto) {
    return this.warehouse.ensureDefaultLayout(user, dto || {});
  }

  /** Fehlende Plätze nachziehen (z. B. mehr Reihen), bestehende bleiben. */
  @Post('layout/extend')
  @Roles(...STAFF)
  extendLayout(@CurrentUser() user: AuthUser, @Body() dto: LayoutDto) {
    return this.warehouse.extendLayout(user, dto || {});
  }

  @Get('layout/map')
  @Roles(...STAFF)
  occupancyMap(@CurrentUser() user: AuthUser) {
    return this.warehouse.occupancyMap(user);
  }

  @Get('locations')
  @Roles(...STAFF)
  locations(
    @CurrentUser() user: AuthUser,
    @Query('kind') kind?: string,
    @Query('freeOnly') freeOnly?: string,
    @Query('q') q?: string,
  ) {
    return this.warehouse.listLocations(user, {
      kind,
      freeOnly: freeOnly === '1' || freeOnly === 'true',
      q,
    });
  }

  @Get('locations/suggest')
  @Roles(...STAFF)
  suggest(
    @CurrentUser() user: AuthUser,
    @Query('palletType') palletType?: string,
    @Query('slots') slots?: string,
  ) {
    return this.warehouse.suggestFreeLocation(
      user,
      (palletType as WarehousePalletType) || WarehousePalletType.EURO,
      slots ? Number(slots) : undefined,
    );
  }

  @Post('locations')
  @Roles(...STAFF)
  createLocation(@CurrentUser() user: AuthUser, @Body() dto: LocationDto) {
    return this.warehouse.createLocation(user, dto);
  }

  @Patch('locations/:id')
  @Roles(...STAFF)
  patchLocation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: PatchLocationDto,
  ) {
    return this.warehouse.updateLocation(user, id, dto);
  }

  @Get('stock')
  @Roles(...STAFF, UserRole.CUSTOMER_USER)
  stock(
    @CurrentUser() user: AuthUser,
    @Query('customerId') customerId?: string,
    @Query('q') q?: string,
    @Query('locationId') locationId?: string,
    @Query('status') status?: 'STORED' | 'RELEASED' | 'ALL',
  ) {
    return this.warehouse.listStock(user, { customerId, q, locationId, status });
  }

  @Post('inbound')
  @Roles(...STAFF)
  inbound(@CurrentUser() user: AuthUser, @Body() dto: InboundDto) {
    return this.warehouse.inbound(user, dto);
  }

  @Post('units/:id/outbound')
  @Roles(...STAFF)
  outbound(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: OutboundDto,
  ) {
    return this.warehouse.outbound(user, id, dto.note);
  }

  @Get('rates')
  @Roles(...STAFF)
  rates(@CurrentUser() user: AuthUser, @Query('customerId') customerId?: string) {
    return this.warehouse.listRates(user, customerId);
  }

  @Post('rates')
  @Roles(...STAFF)
  upsertRate(@CurrentUser() user: AuthUser, @Body() dto: RateDto) {
    return this.warehouse.upsertRate(user, dto);
  }

  @Get('billing/monthly')
  @Roles(...STAFF, UserRole.CUSTOMER_USER)
  billing(
    @CurrentUser() user: AuthUser,
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('customerId') customerId?: string,
  ) {
    const now = new Date();
    return this.warehouse.monthlyBilling(
      user,
      Number(year) || now.getUTCFullYear(),
      Number(month) || now.getUTCMonth() + 1,
      customerId,
    );
  }

  @Get('overview')
  @Roles(...STAFF)
  overview(@CurrentUser() user: AuthUser) {
    return this.warehouse.overview(user);
  }

  @Get('customers')
  @Roles(...STAFF)
  warehouseCustomers(@CurrentUser() user: AuthUser) {
    return this.warehouse.listWarehouseCustomers(user);
  }

  @Get('articles')
  @Roles(...STAFF, UserRole.CUSTOMER_USER)
  articles(
    @CurrentUser() user: AuthUser,
    @Query('customerId') customerId?: string,
    @Query('all') all?: string,
  ) {
    return this.warehouse.listArticles(
      user,
      customerId,
      all === '1' || all === 'true',
    );
  }

  @Post('articles')
  @Roles(...STAFF)
  createArticle(@CurrentUser() user: AuthUser, @Body() dto: ArticleDto) {
    return this.warehouse.createArticle(user, dto);
  }

  @Patch('articles/:id')
  @Roles(...STAFF)
  patchArticle(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: PatchArticleDto,
  ) {
    return this.warehouse.updateArticle(user, id, dto);
  }
}
