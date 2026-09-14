import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isBtSwissStatusXml,
  parseBtSwissStatusXml,
  primaryBtSwissReference,
} from './bt-swiss-status.parser';
import { mapBtSwissEventToTransportOrderStatus } from './bt-swiss-status-to-telematics';
import { detectImageExt, toPdfEmbeddableImage } from './image-to-png';

describe('BT Swiss Cargo-Status XML', () => {
  const samplePath = join(
    __dirname,
    '../../../../../../data/samples/fortras/btswiss-status-c50-sample.xml',
  );

  it('erkennt BT-Swiss-XML', () => {
    const content = readFileSync(samplePath, 'utf8');
    expect(isBtSwissStatusXml(content)).toBe(true);
  });

  it('parst C50 inkl. Unterschrift und Empfänger', () => {
    const content = readFileSync(samplePath, 'utf8');
    const msg = parseBtSwissStatusXml(content, 'sample.xml');
    expect(msg.sender).toBe('BTSWISS');
    expect(msg.events.length).toBeGreaterThanOrEqual(1);
    const ev = msg.events.find((e) => e.eventCode === 'C50') || msg.events[0];
    expect(ev.shipmentReference).toBeTruthy();
    expect(primaryBtSwissReference(ev)).toBe(ev.shipmentReference);
    expect(ev.signatureBase64).toBeTruthy();
    expect(ev.deliveredTo).toBeTruthy();
  });

  it('mappt C50 auf UnloadingFinished (auch mit Kurztext)', () => {
    const content = readFileSync(samplePath, 'utf8');
    const msg = parseBtSwissStatusXml(content);
    const mapped = mapBtSwissEventToTransportOrderStatus(
      msg.events.find((e) => e.eventCode === 'C50') || msg.events[0],
    );
    expect(mapped?.status).toBe('UnloadingFinished');
    expect(mapped?.hasProof).toBe(true);
    expect(mapped?.originalCode).toBe('C50');
  });

  it('konvertiert TIFF-Unterschrift zu PNG für PDFKit', () => {
    const content = readFileSync(samplePath, 'utf8');
    const msg = parseBtSwissStatusXml(content);
    const ev = msg.events.find((e) => e.signatureBase64)!;
    const raw = Buffer.from(ev.signatureBase64!, 'base64');
    expect(detectImageExt(raw)).toBe('tif');
    const embed = toPdfEmbeddableImage(raw);
    expect(embed.ext).toBe('png');
    expect(embed.buffer[0]).toBe(0x89);
    expect(embed.buffer[1]).toBe(0x50);
  });

  it('Status ohne Beschreibung bleibt gültig', () => {
    const mapped = mapBtSwissEventToTransportOrderStatus({
      shipmentId: '1/2.1',
      shipmentReference: '999',
      eventCode: 'B00',
      eventAt: new Date(),
    });
    expect(mapped?.status).toBe('Other');
    expect(mapped?.hasProof).toBe(false);
    // Kurzcode ok, keine Pflicht-Beschreibung
    expect(mapped?.statusText === undefined || mapped.statusText.length > 0).toBe(true);
  });
});
