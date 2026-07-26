import { Module, forwardRef } from '@nestjs/common';
import { DriverController } from './driver.controller';
import { DriverService } from './driver.service';
import { FahrerTelematicsController } from './fahrer-telematics.controller';
import { FahrerTelematicsService } from './fahrer-telematics.service';
import { IntegrationsModule } from '../integrations/integrations.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [forwardRef(() => IntegrationsModule), forwardRef(() => DocumentsModule)],
  controllers: [DriverController, FahrerTelematicsController],
  providers: [DriverService, FahrerTelematicsService],
  exports: [DriverService, FahrerTelematicsService],
})
export class DriverModule {}
