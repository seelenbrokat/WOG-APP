import { Module } from '@nestjs/common';
import { DamagesService } from './damages.service';
import { DamagesController } from './damages.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [DamagesController],
  providers: [DamagesService],
  exports: [DamagesService],
})
export class DamagesModule {}
