import { Module, forwardRef } from '@nestjs/common';
import { CustomsService } from './customs.service';
import { CustomsController } from './customs.controller';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [AuditModule, forwardRef(() => NotificationsModule), forwardRef(() => IntegrationsModule)],
  controllers: [CustomsController],
  providers: [CustomsService],
  exports: [CustomsService],
})
export class CustomsModule {}
