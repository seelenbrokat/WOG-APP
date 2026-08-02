import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { IntegrationsModule } from '../integrations/integrations.module';
import { DocumentsModule } from '../documents/documents.module';
import { FahrerController } from './fahrer.controller';
import { FahrerAuthService } from './fahrer-auth.service';
import { FahrerToursService } from './fahrer-tours.service';
import { FahrerTelematicsService } from './fahrer-telematics.service';
import { FahrerChatService } from './fahrer-chat.service';
import { FahrerSmartborderService } from './fahrer-smartborder.service';
import { FahrerAuthGuard } from './fahrer-auth.guard';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    forwardRef(() => IntegrationsModule),
    forwardRef(() => DocumentsModule),
    NotificationsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET') || 'dev-secret',
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN') || '7d' },
      }),
    }),
  ],
  controllers: [FahrerController],
  providers: [
    FahrerAuthService,
    FahrerToursService,
    FahrerTelematicsService,
    FahrerChatService,
    FahrerSmartborderService,
    FahrerAuthGuard,
  ],
  exports: [FahrerChatService, FahrerAuthService, FahrerSmartborderService],
})
export class FahrerModule {}
