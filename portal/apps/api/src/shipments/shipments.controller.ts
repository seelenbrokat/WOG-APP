import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ShipmentsService } from './shipments.service';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { ShipmentStatus, UserRole } from '@prisma/client';
import {
  Allow,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class PositionDto {
  @IsString()
  description!: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  quantity?: number;

  /** Verpackungsart-Code, z. B. EUP, KRT */
  @IsOptional()
  @IsString()
  packaging?: string;

  /**
   * Bei quantity > 1 = Gesamtgewicht der Gruppe (wird auf Colli aufgeteilt).
   * Bei quantity = 1 = Gewicht dieses Collos.
   */
  @IsOptional()
  @IsNumber()
  weightKg?: number;

  @IsOptional()
  @IsNumber()
  lengthCm?: number;

  @IsOptional()
  @IsNumber()
  widthCm?: number;

  @IsOptional()
  @IsNumber()
  heightCm?: number;

  @IsOptional()
  @IsString()
  sscc?: string;
}

class CreateShipmentDto {
  @IsString()
  mandantId!: string;

  /** Nur leere Aufträge (0 Sendungen); sonst immer neuer VLB-Auftrag (1:1). */
  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  transportMode?: string;

  @IsOptional()
  @IsString()
  goodsDescription?: string;

  @IsOptional()
  @IsNumber()
  packageCount?: number;

  @IsOptional()
  @IsNumber()
  weightKg?: number;

  @IsOptional()
  @IsNumber()
  volumeM3?: number;

  @IsOptional()
  @IsString()
  pickupCompany?: string;

  @IsOptional()
  @IsString()
  pickupStreet?: string;

  @IsOptional()
  @IsString()
  pickupZip?: string;

  @IsOptional()
  @IsString()
  pickupCity?: string;

  @IsOptional()
  @IsString()
  pickupCountry?: string;

  @IsOptional()
  @IsDateString()
  pickupDate?: string;

  @IsOptional()
  @IsString()
  deliveryCompany?: string;

  @IsOptional()
  @IsString()
  deliveryStreet?: string;

  @IsOptional()
  @IsString()
  deliveryZip?: string;

  @IsOptional()
  @IsString()
  deliveryCity?: string;

  @IsOptional()
  @IsString()
  deliveryCountry?: string;

  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  /** Telefon für Zustell-Aviso */
  @IsOptional()
  @IsString()
  deliveryAvisPhone?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Zusatzoptionen (Hebebühne, Aviso, Gefahrgut, …) */
  @IsOptional()
  @IsObject()
  @Allow()
  extras?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  submit?: boolean;

  @IsOptional()
  @IsString()
  pickupAddressId?: string;

  @IsOptional()
  @IsString()
  deliveryAddressId?: string;

  @IsOptional()
  @IsBoolean()
  savePickupAddress?: boolean;

  @IsOptional()
  @IsBoolean()
  saveDeliveryAddress?: boolean;

  @IsOptional()
  @IsString()
  saveAsTemplateName?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PositionDto)
  positions?: PositionDto[];
}

class StatusDto {
  @IsEnum(ShipmentStatus)
  status!: ShipmentStatus;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsString()
  location?: string;
}

@Controller('shipments')
@UseGuards(RolesGuard)
export class ShipmentsController {
  constructor(private service: ShipmentsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('mandantId') mandantId?: string) {
    return this.service.list(user, mandantId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user, id);
  }

  @Post()
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateShipmentDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id/status')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  status(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: StatusDto) {
    return this.service.updateStatus(user, id, dto.status, dto.message, dto.location);
  }
}
