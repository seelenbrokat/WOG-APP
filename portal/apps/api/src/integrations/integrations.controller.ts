import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ConfigService } from '@nestjs/config';
import { IntegrationSystem, UserRole } from '@prisma/client';
import { Allow, IsBoolean, IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { Response } from 'express';
import { Roles, CurrentUser, AuthUser } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { ExchangeHubService } from './exchange-hub.service';
import { BusinessPartnerService } from './business-partner.service';
import { ShippingNetService } from './shippingnet.service';
import { SoloplanService } from './soloplan.service';

class CreateTransferDto {
  @IsEnum(IntegrationSystem)
  fromSystem!: IntegrationSystem;

  @IsEnum(IntegrationSystem)
  toSystem!: IntegrationSystem;

  @IsOptional()
  @IsString()
  customsOrderId?: string;

  @IsOptional()
  @IsString()
  shipmentId?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsBoolean()
  processNow?: boolean;
}

class ImportBusinessPartnersDto {
  @IsOptional()
  @IsIn(['CUSTOMER', 'PARTNER'])
  kind?: 'CUSTOMER' | 'PARTNER';

  /** Roh-JSON (PORTALGP.v1-BusinessPartner oder Array) */
  @Allow()
  payload!: unknown;
}

class ShippingNetDeliveredDto {
  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  statusDate?: string;
}

class ShippingNetStatusDto {
  @IsString()
  statusId!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  statusDate?: string;
}

class ShippingNetAblieferbelegFieldsDto {
  @IsOptional()
  @IsString()
  documentType?: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsString()
  number?: string;

  @IsOptional()
  @IsString()
  statusDate?: string;

  /** "true" / "1" wenn gleichzeitig Status DVD gesetzt werden soll */
  @IsOptional()
  @IsString()
  markDelivered?: string;
}

@Controller('integrations')
@UseGuards(RolesGuard)
export class IntegrationsController {
  constructor(
    private config: ConfigService,
    private hub: ExchangeHubService,
    private businessPartners: BusinessPartnerService,
    private shippingNet: ShippingNetService,
    private soloplan: SoloplanService,
  ) {}

  @Get('soloplan/status')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  soloplanStatus(@CurrentUser() _user: AuthUser) {
    return this.soloplan.status();
  }

  /** Ausstehende Soloplan Order-/Consignment-JSONs im FTP-Outbound */
  @Get('soloplan/orders')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  listSoloplanOrders(@CurrentUser() _user: AuthUser) {
    return { files: this.soloplan.listOutboundFiles() };
  }

  @Get('soloplan/orders/:fileName/download')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  downloadSoloplanOrder(
    @Param('fileName') fileName: string,
    @Res() res: Response,
  ) {
    const { fileName: name, stream } = this.soloplan.openOutboundFile(decodeURIComponent(fileName));
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    stream.pipe(res);
  }

  /** Sendung als SoloplanOrderImportPORTAL-v6 JSON exportieren (File-Outbound) */
  @Post('soloplan/shipments/:shipmentId/export')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  exportShipmentToSoloplan(@Param('shipmentId') shipmentId: string) {
    return this.soloplan.exportShipment(shipmentId);
  }

  @Get('soloplan/business-partners')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  listBusinessPartners(@CurrentUser() user: AuthUser) {
    return this.businessPartners.list(user);
  }

  @Post('soloplan/business-partners/import')
  @Roles(UserRole.ORG_ADMIN)
  importBusinessPartners(@CurrentUser() user: AuthUser, @Body() dto: ImportBusinessPartnersDto) {
    return this.businessPartners.importJson(user, dto.payload, { kind: dto.kind });
  }

  @Post('soloplan/business-partners/import-file')
  @Roles(UserRole.ORG_ADMIN)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }))
  importBusinessPartnerFile(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body('kind') kind?: 'CUSTOMER' | 'PARTNER',
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Keine Datei hochgeladen');
    }
    return this.businessPartners.importFileBuffer(
      user,
      file.originalname || 'upload.json',
      file.buffer,
      kind,
    );
  }

  @Post('soloplan/business-partners/poll-inbox')
  @Roles(UserRole.ORG_ADMIN)
  pollBusinessPartners(@CurrentUser() user: AuthUser) {
    return this.businessPartners.processInboundDir(user.organizationId);
  }

  @Get('shippingnet/status')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  shippingNetStatus(@CurrentUser() _user: AuthUser) {
    return this.shippingNet.status();
  }

  /**
   * Setzt in shipping.NET / OnDot den Status DVD (Zugestellt) für eine Sendungsnummer.
   * Beispiel: POST /api/integrations/shippingnet/shipments/435958.1/delivered
   */
  @Post('shippingnet/shipments/:number/delivered')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  markShipmentDelivered(
    @CurrentUser() user: AuthUser,
    @Param('number') number: string,
    @Body() dto: ShippingNetDeliveredDto,
  ) {
    return this.shippingNet.markDelivered(user, decodeURIComponent(number), {
      description: dto.description,
      statusDate: dto.statusDate,
    });
  }

  /** Beliebigen shipping.NET-Status setzen (StatusID z. B. DVD, RUN, SAT). */
  @Post('shippingnet/shipments/:number/status')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  setShipmentStatus(
    @CurrentUser() user: AuthUser,
    @Param('number') number: string,
    @Body() dto: ShippingNetStatusDto,
  ) {
    return this.shippingNet.importStatus(user, decodeURIComponent(number), dto.statusId, {
      description: dto.description,
      statusDate: dto.statusDate,
    });
  }

  @Get('shippingnet/shipments/:number/status')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  getShipmentStatus(@Param('number') number: string) {
    return this.shippingNet.retrieveStatus(decodeURIComponent(number));
  }

  /**
   * Ablieferbeleg (PDF/PNG/JPG) zu einer Sendungsnummer nach shipping.NET hochladen.
   * multipart/form-data Feld: file
   * Optional: documentType, comment, number, markDelivered=true
   */
  @Post('shippingnet/shipments/:number/ablieferbeleg')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }))
  uploadAblieferbeleg(
    @CurrentUser() user: AuthUser,
    @Param('number') number: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: ShippingNetAblieferbelegFieldsDto,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Datei fehlt (multipart-Feld "file")');
    }
    const markDelivered =
      dto.markDelivered === 'true' || dto.markDelivered === '1' || dto.markDelivered === 'yes';
    return this.shippingNet.uploadAblieferbeleg(user, decodeURIComponent(number), file, {
      documentType: dto.documentType,
      comment: dto.comment,
      number: dto.number,
      markDelivered,
      statusDate: dto.statusDate,
    });
  }

  /** Generischer Dokument-Upload nach shipping.NET (Typ über documentType). */
  @Post('shippingnet/shipments/:number/document')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }))
  uploadDocument(
    @CurrentUser() user: AuthUser,
    @Param('number') number: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('documentType') documentType: string,
    @Body('comment') comment?: string,
    @Body('number') docNumber?: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Datei fehlt (multipart-Feld "file")');
    }
    if (!documentType?.trim()) {
      throw new BadRequestException('documentType fehlt (z. B. OtherDocument, DeliveryNote)');
    }
    return this.shippingNet.addDocument(user, decodeURIComponent(number), file, {
      documentType: documentType.trim(),
      comment,
      number: docNumber,
    });
  }

  @Get('hub/status')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  hubStatus(@CurrentUser() _user: AuthUser) {
    return this.hub.status();
  }

  @Get('hub/transfers')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  transfers(@CurrentUser() user: AuthUser) {
    return this.hub.listTransfers(user);
  }

  @Post('hub/transfers')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  createTransfer(@CurrentUser() user: AuthUser, @Body() dto: CreateTransferDto) {
    return this.hub.createTransfer(user, dto);
  }

  @Post('hub/transfers/:id/process')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  process(@Param('id') id: string) {
    return this.hub.processTransfer(id);
  }

  @Post('hub/poll-inbox')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  pollInbox(@CurrentUser() user: AuthUser) {
    return this.hub.processInboundQueues(user.organizationId);
  }
}
