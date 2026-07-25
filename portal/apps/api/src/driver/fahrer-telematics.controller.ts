import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { FahrerTelematicsService } from './fahrer-telematics.service';
import {
  OutDocument,
  OutSsccStatus,
  OutTourStatus,
  OutTourStopStatus,
  OutTransportOrderStatus,
} from '../integrations/telematics-xml.builder';

/**
 * API für die VLB-Zustellapp (Telematikkonfiguration VLBPortal).
 * Schreibt StdTelematics-XML in den SFTP-Outbound für Soloplan.
 */
@Controller('fahrer/telematics')
@UseGuards(RolesGuard)
@Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.PARTNER)
export class FahrerTelematicsController {
  constructor(private telematics: FahrerTelematicsService) {}

  @Get('status')
  status() {
    return this.telematics.status();
  }

  @Get('outbound')
  outbound() {
    return this.telematics.listOutbound();
  }

  @Post('tour-status')
  tourStatus(@CurrentUser() user: AuthUser, @Body() body: OutTourStatus) {
    return this.telematics.submitTourStatus(user, body);
  }

  @Post('tour-stop-status')
  tourStopStatus(@CurrentUser() user: AuthUser, @Body() body: OutTourStopStatus) {
    return this.telematics.submitTourStopStatus(user, body);
  }

  @Post('transport-order-status')
  transportOrderStatus(
    @CurrentUser() user: AuthUser,
    @Body() body: OutTransportOrderStatus,
  ) {
    return this.telematics.submitTransportOrderStatus(user, body);
  }

  @Post('document')
  document(
    @CurrentUser() user: AuthUser,
    @Body() body: OutDocument & { signedByName?: string; signedAt?: string },
  ) {
    return this.telematics.submitDocument(user, body);
  }

  @Post('sscc-status')
  ssccStatus(@CurrentUser() user: AuthUser, @Body() body: OutSsccStatus) {
    return this.telematics.submitSsccStatus(user, body);
  }

  /** Manuell: inbound/vlbportal/telematics → outbound + Buchung */
  @Post('process-inbound')
  processInbound(@CurrentUser() user: AuthUser) {
    return this.telematics.processAppInboundDir(user.organizationId);
  }
}
