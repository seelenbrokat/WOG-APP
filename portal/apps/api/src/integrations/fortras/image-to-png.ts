/**
 * Bild-Hilfen für Partner-POD: TIFF (BT-Swiss-Unterschrift) → PNG für PDFKit.
 */
import { deflateSync } from 'zlib';
import * as UTIF from 'utif2';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeB = Buffer.from(type);
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc32(Buffer.concat([typeB, data])));
  return Buffer.concat([len, typeB, data, crcB]);
}

/** Unkomprimiertes RGBA → PNG (8-bit). */
export function rgbaToPng(rgba: Buffer, width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function detectImageExt(buf: Buffer): 'jpg' | 'png' | 'tif' | 'bin' {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpg';
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return 'png';
  }
  if (
    buf.length >= 4 &&
    ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00) ||
      (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a))
  ) {
    return 'tif';
  }
  return 'bin';
}

/**
 * Liefert einen Pfad-geeigneten Bildpuffer für PDFKit (JPEG/PNG).
 * TIFF (BT-Swiss-Unterschrift, oft CCITT G3) wird nach PNG konvertiert.
 */
export function toPdfEmbeddableImage(buf: Buffer): {
  buffer: Buffer;
  ext: 'jpg' | 'png';
} {
  const kind = detectImageExt(buf);
  if (kind === 'jpg') return { buffer: buf, ext: 'jpg' };
  if (kind === 'png') return { buffer: buf, ext: 'png' };
  if (kind === 'tif') {
    const ifds = UTIF.decode(buf);
    if (!ifds?.length) throw new Error('TIFF ohne IFD');
    UTIF.decodeImage(buf, ifds[0]);
    const rgba = Buffer.from(UTIF.toRGBA8(ifds[0]));
    const w = ifds[0].width;
    const h = ifds[0].height;
    if (!w || !h || rgba.length < w * h * 4) {
      throw new Error('TIFF-Dekodierung unvollständig');
    }
    return { buffer: rgbaToPng(rgba, w, h), ext: 'png' };
  }
  throw new Error(`Unbekanntes Bildformat (magic=${buf.slice(0, 4).toString('hex')})`);
}
