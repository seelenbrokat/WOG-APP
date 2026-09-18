import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Allow, IsBoolean, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { Public } from '../auth/public.decorator';
import { PostAblieferbelegService } from './post-ablieferbeleg.service';

class PostAblieferbelegJsonDto {
  @IsOptional()
  @IsString()
  shipmentNumber?: string;

  @IsOptional()
  @IsString()
  orderNumber?: string;

  @IsOptional()
  @IsString()
  itemNumber?: string;

  @IsOptional()
  @IsString()
  trackingNumber?: string;

  @IsOptional()
  @IsString()
  postBarcode?: string;

  @IsOptional()
  @IsString()
  clientReference?: string;

  @IsOptional()
  @IsString()
  deliveredAt?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  markDelivered?: boolean;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  /** PDF/Bild als Base64 (mit oder ohne data:-Prefix) */
  @IsString()
  contentBase64!: string;
}

class PostAblieferbelegFieldsDto {
  @IsOptional()
  @IsString()
  shipmentNumber?: string;

  @IsOptional()
  @IsString()
  orderNumber?: string;

  @IsOptional()
  @IsString()
  itemNumber?: string;

  @IsOptional()
  @IsString()
  trackingNumber?: string;

  @IsOptional()
  @IsString()
  postBarcode?: string;

  @IsOptional()
  @IsString()
  clientReference?: string;

  @IsOptional()
  @IsString()
  deliveredAt?: string;

  @IsOptional()
  @IsString()
  markDelivered?: string;

  @Allow()
  file?: unknown;
}

/**
 * Öffentliche Schnittstelle für Swiss-Post-Ablieferbelege.
 * Auth: Header `X-API-KEY: <POST_ABLIEFERBELEG_API_KEY>`
 *
 * Doku: docs/POST_ABLIEFERBELEG_API.md
 */
@Controller('integrations/post')
export class PostAblieferbelegController {
  constructor(private readonly service: PostAblieferbelegService) {}

  @Public()
  @Get('health')
  health(@Headers('x-api-key') apiKey?: string) {
    // Health ohne Key nur Basis; mit Key volle Statusinfo
    if (apiKey) this.service.assertApiKey(apiKey);
    return this.service.status();
  }

  /**
   * multipart/form-data
   * Pflicht: file
   * Mindestens eines: shipmentNumber | trackingNumber | postBarcode | orderNumber(+itemNumber)
   */
  @Public()
  @Post('ablieferbelege')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  uploadMultipart(
    @Headers('x-api-key') apiKey: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: PostAblieferbelegFieldsDto,
  ) {
    this.service.assertApiKey(apiKey);
    if (!file?.buffer?.length) {
      throw new BadRequestException('Datei fehlt (multipart-Feld "file")');
    }
    const markDelivered =
      dto.markDelivered == null ||
      dto.markDelivered === '' ||
      dto.markDelivered === 'true' ||
      dto.markDelivered === '1' ||
      dto.markDelivered === 'yes';
    return this.service.ingest({
      shipmentNumber: dto.shipmentNumber,
      orderNumber: dto.orderNumber,
      itemNumber: dto.itemNumber,
      trackingNumber: dto.trackingNumber,
      postBarcode: dto.postBarcode,
      clientReference: dto.clientReference,
      deliveredAt: dto.deliveredAt,
      markDelivered,
      sourceFileName: file.originalname,
      fileName: file.originalname,
      mimeType: file.mimetype,
      buffer: file.buffer,
    });
  }

  /** JSON-Variante mit Base64-Inhalt (für Systeme ohne Multipart). */
  @Public()
  @Post('ablieferbelege/json')
  uploadJson(@Headers('x-api-key') apiKey: string, @Body() dto: PostAblieferbelegJsonDto) {
    this.service.assertApiKey(apiKey);
    const raw = String(dto.contentBase64 || '')
      .replace(/^data:[^;]+;base64,/i, '')
      .trim();
    if (!raw) throw new BadRequestException('contentBase64 fehlt');
    let buffer: Buffer;
    try {
      buffer = Buffer.from(raw, 'base64');
    } catch {
      throw new BadRequestException('contentBase64 ungültig');
    }
    if (!buffer.length) throw new BadRequestException('contentBase64 leer');
    return this.service.ingest({
      shipmentNumber: dto.shipmentNumber,
      orderNumber: dto.orderNumber,
      itemNumber: dto.itemNumber,
      trackingNumber: dto.trackingNumber,
      postBarcode: dto.postBarcode,
      clientReference: dto.clientReference,
      deliveredAt: dto.deliveredAt,
      markDelivered: dto.markDelivered !== false,
      sourceFileName: dto.fileName,
      fileName: dto.fileName,
      mimeType: dto.mimeType || 'application/pdf',
      buffer,
    });
  }

  /**
   * Früh: nur Post-Tracking setzen (ohne POD), sobald die Sendung an die Post übergeben wurde.
   * Body: { postBarcode, shipmentNumber? | trackingNumber? | orderNumber? }
   */
  @Public()
  @Post('tracking')
  registerTracking(
    @Headers('x-api-key') apiKey: string,
    @Body()
    dto: {
      postBarcode?: string;
      shipmentNumber?: string;
      orderNumber?: string;
      itemNumber?: string;
      trackingNumber?: string;
      clientReference?: string;
    },
  ) {
    this.service.assertApiKey(apiKey);
    if (!dto?.postBarcode?.trim()) {
      throw new BadRequestException('postBarcode fehlt');
    }
    return this.service.registerTracking({
      postBarcode: dto.postBarcode,
      shipmentNumber: dto.shipmentNumber,
      orderNumber: dto.orderNumber,
      itemNumber: dto.itemNumber,
      trackingNumber: dto.trackingNumber,
      clientReference: dto.clientReference,
    });
  }
}
