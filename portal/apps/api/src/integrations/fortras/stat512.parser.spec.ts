import { mapStat512EventToTransportOrderStatus } from './stat512-to-telematics';
import { isStat512Content, parseStat512, primaryConsignmentNumber } from './stat512.parser';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('STAT512 parser', () => {
  const samplePath = join(
    __dirname,
    '../../../../../../data/samples/fortras/stat512-sample.txt',
  );

  it('erkennt STAT512', () => {
    const content = readFileSync(samplePath, 'utf8');
    expect(isStat512Content(content)).toBe(true);
  });

  it('parst Q10 Sendungsnummer und Status', () => {
    const content = readFileSync(samplePath, 'utf8');
    const msg = parseStat512(content, 'stat512-sample.txt');
    expect(msg.events.length).toBe(1);
    const ev = msg.events[0];
    expect(primaryConsignmentNumber(ev)).toBe('A-21438081-A-1');
    expect(ev.statusCode).toBe('070');
    expect(ev.eventDate).toBe('2026-09-10');
    expect(ev.eventTime).toBe('14:30');
    expect(ev.additionalText).toContain('Zustellung OK');
  });

  it('mappt Statuscode auf TransportOrderStatus', () => {
    const content = readFileSync(samplePath, 'utf8');
    const msg = parseStat512(content);
    const mapped = mapStat512EventToTransportOrderStatus(msg.events[0]);
    expect(mapped?.transportOrderNumber).toBe('A-21438081-A-1');
    expect(mapped?.status).toBe('UnloadingFinished');
    expect(mapped?.originalCode).toBe('070');
  });
});
