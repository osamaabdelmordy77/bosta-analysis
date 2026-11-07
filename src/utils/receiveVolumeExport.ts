import type { VolumeEntry } from './receiveVolume';
import * as XLSX from 'xlsx';

export async function downloadVolumeGroup(entries: VolumeEntry[], name: string): Promise<void> {
  const rows = entries.map(({ shipment: s, date, weekday, week, window }) => ({
    'Tracking number': s.tracking, 'Received date': date, Weekday: weekday, 'Week starts Saturday': week,
    'Time group': window, 'Received Time': s.receivedTime ?? '', 'Picked-Up Date': s.pickedUpDate ?? '',
    'Report date': s.shipmentDate, Items: s.items, Business: s.business ?? '', Type: s.shipType ?? '',
    'Package type': s.packageType ?? '', 'Package size': s.packageSize ?? '', 'Pickup city': s.pickupCity ?? '',
    'Drop city': s.dropCity ?? '', 'Pickup zone': s.pickupZone ?? '', 'Assigned hub': s.assignedHub ?? '',
    'Source file': s.fileName, 'Source sheet index': s.sourceSheetIndex ?? '', 'Source row': s.sourceRowNumber ?? '',
  }));
  const sheet = XLSX.utils.json_to_sheet(rows);
  sheet['!cols'] = Object.keys(rows[0] ?? {}).map(() => ({ wch: 23 }));
  if (sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Shipments');
  XLSX.writeFile(workbook, `receive-volume-${name.replace(/[^a-z0-9-]/gi, '-')}.xlsx`, { compression: true });
}
