import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PartnerImportService, SoloplanService } from './integrations/soloplan.service';
import { ExchangeHubService } from './integrations/exchange-hub.service';
import { BusinessPartnerService } from './integrations/business-partner.service';
import { MasterDataService } from './integrations/master-data.service';
import { TourService } from './integrations/tour.service';
import { TelematicsService } from './integrations/telematics.service';
import { IntouchService } from './integrations/intouch.service';
import { WareneingangService } from './integrations/wareneingang.service';
import { GoodsReceiptService } from './shipments/goods-receipt.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const partnerImport = app.get(PartnerImportService);
  const soloplan = app.get(SoloplanService);
  const hub = app.get(ExchangeHubService);
  const businessPartners = app.get(BusinessPartnerService);
  const masterData = app.get(MasterDataService);
  const tours = app.get(TourService);
  const telematics = app.get(TelematicsService);
  const intouch = app.get(IntouchService);
  const wareneingang = app.get(WareneingangService);
  const goodsReceipt = app.get(GoodsReceiptService);

  console.log(
    'WOG Integration Worker started (Partner + Soloplan BP/Master/Tours/Telematics/Wareneingang/Intouch + EZOLL Hub + ETB-Retention)',
  );

  let lastEtbPurgeAt = 0;

  const tick = async () => {
    try {
      await partnerImport.processInbound();
      await businessPartners.processInboundDir();
      await masterData.processInboundDir();
      // Intouch-Ordner werden von Tour/Telematics/Wareneingang mitgelesen; Intouch katalogisiert danach
      await tours.processInboundDir();
      await telematics.processInboundDir(undefined, 250);
      await wareneingang.processInboundDir(undefined, 50);
      await intouch.processInboundDir(undefined, 200);
      await soloplan.syncPending();
      const archived = soloplan.archiveDownloadedOrders();
      if (archived.archived > 0) {
        console.log(`Soloplan: ${archived.archived} Order-Datei(en) nach Download archiviert`);
      }
      await hub.processInboundQueues();

      // ETB-Retention max. 1× / Stunde
      if (Date.now() - lastEtbPurgeAt > 60 * 60 * 1000) {
        lastEtbPurgeAt = Date.now();
        const purged = await goodsReceipt.purgeExpiredEntladeberichte(30);
        if (purged.deleted) {
          console.log(`ETB-Retention: ${purged.deleted} Entladebericht(e) entfernt`);
        }
      }
    } catch (err) {
      console.error('Worker tick failed', err);
    }
  };

  await tick();
  // Einmalig: vor Parser-Existenz archivierte WareneingangXML nachziehen
  try {
    const backfill = await wareneingang.reimportFromProcessed(undefined, 30);
    if (backfill.processed || backfill.failed) {
      console.log(
        `Wareneingang Reimport: ${backfill.processed} importiert, ${backfill.failed} fehlgeschlagen`,
      );
    }
  } catch (err) {
    console.error('Wareneingang Reimport failed', err);
  }
  // Einmalig: zuvor als „sonstige“ archivierte SsccStatus/Receipt/DriverActivities
  try {
    const telematicsBackfill = await telematics.reimportUnrecognizedFromProcessed(undefined, 500);
    if (telematicsBackfill.processed || telematicsBackfill.failed) {
      console.log(
        `Telematics Reimport: ${telematicsBackfill.processed} nachgezogen, ${telematicsBackfill.failed} fehlgeschlagen`,
      );
    }
  } catch (err) {
    console.error('Telematics Reimport failed', err);
  }
  // Einmalig: Receipts mit Soloplan-TourId an Tour.tourNumber koppeln
  try {
    const relink = await telematics.relinkOrphanTourRefs(undefined, 3000);
    if (relink.linked) {
      console.log(
        `Telematics Relink: ${relink.linked} Events, ${relink.toursUpdated} Touren aktualisiert`,
      );
    }
  } catch (err) {
    console.error('Telematics Relink failed', err);
  }
  setInterval(tick, 30_000);
}

bootstrap();
