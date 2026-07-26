import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { MandantenModule } from './mandanten/mandanten.module';
import { CustomersModule } from './customers/customers.module';
import { ShipmentsModule } from './shipments/shipments.module';
import { DocumentsModule } from './documents/documents.module';
import { NotificationsModule } from './notifications/notifications.module';
import { TrackingModule } from './tracking/tracking.module';
import { PartnersModule } from './partners/partners.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { UsersModule } from './users/users.module';
import { AuditModule } from './audit/audit.module';
import { CustomsModule } from './customs/customs.module';
import { LabelsModule } from './labels/labels.module';
import { OrdersModule } from './orders/orders.module';
import { ToursModule } from './tours/tours.module';
import { DriverModule } from './driver/driver.module';
import { FahrerModule } from './fahrer/fahrer.module';
import { LagerModule } from './lager/lager.module';
import { HealthController } from './health.controller';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { PasswordChangeGuard } from './auth/password-change.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    OrganizationsModule,
    MandantenModule,
    CustomersModule,
    UsersModule,
    ShipmentsModule,
    OrdersModule,
    ToursModule,
    DriverModule,
    FahrerModule,
    LabelsModule,
    DocumentsModule,
    NotificationsModule,
    TrackingModule,
    PartnersModule,
    IntegrationsModule,
    AuditModule,
    CustomsModule,
    LagerModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PasswordChangeGuard },
  ],
})
export class AppModule {}
