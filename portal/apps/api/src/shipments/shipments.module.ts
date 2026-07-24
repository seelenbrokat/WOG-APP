import { Module, forwardRef } from '@nestjs/common';
import { ShipmentsService } from './shipments.service';
import { ShipmentsController } from './shipments.controller';
import { GoodsReceiptService } from './goods-receipt.service';
import { GoodsReceiptController } from './goods-receipt.controller';
import { ProformaWeService } from './proforma-we.service';
import { SchmidtsLadelisteWeService } from './schmidts-ladeliste-we.service';
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
  controllers: [ShipmentsController, GoodsReceiptController],
  providers: [
    ShipmentsService,
    AddressValidationService,
    GoodsReceiptService,
    ProformaWeService,
    SchmidtsLadelisteWeService,
  ],
  exports: [
    ShipmentsService,
    AddressValidationService,
    GoodsReceiptService,
    ProformaWeService,
    SchmidtsLadelisteWeService,
  ],
})
export class ShipmentsModule {}
