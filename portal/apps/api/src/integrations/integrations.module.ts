import { Module, forwardRef } from '@nestjs/common';
import { SoloplanService, PartnerImportService } from './soloplan.service';
import { IntegrationsController } from './integrations.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';
import { ExchangeHubService } from './exchange-hub.service';
import { LdvAdapter, MercurioAdapter, SoloplanCustomsAdapter } from './customs-adapters';
import { BusinessPartnerService } from './business-partner.service';

@Module({
  imports: [forwardRef(() => NotificationsModule), AuditModule],
  controllers: [IntegrationsController],
  providers: [
    SoloplanService,
    PartnerImportService,
    ExchangeHubService,
    BusinessPartnerService,
    LdvAdapter,
    MercurioAdapter,
    SoloplanCustomsAdapter,
  ],
  exports: [SoloplanService, PartnerImportService, ExchangeHubService, BusinessPartnerService],
})
export class IntegrationsModule {}
