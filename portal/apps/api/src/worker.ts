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
import { ProformaWeService } from './shipments/proforma-we.service';
import { SchmidtsLadelisteWeService } from './shipments/schmidts-ladeliste-we.service';
import { FahrerTelematicsService } from './driver/fahrer-telematics.service';
import { RecurringTemplatesService } from './shipments/recurring-templates.service';
import { LademittelscheinService } from './lager/lademittelschein.service';
import { CustomerDocumentsInboundService } from './documents/customer-documents-inbound.service';
import { PartnerOrdersInboundService } from './integrations/partner-orders-inbound.service';
import { EzollInboundService } from './customs/ezoll-inbound.service';

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
  const proformaWe = app.get(ProformaWeService);
  const schmidtsLadeliste = app.get(SchmidtsLadelisteWeService);
  const fahrerTelematics = app.get(FahrerTelematicsService);
  const recurringTemplates = app.get(RecurringTemplatesService);
  const lademittelscheine = app.get(LademittelscheinService);
  const customerDocuments = app.get(CustomerDocumentsInboundService);
  const partnerOrders = app.get(PartnerOrdersInboundService);
  const ezollInbound = app.get(EzollInboundService);

  console.log(
    'WOG Integration Worker started (Partner + Soloplan BP/Master/Tours/Telematics/Wareneingang/Intouch + Kunden-Dokumente + Partner-Orders/BORD512 + eZoll-Ignore + EZOLL Hub + ETB-Retention)',
  );

  let lastEtbPurgeAt = 0;
  let ticking = false;

  const tick = async () => {
    // Überlappende Ticks stapeln sonst Worker+Postgres-CPU
    if (ticking) {
      console.warn('Worker tick übersprungen – vorheriger Lauf noch aktiv');
      return;
    }
    ticking = true;
    try {
      await partnerImport.processInbound();
      await businessPartners.processInboundDir();
      await masterData.processInboundDir();
      // Intouch-Ordner werden von Tour/Telematics/Wareneingang mitgelesen; Intouch katalogisiert danach
      await tours.processInboundDir();
      await telematics.processInboundDir(undefined, 80);
      // VLB-Zustellapp → Soloplan-FTP (outbound/soloplan/telematics) + Lademittel/Ablieferbeleg
      const vlb = await fahrerTelematics.processAppInboundDir();
      if (vlb.processed || vlb.failed) {
        console.log(
          `VLBPortal Telematics: ${vlb.processed} verarbeitet, ${vlb.failed} fehlgeschlagen`,
        );
      }
      await wareneingang.processInboundDir(undefined, 50);
      const proforma = await proformaWe.processInboundDir();
      if (proforma.processed || proforma.failed) {
        console.log(
          `Proforma-WE: ${proforma.processed} verarbeitet, ${proforma.failed} fehlgeschlagen`,
        );
      }
      const ladeliste = await schmidtsLadeliste.processInboundDir();
      if (ladeliste.processed || ladeliste.failed) {
        console.log(
          `Schmidts-Ladeliste: ${ladeliste.processed} verarbeitet, ${ladeliste.failed} fehlgeschlagen`,
        );
      }
      const lms = await lademittelscheine.processInboundDir();
      if (lms.processed || lms.failed) {
        console.log(
          `Lademittelschein: ${lms.processed} verarbeitet, ${lms.failed} fehlgeschlagen`,
        );
      }
      const custDocs = await customerDocuments.processInboundDir();
      if (custDocs.processed || custDocs.failed) {
        console.log(
          `Kunden-Dokumente: ${custDocs.processed} verarbeitet, ${custDocs.failed} fehlgeschlagen, ${custDocs.skipped} übersprungen`,
        );
      }
      const partnerOrd = await partnerOrders.processInboundDir();
      if (partnerOrd.processed || partnerOrd.failed) {
        console.log(
          `Partner-Orders: ${partnerOrd.processed} verarbeitet, ${partnerOrd.failed} fehlgeschlagen, ${partnerOrd.skipped} übersprungen` +
            (partnerOrd.files.length ? ` → ${partnerOrd.files.join(', ')}` : ''),
        );
      }
      const ezoll = await ezollInbound.processInboundDir();
      if (
        ezoll.ignored ||
        ezoll.smartborder ||
        ezoll.smartborderFailed ||
        ezoll.cc529 ||
        ezoll.ez92x ||
        ezoll.cc029 ||
        ezoll.cc599 ||
        ezoll.customerExit ||
        ezoll.unmatched ||
        ezoll.purged
      ) {
        console.log(
          `eZoll: ${ezoll.ignored} ignoriert` +
            (ezoll.smartborder || ezoll.smartborderFailed
              ? `, ${ezoll.smartborder || 0} SmartBorder` +
                (ezoll.smartborderFailed ? ` (${ezoll.smartborderFailed} fehl)` : '')
              : '') +
            `, ${ezoll.cc529} CC529, ${ezoll.ez92x || 0} EZ922/923, ${ezoll.cc029 || 0} CC029, ${ezoll.cc599 || 0} CC599→Soloplan` +
            (ezoll.customerExit ? `, ${ezoll.customerExit} Austritt→Kunde` : '') +
            `, ${ezoll.unmatched} unmatched, ${ezoll.pending} offen` +
            (ezoll.purged ? `, ${ezoll.purged} Cache gelöscht` : ''),
        );
      }
      await intouch.processInboundDir(undefined, 50);
      await soloplan.syncPending();
      const archived = soloplan.archiveDownloadedOrders();
      if (archived.archived > 0) {
        console.log(`Soloplan: ${archived.archived} Order-Datei(en) nach Download archiviert`);
        const flushed = await soloplan.flushDocumentsAfterPickup(archived.files);
        if (flushed.flushed.length) {
          console.log(
            `Soloplan: Dokumente nach Abholung nachgereicht für ${flushed.flushed.join(', ')}`,
          );
        }
      }
      // Verzollung: Docs erst ~3 Min nach Create-Abholung (Soloplan Import-Latenz)
      const customsDocs = await soloplan.flushPendingCustomsDocuments();
      if (customsDocs.flushed.length) {
        console.log(
          `Soloplan: Customs-Dokumente nachgereicht für ${customsDocs.flushed.join(', ')}`,
        );
      }
      await hub.processInboundQueues();

      const recurring = await recurringTemplates.runDueTemplates();
      if (recurring.created || recurring.failed) {
        console.log(
          `Wiederkehrende Aufträge: ${recurring.created} erstellt, ${recurring.failed} fehlgeschlagen`,
        );
      }

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
    } finally {
      ticking = false;
    }
  };

  await tick();

  // Schwere Einmal-Backfills nur auf Anforderung (sonst nach jedem Deploy hohe CPU)
  if (process.env.WORKER_STARTUP_BACKFILL === '1') {
    try {
      const backfill = await wareneingang.reimportFromProcessed(undefined, 40);
      if (backfill.processed || backfill.failed || backfill.linked) {
        console.log(
          `Wareneingang Reimport: ${backfill.processed} verarbeitet, ${backfill.linked || 0} verknüpft, ${backfill.failed} fehlgeschlagen`,
        );
      }
    } catch (err) {
      console.error('Wareneingang Reimport failed', err);
    }
    try {
      const telematicsBackfill = await telematics.reimportUnrecognizedFromProcessed(undefined, 80);
      if (telematicsBackfill.processed || telematicsBackfill.failed) {
        console.log(
          `Telematics Reimport: ${telematicsBackfill.processed} nachgezogen, ${telematicsBackfill.failed} fehlgeschlagen`,
        );
      }
    } catch (err) {
      console.error('Telematics Reimport failed', err);
    }
    try {
      const relink = await telematics.relinkOrphanTourRefs(undefined, 200);
      if (relink.linked) {
        console.log(
          `Telematics Relink: ${relink.linked} Events, ${relink.toursUpdated} Touren aktualisiert`,
        );
      }
    } catch (err) {
      console.error('Telematics Relink failed', err);
    }
  } else {
    console.log('Startup-Backfill übersprungen (WORKER_STARTUP_BACKFILL=1 zum Aktivieren)');
  }

  setInterval(tick, 45_000);
}

bootstrap();
