import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseExcelBuffer } from '../../../src/utils/excelParser.ts';
import { extractDateFromFilename } from '../../../src/utils/dateExtractor.ts';

const root = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.resolve(root, '../bosta_211_column_manifest.json'), 'utf8'));
const labels = manifest.map((x) => x.source_label);
const expected = {
  'synthetic_bosta_2026-07-01.xlsx': { validShipments: 3, duplicatesRemoved: 2, missingTracking: 1, sheetsCount: 2, items: 6 },
  'synthetic_bosta_2026-07-02.xlsx': { validShipments: 2, duplicatesRemoved: 0, missingTracking: 0, sheetsCount: 1, items: 1 },
};
const aggregate = { rows: 0, duplicates: 0, missingTracking: 0, items: 0, sheets: 0, uniqueTracking: new Set(), allHeaders: new Set() };
for (const [fileName, stats] of Object.entries(expected)) {
  const buffer = fs.readFileSync(path.resolve(root, fileName));
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const date = fileName.includes('07-01') ? '2026-07-01' : '2026-07-02';
  const parsed = parseExcelBuffer(arrayBuffer, fileName, fileName, date);
  const items = parsed.records.reduce((sum, row) => sum + row.items, 0);
  for (const [key, value] of Object.entries(stats)) {
    const actual = key === 'items' ? items : parsed.stats[key];
    if (actual !== value) throw new Error(`${fileName}: ${key} expected ${value}, got ${actual}`);
  }
  if (parsed.allHeaders.length !== 211) throw new Error(`${fileName}: expected 211 headers, got ${parsed.allHeaders.length}`);
  if (labels.some((label) => !parsed.allHeaders.includes(label))) throw new Error(`${fileName}: source header coverage incomplete`);
  parsed.records.forEach((row) => aggregate.uniqueTracking.add(row.tracking));
  parsed.allHeaders.forEach((label) => aggregate.allHeaders.add(label));
  aggregate.rows += parsed.stats.validShipments;
  aggregate.duplicates += parsed.stats.duplicatesRemoved;
  aggregate.missingTracking += parsed.stats.missingTracking;
  aggregate.items += items;
  aggregate.sheets += parsed.stats.sheetsCount;
}
if (aggregate.rows !== 5 || aggregate.duplicates !== 2 || aggregate.missingTracking !== 1 || aggregate.items !== 7 || aggregate.sheets !== 3 || aggregate.uniqueTracking.size !== 4 || aggregate.allHeaders.size !== 211) {
  throw new Error(`Aggregate mismatch: ${JSON.stringify({...aggregate, uniqueTracking: aggregate.uniqueTracking.size, allHeaders: aggregate.allHeaders.size})}`);
}
const invalidFilenameDatesAccepted = ['Shipment_20260431.xlsx', 'Shipment_31-04-2026.xlsx'];
for (const name of invalidFilenameDatesAccepted) {
  if (extractDateFromFilename(name) !== '2026-04-31') throw new Error(`Expected documented legacy invalid-date behavior for ${name}`);
}
if (extractDateFromFilename('Shipment_2026-04-31.xlsx') !== null) throw new Error('ISO date validation behavior changed unexpectedly');
console.log(JSON.stringify({ result: 'PASS', files: Object.keys(expected).length, acceptedRows: aggregate.rows, uniqueTracking: aggregate.uniqueTracking.size, legacyDuplicatesRemoved: aggregate.duplicates, missingTracking: aggregate.missingTracking, totalItems: aggregate.items, sheets: aggregate.sheets, sourceHeaderCoverage: aggregate.allHeaders.size, invalidFilenameDatesAccepted }, null, 2));
