import { Module, forwardRef } from '@nestjs/common';
import { ShipmentsService } from './shipments.service';
import { ShipmentsController } from './shipments.controller';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { LabelsModule } from '../labels/labels.module';
import { AddressValidationService } from '../common/address-validation.service';

@Module({
  imports: [
    AuditModule,
    LabelsModule,
    forwardRef(() => NotificationsModule),
    forwardRef(() => IntegrationsModule),
  ],
  controllers: [ShipmentsController],
  providers: [ShipmentsService, AddressValidationService],
  exports: [ShipmentsService, AddressValidationService],
})
export class ShipmentsModule {}
