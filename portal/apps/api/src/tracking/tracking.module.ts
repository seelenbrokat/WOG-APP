import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { TrackingService } from './tracking.service';
import { TrackingController } from './tracking.controller';

@Module({
  imports: [IntegrationsModule],
  controllers: [TrackingController],
  providers: [TrackingService],
})
export class TrackingModule {}
