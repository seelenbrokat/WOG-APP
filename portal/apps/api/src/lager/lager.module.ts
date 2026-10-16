import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { LagerController } from './lager.controller';
import { WarehouseController } from './warehouse.controller';
import { LademittelscheinService } from './lademittelschein.service';
import { WarehouseStorageService } from './warehouse-storage.service';

@Module({
  imports: [AuditModule, NotificationsModule, IntegrationsModule],
  controllers: [LagerController, WarehouseController],
  providers: [LademittelscheinService, WarehouseStorageService],
  exports: [LademittelscheinService, WarehouseStorageService],
})
export class LagerModule {}
