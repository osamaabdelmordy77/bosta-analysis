import * as XLSX from 'xlsx';
import type { ManifestReport } from '../types/loadingManifest';

export const SEAL_LABELS = { matched: 'Present in both sources', missing_from_file: 'CARS only / missing from file', extra_in_file: 'File only / extra' };

export function buildManifestWorkbook(report: ManifestReport, selectedSeal = ''): XLSX.WorkBook {
  const book = XLSX.utils.book_new();
  const seals = report.seals.filter((seal) => !selectedSeal || seal.seal.toUpperCase().trim() === selectedSeal.toUpperCase().trim());
  const records = report.records.filter((row) => !selectedSeal || row.seal.toUpperCase().trim() === selectedSeal.toUpperCase().trim());
  const metadata = [
    ['Field', 'Value'], ['Comparison date', report.date], ['CARS car', report.car], ['Vehicle / plate (user declared)', report.vehicle_number],
    ['File', report.filename], ['SHA256', report.sha256], ['Uploaded', report.created_at], ['CARS fetched', report.cars_snapshot.fetched_at],
    ['CARS tab', report.cars_snapshot.sheet_name || 'Legacy: tab not recorded'],
    ['CARS tab date', report.cars_snapshot.sheet_date || 'Unverified legacy date'],
    ['CARS date evidence', report.cars_snapshot.sheet_date === report.date ? 'Matched dated worksheet tab' : 'Legacy: date was user-declared; re-upload for a daily-tab comparison'],
    ['Master Seal (CARS)', report.checks.master_seal.cars || 'Missing'], ['Master Seal (file)', report.checks.master_seal.file.join(', ')],
    ['Master Seal match', report.checks.master_seal.match ? 'Yes' : 'NO - identity mismatch'],
    ['Filename dates', report.checks.date.filename_candidates.join(', ') || 'No date; user declared'],
    ['Date check', report.checks.date.match ? 'Matches a filename candidate / user declared' : 'MISMATCH'],
    ['Car check', report.checks.car.filename ? (report.checks.car.match ? 'Filename matches' : 'MISMATCH') : 'Selected by user; no car field in file'],
    ['Result scope', selectedSeal || 'All seals'], ['Tracking rows in export', records.length],
    ['Important', 'Comparison verifies seal membership, not delivery or physical loading. CARS Number is a row sequence, not a shipment quantity. Missing-seal tracking numbers are unknown because CARS does not list them.'],
  ];
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(metadata), 'Summary');
  const sealRows = seals.map((seal) => ({ Seal: seal.seal, Result: SEAL_LABELS[seal.result], 'CARS rows': seal.sheet_rows.join(', '), 'File tracking rows': seal.file_rows, 'Unique tracking numbers': seal.unique_trackings, 'Duplicate rows': seal.duplicate_rows, 'Also listed for cars': seal.other_cars.join(', '), 'Tracking availability': seal.result === 'missing_from_file' ? 'Unknown - not in uploaded file' : 'See Tracking details' }));
  const trackingRows = records.map((row) => ({ 'Master Seal': row.master_seal, Seal: row.seal, Tracking: row.tracking, 'Seal type': row.seal_type, 'Source hub': row.source_hub, 'Destination hub': row.destination_hub, Status: row.status, 'Source sheet': row.source_sheet, 'Source row': row.source_row }));
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(sealRows), 'Seal comparison');
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(trackingRows), 'Tracking details');
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(report.issues), 'Data issues');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(report.cars_snapshot.rows), 'CARS captured snapshot');
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    const range = sheet['!ref'];
    if (range) {
      sheet['!autofilter'] = { ref: range };
      sheet['!cols'] = Array.from({ length: XLSX.utils.decode_range(range).e.c + 1 }, () => ({ wch: 27 }));
    }
  }
  return book;
}

export function downloadManifest(report: ManifestReport, seal = ''): void {
  const name = `${report.date}-${report.car}-${report.vehicle_number}${seal ? `-${seal}` : ''}`.replace(/[^\p{L}\p{N}-]/gu, '-').slice(0, 160);
  XLSX.writeFile(buildManifestWorkbook(report, seal), `manifest-${name}.xlsx`, { compression: true });
}
