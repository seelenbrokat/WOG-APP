import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { ToursController } from './tours.controller';

@Module({
  imports: [IntegrationsModule],
  controllers: [ToursController],
})
export class ToursModule {}
