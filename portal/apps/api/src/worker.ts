import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PartnerImportService, SoloplanService } from './integrations/soloplan.service';
import { ExchangeHubService } from './integrations/exchange-hub.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const partnerImport = app.get(PartnerImportService);
  const soloplan = app.get(SoloplanService);
  const hub = app.get(ExchangeHubService);

  console.log('WOG Integration Worker started (Partner + Soloplan + EZOLL Hub)');

  const tick = async () => {
    try {
      await partnerImport.processInbound();
      await soloplan.syncPending();
      await hub.processInboundQueues();
    } catch (err) {
      console.error('Worker tick failed', err);
    }
  };

  await tick();
  setInterval(tick, 30_000);
}

bootstrap();
