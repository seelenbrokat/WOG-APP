import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { DocumentsService } from './documents.service';
import { CustomerDocumentsService } from './customer-documents.service';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { CustomerDocCategory, DocumentType, UserRole } from '@prisma/client';
import { Public } from '../auth/public.decorator';

class CategoryAccessDto {
  @IsEnum(CustomerDocCategory)
  code!: CustomerDocCategory;

  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsBoolean()
  required?: boolean;
}

class SetDocumentsModuleDto {
  @IsBoolean()
  documentsModuleEnabled!: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CategoryAccessDto)
  categories?: CategoryAccessDto[];
}

@Controller('documents')
@UseGuards(RolesGuard)
export class DocumentsController {
  constructor(
    private service: DocumentsService,
    private customerDocs: CustomerDocumentsService,
  ) {}

  @Get('module/categories')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  listCategories() {
    return this.customerDocs.listAvailableCategories();
  }

  @Get('module/me')
  @Roles(UserRole.CUSTOMER_USER)
  myModule(@CurrentUser() user: AuthUser) {
    return this.customerDocs.myModuleConfig(user);
  }

  @Get('module/customer/:customerId')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  getCustomerModule(@CurrentUser() user: AuthUser, @Param('customerId') customerId: string) {
    return this.customerDocs.getModuleConfig(user, customerId);
  }

  @Post('module/customer/:customerId')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  setCustomerModule(
    @CurrentUser() user: AuthUser,
    @Param('customerId') customerId: string,
    @Body() dto: SetDocumentsModuleDto,
  ) {
    return this.customerDocs.setModuleConfig(user, customerId, dto);
  }

  @Get('module/shipment/:shipmentId')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  listModuleDocs(@CurrentUser() user: AuthUser, @Param('shipmentId') shipmentId: string) {
    return this.customerDocs.listForShipmentWithDownloads(user, shipmentId);
  }

  @Post('upload')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER, UserRole.PARTNER)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }))
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Query('shipmentId') shipmentId?: string,
    @Query('type') type?: DocumentType,
  ) {
    if (!file) throw new BadRequestException('Datei fehlt');
    return this.service.saveUpload(user, file, { shipmentId, type });
  }

  @Get('shipment/:shipmentId')
  list(@CurrentUser() user: AuthUser, @Param('shipmentId') shipmentId: string) {
    return this.service.listForShipment(user, shipmentId);
  }

  @Post('ablieferbeleg/:shipmentId')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  ablieferbeleg(@CurrentUser() user: AuthUser, @Param('shipmentId') shipmentId: string) {
    return this.service.generateAblieferbeleg(user, shipmentId);
  }

  /**
   * Signierter Download ohne Login (ETB-Mail-Link).
   * Token `t` ist 30 Tage gültig (Retention).
   */
  @Public()
  @Get(':id/shared')
  async sharedDownload(
    @Param('id') id: string,
    @Query('t') token: string | undefined,
    @Res() res: Response,
  ) {
    if (!token?.trim()) {
      throw new UnauthorizedException('Download-Link ungültig oder abgelaufen');
    }
    const { doc, stream } = await this.service.openStreamBySignedToken(id, token);
    this.pipeDownload(res, doc, stream);
  }

  @Get(':id/download')
  async download(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const { doc, stream } = await this.service.openStream(user, id);
    this.pipeDownload(res, doc, stream);
  }

  private pipeDownload(
    res: Response,
    doc: { fileName: string; mimeType: string | null; sizeBytes: number | null },
    stream: NodeJS.ReadableStream,
  ) {
    const safeName = String(doc.fileName || 'document').replace(/["\r\n]/g, '');
    res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    if (doc.sizeBytes && doc.sizeBytes > 0) {
      res.setHeader('Content-Length', String(doc.sizeBytes));
    }
    stream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(404).json({ message: 'Datei nicht lesbar', statusCode: 404 });
      } else {
        res.destroy(err);
      }
    });
    stream.pipe(res);
  }
}
