import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Public } from '../auth/public.decorator';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { FahrerAuthGuard } from './fahrer-auth.guard';
import { CurrentDriver } from './fahrer.types';
import type { DriverAuthUser } from './fahrer.types';
import { FahrerAuthService } from './fahrer-auth.service';
import { FahrerToursService } from './fahrer-tours.service';
import { FahrerTelematicsService } from './fahrer-telematics.service';
import { FahrerChatService } from './fahrer-chat.service';
import { FahrerSmartborderService } from './fahrer-smartborder.service';
import { PinLoginDto, QrLoginDto, RefreshDto } from './dto/auth.dto';
import {
  DocumentDto,
  SsccStatusDto,
  TourStatusDto,
  TourStopStatusDto,
  TransportOrderStatusDto,
  VehicleLocationDto,
  TourEtaDto,
} from './dto/telematics.dto';
import { SendChatDto } from './dto/chat.dto';

@Controller('fahrer')
export class FahrerController {
  constructor(
    private auth: FahrerAuthService,
    private tours: FahrerToursService,
    private telematics: FahrerTelematicsService,
    private chat: FahrerChatService,
    private smartborder: FahrerSmartborderService,
  ) {}

  // ── Public Auth ──────────────────────────────────────────────

  @Public()
  @Get('vehicles')
  listVehicles(@Query('tenant') tenant?: string) {
    return this.auth.listPublicVehicles(tenant);
  }

  @Public()
  @Post('auth/pin')
  loginPin(@Body() dto: PinLoginDto) {
    return this.auth.loginWithPin(dto);
  }

  @Public()
  @Post('auth/qr')
  loginQr(@Body() dto: QrLoginDto) {
    return this.auth.loginWithQr(dto);
  }

  @Public()
  @Post('auth/refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  // ── Dispo: QR erzeugen ───────────────────────────────────────

  @Post('auth/qr-create')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  createQr(
    @CurrentUser() user: AuthUser,
    @Body() body: { vehicleId: string; driverId?: string; ttlHours?: number },
  ) {
    return this.auth.createQrToken(user.organizationId, {
      vehicleId: body.vehicleId,
      driverId: body.driverId,
      createdByUserId: user.id,
      ttlHours: body.ttlHours,
    });
  }

  // ── Fahrer session ───────────────────────────────────────────

  @Get('me')
  @UseGuards(FahrerAuthGuard)
  me(@CurrentDriver() driver: DriverAuthUser) {
    return driver;
  }

  @Get('tours')
  @UseGuards(FahrerAuthGuard)
  listTours(@CurrentDriver() driver: DriverAuthUser) {
    return this.tours.listTours(driver);
  }

  @Get('tours/:tourNumber')
  @UseGuards(FahrerAuthGuard)
  getTour(
    @CurrentDriver() driver: DriverAuthUser,
    @Param('tourNumber') tourNumber: string,
  ) {
    return this.tours.getTour(driver, tourNumber);
  }

  // ── Telematics Outbound ──────────────────────────────────────

  @Post('telematics/tour-status')
  @UseGuards(FahrerAuthGuard)
  tourStatus(@CurrentDriver() driver: DriverAuthUser, @Body() dto: TourStatusDto) {
    return this.telematics.sendTourStatus(driver, dto);
  }

  @Post('telematics/tour-stop-status')
  @UseGuards(FahrerAuthGuard)
  tourStopStatus(
    @CurrentDriver() driver: DriverAuthUser,
    @Body() dto: TourStopStatusDto,
  ) {
    return this.telematics.sendTourStopStatus(driver, dto);
  }

  @Post('telematics/transport-order-status')
  @UseGuards(FahrerAuthGuard)
  toStatus(
    @CurrentDriver() driver: DriverAuthUser,
    @Body() dto: TransportOrderStatusDto,
  ) {
    return this.telematics.sendTransportOrderStatus(driver, dto);
  }

  @Post('telematics/document')
  @UseGuards(FahrerAuthGuard)
  document(@CurrentDriver() driver: DriverAuthUser, @Body() dto: DocumentDto) {
    return this.telematics.sendDocument(driver, dto);
  }

  @Post('telematics/sscc-status')
  @UseGuards(FahrerAuthGuard)
  sscc(@CurrentDriver() driver: DriverAuthUser, @Body() dto: SsccStatusDto) {
    return this.telematics.sendSsccStatus(driver, dto);
  }

  @Post('telematics/location')
  @UseGuards(FahrerAuthGuard)
  location(@CurrentDriver() driver: DriverAuthUser, @Body() dto: VehicleLocationDto) {
    return this.telematics.sendLocation(driver, dto);
  }

  /** Live-ETA → Portal (Dispo + Endkunde); zusätzlich weiter Chat/Location möglich */
  @Post('telematics/eta')
  @UseGuards(FahrerAuthGuard)
  eta(@CurrentDriver() driver: DriverAuthUser, @Body() dto: TourEtaDto) {
    return this.telematics.sendEta(driver, dto);
  }

  // ── Chat (Soloplan Relay) ────────────────────────────────────

  @Get('chat')
  @UseGuards(FahrerAuthGuard)
  listChat(
    @CurrentDriver() driver: DriverAuthUser,
    @Query('since') since?: string,
  ) {
    return this.chat.list(driver, since);
  }

  @Post('chat')
  @UseGuards(FahrerAuthGuard)
  sendChat(@CurrentDriver() driver: DriverAuthUser, @Body() dto: SendChatDto) {
    return this.chat.send(driver, dto);
  }

  // ── SmartBorder (Verzollung per Zugfahrzeug-Kennzeichen) ─────

  @Get('smartborder/status')
  @UseGuards(FahrerAuthGuard)
  smartborderStatus(@CurrentDriver() driver: DriverAuthUser) {
    return this.smartborder.statusForDriver(driver);
  }
}
