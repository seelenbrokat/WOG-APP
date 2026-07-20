import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { LabelsService } from './labels.service';

@Controller('shipments/:shipmentId')
@UseGuards(RolesGuard)
export class LabelsController {
  constructor(private labels: LabelsService) {}

  @Get('colli')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  listColli(@CurrentUser() user: AuthUser, @Param('shipmentId') shipmentId: string) {
    return this.labels.listColli(user, shipmentId);
  }

  @Get('labels')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  listLabels(@CurrentUser() user: AuthUser, @Param('shipmentId') shipmentId: string) {
    return this.labels.listLabels(user, shipmentId);
  }

  /**
   * Colli/SSCC sicherstellen und Transportetiketten (PDF) erzeugen.
   * Portal-eigene Labelgenerierung – Ablöse von shipping.NET generateLabel.
   */
  @Post('labels')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  generateLabels(@CurrentUser() user: AuthUser, @Param('shipmentId') shipmentId: string) {
    return this.labels.generateLabels(user, shipmentId);
  }
}
