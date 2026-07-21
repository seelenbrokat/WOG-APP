import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PartnerImportService, SoloplanService } from './integrations/soloplan.service';
import { ExchangeHubService } from './integrations/exchange-hub.service';
import { BusinessPartnerService } from './integrations/business-partner.service';
import { MasterDataService } from './integrations/master-data.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const partnerImport = app.get(PartnerImportService);
  const soloplan = app.get(SoloplanService);
  const hub = app.get(ExchangeHubService);
  const businessPartners = app.get(BusinessPartnerService);
  const masterData = app.get(MasterDataService);

  console.log('WOG Integration Worker started (Partner + Soloplan BP/Master + EZOLL Hub)');

  const tick = async () => {
    try {
      await partnerImport.processInbound();
      await businessPartners.processInboundDir();
      await masterData.processInboundDir();
      await soloplan.syncPending();
      const archived = soloplan.archiveDownloadedOrders();
      if (archived.archived > 0) {
        console.log(`Soloplan: ${archived.archived} Order-Datei(en) nach Download archiviert`);
      }
      await hub.processInboundQueues();
    } catch (err) {
      console.error('Worker tick failed', err);
    }
  };

  await tick();
  setInterval(tick, 30_000);
}

bootstrap();
