import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LagerController } from './lager.controller';
import { LademittelscheinService } from './lademittelschein.service';

@Module({
  imports: [AuditModule, NotificationsModule],
  controllers: [LagerController],
  providers: [LademittelscheinService],
  exports: [LademittelscheinService],
})
export class LagerModule {}
