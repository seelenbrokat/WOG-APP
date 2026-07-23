import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { DriverService } from './driver.service';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';

@Controller('drivers')
@UseGuards(RolesGuard)
@Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
export class DriverController {
  constructor(private drivers: DriverService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.drivers.listDrivers(user);
  }

  @Get('vehicles')
  listVehicles(@CurrentUser() user: AuthUser) {
    return this.drivers.listVehicles(user);
  }

  @Get(':telematicsId')
  getOne(@CurrentUser() user: AuthUser, @Param('telematicsId') telematicsId: string) {
    return this.drivers.getDriverByTelematicsId(user, telematicsId);
  }

  /** Einmalig: Fahrzeug 103, Fahrer THNE und VLBPortal aus Telematik-Sample anlegen */
  @Post('bootstrap-telematics')
  bootstrap(@CurrentUser() user: AuthUser) {
    return this.drivers.bootstrapFromTelematicsSample(user.organizationId);
  }
}
