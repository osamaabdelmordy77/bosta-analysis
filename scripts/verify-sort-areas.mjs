import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { buildSortAreaWorkbook } from '../src/utils/sortAreaExport.ts';
import { SORT_AREAS, UNKNOWN_AREA, MISSING_HUB, classifySortAreas, filterAreaDates, summarizeAreaDates, normalizeAssignedHub } from '../src/utils/sortAreas.ts';

const record = (assignedHub, receivedTime = '11-07-2026, 14:00:00', extra = {}) => ({
  id: `${assignedHub}-${receivedTime}`, assignedHub, receivedTime, shipmentDate: '1999-01-01', tracking: 'REPEATED', items: 2,
  hubs: { 'Assigned Hub': assignedHub, 'Current Hub': 'October Hub' }, ...extra,
});
const allConfigured = SORT_AREAS.flatMap((area) => area.hubs.map((hub) => ({ area: area.code, hub })));
assert.equal(new Set(allConfigured.map(({ hub }) => normalizeAssignedHub(hub))).size, allConfigured.length, 'No hub belongs to two areas or is counted twice');
for (const { area, hub } of allConfigured) assert.equal(classifySortAreas([record(hub)])[0].area, area);

const entries = classifySortAreas([
  record('  ALEXANDRIA   HUB '), record('Box—Alexandria Hub'), record('Sharm EL Sheikh Hub'), record('Edfo hub'),
  record('3rd settlement'), record('التجمع الثالث'), record('FM-Maadi'),
  record('Unknown Hub'), record(null), record('Alexandria Hub', '11-14-2026, 18:00:00'),
  record('Alexandria Hub', null), record('Alexandria Hub', '02-30-2026, 14:00:00'),
  record('ignored', '11-07-2026, 17:00:00', { hubs: { 'Assigned Hub': 'Nasr City Hub', 'Current Hub': 'October Hub' } }),
]);
assert.deepEqual(entries.map(({ area }) => area), ['A', 'A', 'C', 'U', 'N', 'N', 'R', UNKNOWN_AREA, UNKNOWN_AREA, 'A', 'A', 'A', 'E']);
assert.equal(entries[0].date, '2026-11-07', 'Uses received date, not report date');
assert.equal(entries[2].hub, 'Sharm el sheikh hub', 'Case variants share one canonical hub');
assert.equal(entries[8].hub, MISSING_HUB);
assert.equal(entries[12].hub, 'Nasr City Hub', 'Never uses Current Hub');
assert.equal(entries[10].date, '');
const areaA = entries.filter(({ area }) => area === 'A');
const daily = summarizeAreaDates(areaA);
assert.equal(daily.length, 3);
assert.equal(daily[0].date, '2026-11-07');
assert.equal(daily[1].date, '2026-11-14', 'Same weekday in another week stays separate');
assert.equal(daily[2].date, '', 'Missing or invalid receipt date is visible last');
assert.equal(daily.reduce((sum, row) => sum + row.total, 0), areaA.length);
assert.equal(daily.reduce((sum, row) => sum + row.items, 0), areaA.length * 2);
assert.equal(filterAreaDates(areaA, { from: '2026-11-07', to: '2026-11-14', exact: '' }).length, 3);
assert.equal(filterAreaDates(areaA, { from: '', to: '', exact: '2026-11-14' }).length, 1);
assert.equal(filterAreaDates(areaA, { from: '2026-11-15', to: '2026-11-07', exact: '' }).length, 0);
assert.deepEqual(summarizeAreaDates([]), []);
assert.equal(filterAreaDates(areaA, { from: '', to: '', exact: '', weekday: 'Saturday' }).length, 3, 'Weekday spans different received dates and excludes undated records');
assert.equal(filterAreaDates(areaA, { from: '', to: '', exact: '', weekday: 'Sunday' }).length, 0);
assert.equal(filterAreaDates(areaA, { from: '', to: '2026-11-07', exact: '', weekday: 'Saturday' }).length, 2, 'Weekday combines with received date range');
assert.equal(filterAreaDates(areaA, { from: '', to: '', exact: '2026-11-14', weekday: 'Saturday' }).length, 1);
assert.equal(summarizeAreaDates(classifySortAreas([record('__proto__')]))[0].counts.__proto__, 1);
const exportEntries = filterAreaDates(areaA, { from: '', to: '', exact: '2026-11-07' });
const exported = buildSortAreaWorkbook(exportEntries);
const reopened = XLSX.read(XLSX.write(exported, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
const exportedRows = XLSX.utils.sheet_to_json(reopened.Sheets.Shipments);
assert.equal(exportedRows.length, 2);
assert.ok(exportedRows.every((row) => row.Area === 'A' && row['Received date'] === '2026-11-07'));
assert.equal(XLSX.utils.sheet_to_json(reopened.Sheets['Daily hub summary']).reduce((sum, row) => sum + row.Shipments, 0), exportedRows.length);
const singleHub = buildSortAreaWorkbook(exportEntries.filter((entry) => entry.hub === 'Alexandria Hub'));
assert.equal(XLSX.utils.sheet_to_json(singleHub.Sheets.Shipments).length, 1);
console.log(`Sort Area passed: ${allConfigured.length} configured hubs; all 8 areas, aliases, Assigned Hub precedence, unknown/missing hubs, received dates, week separation, filters and reconciliation.`);
console.log('Area and hub Excel downloads passed: filtered shipment counts, received dates, daily summary reconciliation and XLSX round-trip.');
