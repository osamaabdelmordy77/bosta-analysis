import assert from 'node:assert/strict';
import { computeAggregations, filterShipments } from '../src/utils/analytics.ts';

const records = [
  shipment('1', '2026-07-01', 2, 'Merchant A', 'Delivery', 'Box', 'Small', 'Cairo', 'Giza', 'Zone 1', 'North', { 'Assigned Hub': 'North', 'Current Hub': 'East' }),
  shipment('2', '2026-07-15', 1, 'Merchant A', 'Pickup', 'Polybag', 'Medium', 'Alexandria', 'Cairo', 'Zone 2', 'North', { 'Assigned Hub': 'North', 'Current Hub': null }),
  shipment('3', '2026-08-03', 3, 'Merchant B', 'Delivery', 'Box', 'Small', 'Cairo', 'Giza', 'Zone 1', 'South', { 'Assigned Hub': 'South', 'Current Hub': 'West' }),
  shipment('4', '2026-07-15', 4, null, null, null, 'Large', null, 'Cairo', null, null, { 'Assigned Hub': null, 'Current Hub': 'East' }),
  shipment('5', '', 1, 'Merchant B', null, null, null, null, null, null, 'South', { 'Assigned Hub': 'South' }),
];

const all = computeAggregations(records, ['North', 'South', 'Unused Hub'], 'Assigned Hub');
assert.equal(all.totalShipments, 5);
assert.equal(all.totalItems, 11);
assert.equal(all.activeHubs, 2);
assert.equal(all.zeroHubs, 1);
assert.equal(all.totalHubs, 3);
assert.equal(all.dailyTrend.reduce((sum, item) => sum + item.n, 0), 4);
assert.equal(all.monthlyTrend.find((item) => item.month === '2026-07')?.n, 3);
assert.equal(all.hubRows.find((item) => item.name === 'North')?.n, 2);
assert.equal(all.hubRows.find((item) => item.name === 'South')?.items, 4);

const filters = emptyFilters();
filters.hub.add('North');
filters.biz.add('Merchant A');
filters.month = '2026-07';
filters.dateFrom = '2026-07-01';
filters.dateTo = '2026-07-15';
const filtered = filterShipments(records, filters, 'Assigned Hub');
assert.deepEqual(filtered.map((item) => item.id), ['1', '2']);
assert.equal(computeAggregations(filtered, ['North', 'South'], 'Assigned Hub').totalItems, 3);

const currentHubFilter = emptyFilters();
currentHubFilter.hub.add('East');
assert.deepEqual(filterShipments(records, currentHubFilter, 'Current Hub').map((item) => item.id), ['1', '4']);

const reportSourceFilters = emptyFilters();
reportSourceFilters.fileIds.add('synthetic-file');
reportSourceFilters.size.add('Small');
reportSourceFilters.lane.add('Cairo → Giza');
assert.deepEqual(filterShipments(records, reportSourceFilters).map((item) => item.id), ['1', '3']);

console.log('Analytics baseline passed: totals, trends, combined filters, file, package size, route, and hub basis.');

function shipment(id, shipmentDate, items, business, shipType, packageType, packageSize, pickupCity, dropCity, pickupZone, assignedHub, hubs) {
  return {
    id,
    fileId: 'synthetic-file',
    fileName: 'synthetic.xlsx',
    shipmentDate,
    dateMs: 0,
    tracking: `SYN-${id}`,
    items,
    business,
    shipType,
    packageType,
    packageSize,
    pickupCity,
    dropCity,
    pickupZone,
    assignedHub,
    hubs,
  };
}

function emptyFilters() {
  return {
    hub: new Set(), biz: new Set(), st: new Set(), pt: new Set(), size: new Set(), pc: new Set(), dc: new Set(),
    fileIds: new Set(), lane: new Set(),
    year: 'all', month: 'all', specificDate: 'all', dateFrom: '', dateTo: '',
  };
}
