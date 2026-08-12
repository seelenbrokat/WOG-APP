/**
 * CLI: FORTRAS BORD512 → Soloplan OrderImportPORTAL v6
 * Je Sendung ein eigener Auftrag (eigene JSON-Datei).
 *
 *   npx ts-node --transpile-only portal/scripts/transform-bord512.ts \
 *     path/to/file.txt [out-dir]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { transformBord512ToSoloplan } from '../apps/api/src/integrations/fortras/bord512-to-soloplan';

const input = process.argv[2];
const outputDirArg = process.argv[3];

if (!input) {
  console.error('Usage: transform-bord512.ts <bord512-file> [out-dir]');
  process.exit(1);
}

const content = readFileSync(resolve(input));
const { bordero, files } = transformBord512ToSoloplan(content, {
  sourceFileName: input,
  freightPayer: {
    name: 'Quehenberger Logistics',
    matchcode: 'QUEHENBERGER',
  },
});

const outDir = resolve(
  outputDirArg || resolve(__dirname, '../data/samples/fortras/orders-A-5025462'),
);
mkdirSync(outDir, { recursive: true });

for (const file of files) {
  writeFileSync(join(outDir, file.fileName), JSON.stringify(file.soloplan, null, 2));
}

console.log(
  JSON.stringify(
    {
      borderoNumber: bordero.borderoNumber,
      borderoDate: bordero.borderoDate,
      senderId: bordero.senderId,
      carrierName: bordero.carrierName,
      consignments: bordero.consignments.length,
      orders: files.length,
      outDir,
      files: files.map((f) => f.fileName),
      summary: bordero.consignments.map((c) => ({
        pos: c.borderoPosition,
        number: c.consignmentNumber,
        weightKg: c.weightKg,
        shipper: c.shipper?.name1,
        consignee: c.consignee?.name1,
        packages: c.positions.reduce((s, p) => s + (p.quantity || 0), 0),
        barcodes: c.positions.reduce((s, p) => s + p.barcodes.length, 0),
      })),
    },
    null,
    2,
  ),
);
