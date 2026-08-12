import { Module, forwardRef } from '@nestjs/common';
import { CustomsService } from './customs.service';
import { CustomsController } from './customs.controller';
import { EzollInboundService } from './ezoll-inbound.service';
import { EzollSoloplanService } from './ezoll-soloplan.service';
import { EzollTourCacheService } from './ezoll-tour-cache.service';
import { EzollConsignmentCacheService } from './ezoll-consignment-cache.service';
import { EzollFreightPayerService } from './ezoll-freight-payer.service';
import { EzollSoloplanReadApiService } from './ezoll-soloplan-read-api.service';
import { EzollSmartborderService } from './ezoll-smartborder.service';
import { ShipmentCustomsRefService } from './shipment-customs-ref.service';
import { MercurioInboundService } from './mercurio-inbound.service';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [
    AuditModule,
    OrganizationsModule,
    DocumentsModule,
    forwardRef(() => NotificationsModule),
    forwardRef(() => IntegrationsModule),
  ],
  controllers: [CustomsController],
  providers: [
    CustomsService,
    EzollInboundService,
    EzollSoloplanService,
    EzollSoloplanReadApiService,
    EzollSmartborderService,
    EzollTourCacheService,
    EzollConsignmentCacheService,
    EzollFreightPayerService,
    ShipmentCustomsRefService,
    MercurioInboundService,
  ],
  exports: [
    CustomsService,
    EzollInboundService,
    EzollSoloplanService,
    EzollSoloplanReadApiService,
    EzollSmartborderService,
    EzollTourCacheService,
    EzollConsignmentCacheService,
    EzollFreightPayerService,
    ShipmentCustomsRefService,
    MercurioInboundService,
  ],
})
export class CustomsModule {}

