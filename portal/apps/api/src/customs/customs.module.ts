import { Module, forwardRef } from '@nestjs/common';
import { CustomsService } from './customs.service';
import { CustomsController } from './customs.controller';
import { EzollInboundService } from './ezoll-inbound.service';
import { EzollSoloplanService } from './ezoll-soloplan.service';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  imports: [
    AuditModule,
    OrganizationsModule,
    forwardRef(() => NotificationsModule),
    forwardRef(() => IntegrationsModule),
  ],
  controllers: [CustomsController],
  providers: [CustomsService, EzollInboundService, EzollSoloplanService],
  exports: [CustomsService, EzollInboundService, EzollSoloplanService],
})
export class CustomsModule {}

