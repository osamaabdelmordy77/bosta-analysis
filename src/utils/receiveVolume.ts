import type { ShipmentRecord } from '../types';
import { parseShipmentDateTime, toLocalDateInputValue } from './receiveDateTime';

export const VOLUME_WINDOWS = ['Before 14:00', '14:00–17:00', '17:00–19:00', 'From 19:00', 'Missing / invalid time'] as const;
export const WEEKDAYS = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;
export interface VolumeFilters { from: string; to: string; date: string; weekdays: string[] }
export interface VolumeEntry { shipment: ShipmentRecord; date: string; weekday: string; week: string; window: string }
export interface VolumeSummary { date: string; weekday: string; week: string; window: string; shipments: number; items: number }
export interface VolumeComparison { key: string; weekday: string; counts: number[]; total: number; items: number }

export function filterVolumeInspection(entries: VolumeEntry[], window: string, weekday: string): VolumeEntry[] {
  return entries.filter((entry) => (window === 'all' || entry.window === window)
    && (weekday === 'all' || entry.weekday === weekday));
}

export function classifyReceiveVolume(shipments: ShipmentRecord[]): VolumeEntry[] {
  return shipments.map((shipment) => {
    const received = parseShipmentDateTime(shipment.receivedTime);
    if (!received) return { shipment, date: '', weekday: '', week: '', window: VOLUME_WINDOWS[4] };
    const minutes = received.getHours() * 60 + received.getMinutes();
    const window = minutes < 840 ? VOLUME_WINDOWS[0] : minutes < 1020 ? VOLUME_WINDOWS[1] : minutes < 1140 ? VOLUME_WINDOWS[2] : VOLUME_WINDOWS[3];
    const week = new Date(received);
    week.setDate(week.getDate() - ((week.getDay() + 1) % 7));
    return { shipment, date: toLocalDateInputValue(received), weekday: WEEKDAYS[(received.getDay() + 1) % 7], week: toLocalDateInputValue(week), window };
  });
}

export function filterReceiveVolume(entries: VolumeEntry[], filters: VolumeFilters): VolumeEntry[] {
  return entries.filter((entry) => {
    if ((filters.from || filters.to || filters.date || filters.weekdays.length) && !entry.date) return false;
    return (!filters.from || entry.date >= filters.from) && (!filters.to || entry.date <= filters.to)
      && (!filters.date || entry.date === filters.date) && (!filters.weekdays.length || filters.weekdays.includes(entry.weekday));
  });
}

export function summarizeReceiveVolume(entries: VolumeEntry[]): VolumeSummary[] {
  const groups = new Map<string, VolumeSummary>();
  for (const entry of entries) {
    const key = `${entry.date}|${entry.window}`;
    let group = groups.get(key);
    if (!group) {
      group = { date: entry.date, weekday: entry.weekday, week: entry.week, window: entry.window, shipments: 0, items: 0 };
      groups.set(key, group);
    }
    group.shipments++;
    group.items += Number.isFinite(entry.shipment.items) ? entry.shipment.items : 0;
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date) || VOLUME_WINDOWS.indexOf(a.window as typeof VOLUME_WINDOWS[number]) - VOLUME_WINDOWS.indexOf(b.window as typeof VOLUME_WINDOWS[number]));
}

export function compareReceiveVolume(summary: VolumeSummary[], dimension: 'date' | 'weekday' | 'week'): VolumeComparison[] {
  const rows = new Map<string, VolumeComparison>();
  for (const group of summary) {
    const key = group[dimension] || 'Missing / invalid time';
    let row = rows.get(key);
    if (!row) { row = { key, weekday: dimension === 'date' ? group.weekday : '', counts: VOLUME_WINDOWS.map(() => 0), total: 0, items: 0 }; rows.set(key, row); }
    const index = VOLUME_WINDOWS.indexOf(group.window as typeof VOLUME_WINDOWS[number]);
    row.counts[index] += group.shipments;
    row.total += group.shipments;
    row.items += group.items;
  }
  return [...rows.values()].sort((a, b) => {
    if (a.key === 'Missing / invalid time') return 1;
    if (b.key === 'Missing / invalid time') return -1;
    return dimension === 'weekday' ? WEEKDAYS.indexOf(a.key as typeof WEEKDAYS[number]) - WEEKDAYS.indexOf(b.key as typeof WEEKDAYS[number]) : a.key.localeCompare(b.key);
  });
}
