import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { UserRole } from '@prisma/client';
import { IsBooleanString, IsDateString, IsOptional, IsString, MinLength } from 'class-validator';
import { CustomsService } from './customs.service';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';

class CreateCustomsDto {
  @IsString()
  @MinLength(2)
  kennzeichen!: string;

  @IsString()
  @MinLength(2)
  zulassungsland!: string;

  @IsOptional()
  @IsString()
  kennzeichenAnhaenger?: string;

  @IsOptional()
  @IsString()
  zulassungslandAnhaenger?: string;

  @IsString()
  @MinLength(2)
  grenzuebergang!: string;

  @IsOptional()
  @IsString()
  grenzzollstelle?: string;

  @IsDateString()
  zeit!: string;

  @IsString()
  @MinLength(2)
  importeur!: string;

  @IsString()
  @MinLength(2)
  frankatur!: string;

  @IsOptional()
  @IsString()
  mandantId?: string;

  /** Für Admin/Disposition: Auftrag für diesen Kunden anlegen */
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBooleanString()
  abweichenderFrachtzahler?: string;

  @IsOptional()
  @IsString()
  frachtzahlerFirma?: string;

  @IsOptional()
  @IsString()
  frachtzahlerStreet?: string;

  @IsOptional()
  @IsString()
  frachtzahlerZip?: string;

  @IsOptional()
  @IsString()
  frachtzahlerCity?: string;

  @IsOptional()
  @IsString()
  frachtzahlerCountry?: string;

  @IsString()
  @MinLength(1)
  absenderFirma!: string;

  @IsString()
  @MinLength(1)
  absenderStreet!: string;

  @IsString()
  @MinLength(1)
  absenderZip!: string;

  @IsString()
  @MinLength(1)
  absenderCity!: string;

  @IsOptional()
  @IsString()
  absenderCountry?: string;

  @IsString()
  @MinLength(1)
  empfaengerFirma!: string;

  @IsString()
  @MinLength(1)
  empfaengerStreet!: string;

  @IsString()
  @MinLength(1)
  empfaengerZip!: string;

  @IsString()
  @MinLength(1)
  empfaengerCity!: string;

  @IsOptional()
  @IsString()
  empfaengerCountry?: string;
}

class StatusDto {
  @IsString()
  status!: string;
}

const papersUpload = FilesInterceptor('papers', 20, {
  storage: memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

@Controller('customs')
@UseGuards(RolesGuard)
export class CustomsController {
  constructor(private service: CustomsService) {}

  @Get()
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user);
  }

  @Get('documents/:documentId/download')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  async download(
    @CurrentUser() user: AuthUser,
    @Param('documentId') documentId: string,
    @Res() res: Response,
  ) {
    const { doc, stream } = await this.service.openDocument(user, documentId);
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${doc.fileName}"`);
    stream.pipe(res);
  }

  @Post()
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  @UseInterceptors(papersUpload)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCustomsDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.service.create(user, dto, files || []);
  }

  @Post(':id/papers')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  @UseInterceptors(papersUpload)
  uploadPapers(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files?.length) throw new BadRequestException('Keine Dateien übermittelt');
    return this.service.uploadPapers(user, id, files);
  }

  @Get(':id')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user, id);
  }

  /** Soloplan erneut exportieren + PDF/E-Mail an info@worldofgreen.ch */
  @Post(':id/submit')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user, id).then(() => this.service.finalizeSubmission(id));
  }

  @Patch(':id/status')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  status(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: StatusDto) {
    return this.service.updateStatus(user, id, dto.status);
  }
}
