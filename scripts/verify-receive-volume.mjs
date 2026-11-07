import assert from 'node:assert/strict';
import { classifyReceiveVolume, compareReceiveVolume, filterReceiveVolume, filterVolumeInspection, summarizeReceiveVolume, VOLUME_WINDOWS } from '../src/utils/receiveVolume.ts';

const make = (receivedTime, tracking = 'REPEATED') => ({ id: `${receivedTime}`, receivedTime, tracking, shipmentDate: '1999-01-01', items: 2 });
const entries = classifyReceiveVolume([
  make('11-07-2026, 13:59:59'), make('11-07-2026, 14:00:00'), make('11-07-2026, 16:59:59'),
  make('11-07-2026, 17:00:00'), make('11-07-2026, 18:59:59'), make('11-07-2026, 19:00:00'),
  make('11-14-2026, 14:30:00'), make('12-05-2026, 17:30:00'), make(null), make('02-30-2026, 14:00:00'),
]);
assert.deepEqual(entries.slice(0, 6).map((entry) => entry.window), [VOLUME_WINDOWS[0], VOLUME_WINDOWS[1], VOLUME_WINDOWS[1], VOLUME_WINDOWS[2], VOLUME_WINDOWS[2], VOLUME_WINDOWS[3]]);
assert.equal(entries[1].date, '2026-11-07');
assert.equal(entries[1].weekday, 'Saturday');
assert.equal(entries[1].week, '2026-11-07');
assert.equal(classifyReceiveVolume([make('11-13-2026, 14:00:00')])[0].week, '2026-11-07');
const summary = summarizeReceiveVolume(entries);
assert.equal(summary.reduce((sum, row) => sum + row.shipments, 0), entries.length);
assert.equal(summary.reduce((sum, row) => sum + row.items, 0), 20);
const dates = compareReceiveVolume(summary, 'date');
assert.equal(dates.find((row) => row.key === '2026-11-07').total, 6);
assert.equal(dates.find((row) => row.key === '2026-11-14').total, 1);
assert.equal(dates.find((row) => row.key === 'Missing / invalid time').total, 2);
assert.equal(compareReceiveVolume(summary, 'weekday').find((row) => row.key === 'Saturday').total, 8);
assert.equal(compareReceiveVolume(summary, 'week').length, 4);
const filters = { from: '2026-11-07', to: '2026-11-14', date: '', weekdays: [] };
assert.equal(filterReceiveVolume(entries, filters).length, 7);
assert.equal(filterReceiveVolume(entries, { ...filters, date: '2026-11-14' }).length, 1);
assert.equal(filterReceiveVolume(entries, { ...filters, weekdays: ['Sunday'] }).length, 0);
assert.equal(filterReceiveVolume(entries, { ...filters, from: '2026-12-01' }).length, 0);
assert.deepEqual(compareReceiveVolume([], 'date'), []);
const inspected = filterVolumeInspection(entries, VOLUME_WINDOWS[1], 'Saturday');
assert.equal(inspected.length, 3);
assert.ok(inspected.every((entry) => entry.window === VOLUME_WINDOWS[1] && entry.weekday === 'Saturday'));
assert.equal(filterVolumeInspection(entries, VOLUME_WINDOWS[1], 'Sunday').length, 0);
assert.equal(filterVolumeInspection(entries, 'all', 'Saturday').length, 8);
assert.equal(filterVolumeInspection(entries, 'all', 'all').length, entries.length);
assert.equal(filterVolumeInspection(filterReceiveVolume(entries, { ...filters, date: '2026-11-14' }), VOLUME_WINDOWS[1], 'Saturday').length, 1);
console.log('Receive volume passed: interval boundaries, invalid dates, date/week separation, weekdays, reconciliation, repeated snapshots and inclusive filters.');
