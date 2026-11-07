import * as XLSX from 'xlsx';
import { MISSING_RECEIVED_DATE, summarizeAreaDates, type AreaEntry } from './sortAreas';

export function buildSortAreaWorkbook(entries: AreaEntry[]): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const rows = entries.map(({ shipment: s, area, hub, date, weekday }) => ({
    Area: area === '?' ? 'Unmapped' : area, 'Assigned hub group': hub,
    'Received date': date || MISSING_RECEIVED_DATE, Weekday: weekday,
    'Received Time': s.receivedTime ?? '', 'Tracking number': s.tracking,
    'Picked-Up Date': s.pickedUpDate ?? '', 'Report date': s.shipmentDate,
    Items: s.items, Business: s.business ?? '', Type: s.shipType ?? '',
    'Package type': s.packageType ?? '', 'Package size': s.packageSize ?? '',
    'Pickup city': s.pickupCity ?? '', 'Drop city': s.dropCity ?? '',
    'Pickup zone': s.pickupZone ?? '',
    'Assigned Hub (source)': s.hubs['Assigned Hub'] || s.assignedHub || '',
    'Source file': s.fileName, 'Source sheet index': s.sourceSheetIndex ?? '',
    'Source row': s.sourceRowNumber ?? '',
  }));
  const summary = summarizeAreaDates(entries).flatMap((day) => Object.entries(day.counts).map(([hub, count]) => ({
    'Received date': day.date || MISSING_RECEIVED_DATE, Weekday: day.weekday,
    'Assigned hub group': hub, Shipments: count,
  })));
  for (const [title, data] of [['Shipments', rows], ['Daily hub summary', summary]] as const) {
    const sheet = XLSX.utils.json_to_sheet(data);
    sheet['!cols'] = Object.keys(data[0] ?? {}).map(() => ({ wch: 24 }));
    if (sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
    XLSX.utils.book_append_sheet(workbook, sheet, title);
  }
  return workbook;
}

export function downloadSortArea(entries: AreaEntry[], name: string): void {
  const safeName = name.replace(/[^a-z0-9-]/gi, '-').slice(0, 160);
  XLSX.writeFile(buildSortAreaWorkbook(entries), `sort-${safeName}.xlsx`, { compression: true });
}
