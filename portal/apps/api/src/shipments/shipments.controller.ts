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
import { AddressValidationService } from '../common/address-validation.service';

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

  /** Zustellung bis (Ende) */
  @IsOptional()
  @IsDateString()
  deliveryDateEnd?: string;

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

class ValidateAddressDto {
  @IsOptional()
  @IsString()
  company?: string;

  @IsString()
  street!: string;

  @IsString()
  zip!: string;

  @IsString()
  city!: string;

  @IsString()
  country!: string;
}

@Controller('shipments')
@UseGuards(RolesGuard)
export class ShipmentsController {
  constructor(
    private service: ShipmentsService,
    private addressValidation: AddressValidationService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('mandantId') mandantId?: string,
    @Query('q') q?: string,
    @Query('missingDocCategory') missingDocCategory?: string,
    @Query('docDownload') docDownload?: string,
    @Query('docCategory') docCategory?: string,
  ) {
    return this.service.list(user, {
      mandantId,
      q,
      missingDocCategory,
      docDownload,
      docCategory,
    });
  }

  @Post('validate-address')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  validateAddress(@Body() dto: ValidateAddressDto) {
    return this.addressValidation.validate(dto);
  }

  /** Lager-Scan: Sendung/Collo per SSCC (vor :id, damit „by-sscc“ nicht als ID gilt) */
  @Get('by-sscc/:sscc')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  bySscc(@CurrentUser() user: AuthUser, @Param('sscc') sscc: string) {
    return this.service.findBySscc(user, sscc);
  }

  /** Scan-Labels: SCAN-TEST + Wareneingang (Auftrag 2291) */
  @Get('scan-test-labels')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  scanTestLabels(@CurrentUser() user: AuthUser) {
    return this.service.listScanTestLabels(user);
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

  /** Sendungsnachfrage an Disposition (Status/Zustellung, wenn kein POD). */
  @Post(':id/inquiry')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  inquiry(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body?: { note?: string },
  ) {
    return this.service.requestStatusInquiry(user, id, body?.note);
  }
}
