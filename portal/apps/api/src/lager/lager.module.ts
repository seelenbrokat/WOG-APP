import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { LagerController } from './lager.controller';
import { LademittelscheinService } from './lademittelschein.service';

@Module({
  imports: [AuditModule, NotificationsModule, IntegrationsModule],
  controllers: [LagerController],
  providers: [LademittelscheinService],
  exports: [LademittelscheinService],
})
export class LagerModule {}
