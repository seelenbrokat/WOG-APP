import { Module, forwardRef } from '@nestjs/common';
import { SoloplanService, PartnerImportService } from './soloplan.service';
import { IntegrationsController } from './integrations.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [forwardRef(() => NotificationsModule)],
  controllers: [IntegrationsController],
  providers: [SoloplanService, PartnerImportService],
  exports: [SoloplanService, PartnerImportService],
})
export class IntegrationsModule {}
