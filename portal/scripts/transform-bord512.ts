/**
 * CLI: FORTRAS BORD512 → Soloplan OrderImportPORTAL v6
 *
 *   npx ts-node --transpile-only portal/scripts/transform-bord512.ts \
 *     path/to/file.txt [out.json]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { transformBord512ToSoloplan } from '../apps/api/src/integrations/fortras/bord512-to-soloplan';

const input = process.argv[2];
const output = process.argv[3];

if (!input) {
  console.error('Usage: transform-bord512.ts <bord512-file> [out.json]');
  process.exit(1);
}

const content = readFileSync(resolve(input));
const { bordero, soloplan, fileName } = transformBord512ToSoloplan(content, {
  sourceFileName: input,
  freightPayer: {
    name: 'Quehenberger Logistics',
    matchcode: 'QUEHENBERGER',
  },
});

const outPath = resolve(
  output ||
    resolve(__dirname, '../data/samples/fortras', fileName.replace(/\.json$/, '') + '-soloplan.json'),
);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(soloplan, null, 2));

console.log(
  JSON.stringify(
    {
      borderoNumber: bordero.borderoNumber,
      borderoDate: bordero.borderoDate,
      senderId: bordero.senderId,
      carrierName: bordero.carrierName,
      consignments: bordero.consignments.length,
      outPath,
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
