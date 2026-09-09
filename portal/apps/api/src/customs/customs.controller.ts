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
import { FileFieldsInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { UserRole } from '@prisma/client';
import { IsBooleanString, IsDateString, IsOptional, IsString, MinLength } from 'class-validator';
import { CustomsService } from './customs.service';
import { EzollInboundService } from './ezoll-inbound.service';
import { MercurioInboundService } from './mercurio-inbound.service';
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

  @IsOptional()
  @IsString()
  zazKonto?: string;

  @IsOptional()
  @IsString()
  warenort?: string;

  /** Collianzahl (FormData-String) */
  @IsOptional()
  @IsString()
  packageCount?: string;

  /** Bruttogewicht kg (FormData-String, Dezimal mit . oder ,) */
  @IsOptional()
  @IsString()
  weightKg?: string;

  /** Nettogewicht kg (FormData-String, Dezimal mit . oder ,) */
  @IsOptional()
  @IsString()
  netWeightKg?: string;

  /** Wareninhalt / Inhaltsbeschreibung */
  @IsOptional()
  @IsString()
  goodsDescription?: string;

  @IsOptional()
  @IsString()
  frankatur?: string;

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

  /** Fahrer-Telefon für SmartBorder-App (E.164 / AT-Mobil) */
  @IsOptional()
  @IsString()
  driverPhone?: string;

  /** Zusätzliche E-Mail für den SmartBorder-Link */
  @IsOptional()
  @IsString()
  smartborderNotifyEmail?: string;

  /** Link per SMS an Fahrernummer (LinkMobility email2sms) */
  @IsOptional()
  @IsBooleanString()
  smartborderSendSms?: string;

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

const createUpload = FileFieldsInterceptor(
  [
    { name: 'invoice', maxCount: 10 },
    { name: 'papers', maxCount: 20 },
  ],
  {
    storage: memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
  },
);

@Controller('customs')
@UseGuards(RolesGuard)
export class CustomsController {
  constructor(
    private service: CustomsService,
    private ezollInbound: EzollInboundService,
    private mercurioInbound: MercurioInboundService,
  ) {}

  @Get()
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user);
  }

  /** eZoll-Drop: Ignore-Präfixe anwenden (Admin). */
  @Post('ezoll/process-inbound')
  @Roles(UserRole.ORG_ADMIN)
  processEzollInbound(@CurrentUser() user: AuthUser) {
    return this.ezollInbound.processInboundDir(user.organizationId);
  }

  /** Mercurio CH e-dec PDFs (Bezugsschein / Einfuhrliste) matchen. */
  @Post('mercurio/process-inbound')
  @Roles(UserRole.ORG_ADMIN)
  processMercurioInbound(@CurrentUser() user: AuthUser) {
    return this.mercurioInbound.processInboundDir(user.organizationId);
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
  @UseInterceptors(createUpload)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCustomsDto,
    @UploadedFiles()
    files: { invoice?: Express.Multer.File[]; papers?: Express.Multer.File[] },
  ) {
    return this.service.create(user, dto, files || {});
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

  /** Soloplan erneut exportieren + PDF/E-Mail an zoll@worldofgreen.at */
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

  /** Sendungsnachfrage an Disposition (Status/Zustellung). */
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
