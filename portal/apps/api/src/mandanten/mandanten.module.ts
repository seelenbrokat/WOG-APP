import { Module } from '@nestjs/common';
import { MandantenService } from './mandanten.service';
import { MandantenController } from './mandanten.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [MandantenController],
  providers: [MandantenService],
  exports: [MandantenService],
})
export class MandantenModule {}
