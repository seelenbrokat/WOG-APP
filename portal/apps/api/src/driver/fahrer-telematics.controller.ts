import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { FahrerTelematicsService } from './fahrer-telematics.service';

/**
 * Dispo-/Admin-Hilfen für Telematik-Outbound.
 * App-Statusmeldungen laufen über `/fahrer/telematics/*` (FahrerModule, PIN/QR-Auth).
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

  /** Manuell: inbound/vlbportal/telematics → outbound + Buchung */
  @Post('process-inbound')
  processInbound(@CurrentUser() user: AuthUser) {
    return this.telematics.processAppInboundDir(user.organizationId);
  }
}
