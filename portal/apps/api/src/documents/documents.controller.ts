import {
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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { DocumentsService } from './documents.service';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { DocumentType, UserRole } from '@prisma/client';

@Controller('documents')
@UseGuards(RolesGuard)
export class DocumentsController {
  constructor(private service: DocumentsService) {}

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

  @Get(':id/download')
  async download(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const { doc, stream } = await this.service.openStream(user, id);
    const safeName = String(doc.fileName || 'document').replace(/["\r\n]/g, '');
    res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
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
