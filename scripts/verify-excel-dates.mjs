import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseExcelBuffer } from '../src/utils/excelParser.ts';

const headers = ['Tracking Number', 'Source Created At'];
const excelEpochs = [
  { dateSystem: '1900', epoch: Date.UTC(1899, 11, 30) },
  { dateSystem: '1904', epoch: Date.UTC(1904, 0, 1) },
];
const targetDate = Date.UTC(2026, 10, 5, 12, 34, 56);
const results = [];

for (const { dateSystem, epoch } of excelEpochs) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ['00001234', null]]);
  const serial = (targetDate - epoch) / 86_400_000;
  worksheet.B2 = { t: 'n', v: serial, z: 'yyyy-mm-dd hh:mm:ss' };
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Date System');
  workbook.Workbook ??= { Sheets: [], WBProps: { date1904: false }, Views: [{}] };
  workbook.Workbook.WBProps ??= {};
  workbook.Workbook.WBProps.date1904 = dateSystem === '1904';

  const workbookBytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const parsed = parseExcelBuffer(
    workbookBytes.buffer.slice(workbookBytes.byteOffset, workbookBytes.byteOffset + workbookBytes.byteLength),
    `date-system-${dateSystem}`,
    `date-system-${dateSystem}.xlsx`,
    '2026-11-05',
    {},
    { includeDashboardRecords: false },
  );
  const sheet = parsed.sourceSheets[0];
  assert.equal(sheet.dateSystem, dateSystem);
  assert.equal(sheet.rows[0].values[0], '00001234');
  assert.equal(sheet.rows[0].values[1], serial);
  results.push({ date_system: dateSystem, tracking_preserves_zeroes: true, raw_excel_serial: serial });
}

console.log(`Excel date system and raw-value checks passed: ${JSON.stringify(results)}`);
