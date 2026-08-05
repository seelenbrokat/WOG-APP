import { Module, forwardRef } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { CustomerDocumentsService } from './customer-documents.service';
import { CustomerDocumentsInboundService } from './customer-documents-inbound.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [
    forwardRef(() => NotificationsModule),
    AuditModule,
    forwardRef(() => IntegrationsModule),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, CustomerDocumentsService, CustomerDocumentsInboundService],
  exports: [DocumentsService, CustomerDocumentsService, CustomerDocumentsInboundService],
})
export class DocumentsModule {}
