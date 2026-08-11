import { Module, forwardRef } from '@nestjs/common';
import { SoloplanService, PartnerImportService } from './soloplan.service';
import { IntegrationsController } from './integrations.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { ExchangeHubService } from './exchange-hub.service';
import { LdvAdapter, MercurioAdapter, SoloplanCustomsAdapter } from './customs-adapters';
import { BusinessPartnerService } from './business-partner.service';
import { MasterDataService } from './master-data.service';
import { TourService } from './tour.service';
import { TourEtaService } from './tour-eta.service';
import { TelematicsService } from './telematics.service';
import { TelematicsOutboundService } from './telematics-outbound.service';
import { IntouchService } from './intouch.service';
import { ShippingNetService } from './shippingnet.service';
import { LoadingUnitService } from './loading-unit.service';
import { WareneingangService } from './wareneingang.service';
import { MtrackService } from './mtrack.service';
import { PartnerOrdersInboundService } from './partner-orders-inbound.service';
import { PartnerOrdersSftpService } from './partner-orders-sftp.service';

@Module({
  imports: [
    forwardRef(() => NotificationsModule),
    AuditModule,
    forwardRef(() => UsersModule),
  ],
  controllers: [IntegrationsController],
  providers: [
    SoloplanService,
    PartnerImportService,
    ExchangeHubService,
    BusinessPartnerService,
    MasterDataService,
    TourService,
    TourEtaService,
    LoadingUnitService,
    MtrackService,
    TelematicsService,
    TelematicsOutboundService,
    IntouchService,
    WareneingangService,
    ShippingNetService,
    PartnerOrdersInboundService,
    PartnerOrdersSftpService,
    LdvAdapter,
    MercurioAdapter,
    SoloplanCustomsAdapter,
  ],
  exports: [
    SoloplanService,
    PartnerImportService,
    ExchangeHubService,
    BusinessPartnerService,
    MasterDataService,
    TourService,
    TourEtaService,
    LoadingUnitService,
    MtrackService,
    TelematicsService,
    TelematicsOutboundService,
    IntouchService,
    WareneingangService,
    ShippingNetService,
    PartnerOrdersInboundService,
    PartnerOrdersSftpService,
  ],
})
export class IntegrationsModule {}
