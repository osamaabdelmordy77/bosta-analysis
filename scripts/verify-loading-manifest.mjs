import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { buildManifestWorkbook } from '../src/utils/loadingManifestExport.ts';

const report = {
  id: 'synthetic', date: '2026-11-03', car: 'CAR 1', vehicle_number: 'ABC 123', filename: 'synthetic.xlsx', created_at: '2026-11-03T12:00:00Z', sha256: 'synthetic',
  cars_snapshot: { sheet_name: '3-11-2026', sheet_date: '2026-11-03', fetched_at: '2026-11-03T11:59:00Z', rows: [['CAR 1'], ['master seal', 'MASTER1'], ['seal', 'Number'], ['S1', '1'], ['S2', '2']] },
  checks: { master_seal: { match: true, cars: 'MASTER1', file: ['MASTER1'] }, date: { match: true, filename_candidates: ['2026-11-03'] }, car: { match: true, filename: null } },
  seals: [
    { seal: 'S1', result: 'matched', sheet_rows: [4], file_rows: 2, unique_trackings: 2, duplicate_rows: 0, other_cars: [] },
    { seal: 'S2', result: 'missing_from_file', sheet_rows: [5], file_rows: 0, unique_trackings: 0, duplicate_rows: 0, other_cars: [] },
    { seal: 'S3', result: 'extra_in_file', sheet_rows: [], file_rows: 1, unique_trackings: 1, duplicate_rows: 0, other_cars: ['CAR 2'] },
  ],
  records: ['0000123', '=1+1', '0000456'].map((tracking, index) => ({ master_seal: 'MASTER1', seal: index < 2 ? 'S1' : 'S3', tracking, source_sheet: 'Master Seal', source_row: index + 2, source_hub: 'Source', destination_hub: 'Destination', status: 'Received', seal_type: 'Normal' })),
  issues: [],
};
const book = buildManifestWorkbook(report);
const reopened = XLSX.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
assert.deepEqual(reopened.SheetNames, ['Summary', 'Seal comparison', 'Tracking details', 'Data issues', 'CARS captured snapshot']);
const tracks = XLSX.utils.sheet_to_json(reopened.Sheets['Tracking details']);
assert.equal(tracks.length, 3);
const summaryRows = XLSX.utils.sheet_to_json(reopened.Sheets.Summary, { header: 1 });
assert.ok(summaryRows.some((row) => row[0] === 'CARS tab' && row[1] === '3-11-2026'));
assert.ok(summaryRows.some((row) => row[0] === 'CARS tab date' && row[1] === '2026-11-03'));
assert.equal(tracks[0].Tracking, '0000123');
assert.equal(reopened.Sheets['Tracking details'].C3.t, 's');
assert.equal(reopened.Sheets['Tracking details'].C3.f, undefined);
assert.equal(XLSX.utils.sheet_to_json(reopened.Sheets['Seal comparison'])[1]['Tracking availability'], 'Unknown - not in uploaded file');
const oneSeal = buildManifestWorkbook(report, 'S1');
assert.equal(XLSX.utils.sheet_to_json(oneSeal.Sheets['Tracking details']).length, 2);
assert.equal(XLSX.utils.sheet_to_json(oneSeal.Sheets['Seal comparison']).length, 1);
console.log('Manifest Excel passed: complete comparison, captured CARS, missing-seal unknowns, per-seal tracking scope, leading zeros and formula-like text.');
