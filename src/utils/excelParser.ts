import * as XLSX from 'xlsx';
import { ShipmentRecord } from '../types';

export const ROLES = [
  {
    k: 'tracking',
    label: 'Tracking Number',
    exact: [
      'trackingnumber', 'trackingno', 'trackingnum', 'trackingid',
      'tracking', 'awb', 'awbnumber', 'waybill', 'waybillnumber',
      'shipmentid', 'shipmentnumber', 'shipmentno', 'barcode'
    ],
    part: ['tracking', 'waybill', 'awb']
  },
  {
    k: 'packageType',
    label: 'Package Type',
    exact: ['packagetype', 'parceltype', 'packagecategory'],
    part: ['packagetype', 'parceltype']
  },
  {
    k: 'packageSize',
    label: 'Package Size',
    exact: ['packagesize', 'parcelsize', 'size'],
    part: ['packagesize', 'parcelsize']
  },
  {
    k: 'shipType',
    label: 'Shipment Type',
    exact: ['type', 'shipmenttype', 'deliverytype', 'ordertype', 'servicetype', 'shipmentcategory'],
    part: ['shipmenttype', 'deliverytype', 'ordertype', 'servicetype']
  },
  {
    k: 'pickupCity',
    label: 'Pickup City',
    exact: ['pickupcity', 'origincity', 'fromcity', 'sendercity', 'collectioncity'],
    part: ['pickupcity', 'origincity', 'fromcity']
  },
  {
    k: 'dropCity',
    label: 'DropOff City',
    exact: ['dropoffcity', 'dropcity', 'deliverycity', 'destinationcity', 'tocity', 'consigneecity', 'destcity'],
    part: ['dropoffcity', 'dropcity', 'deliverycity', 'destinationcity']
  },
  {
    k: 'pickupZone',
    label: 'Pickup Zone',
    exact: ['pickupzone', 'pickuparea', 'originzone', 'pickupdistrict', 'pickupneighborhood'],
    part: ['pickupzone', 'pickuparea', 'originzone']
  },
  {
    k: 'items',
    label: 'Items',
    exact: ['items', 'itemcount', 'noofitems', 'numberofitems', 'itemscount', 'quantity', 'qty', 'totalitems', 'itemsquantity'],
    part: ['itemcount', 'noofitems', 'numberofitems']
  },
  {
    k: 'business',
    label: 'Business',
    exact: ['business', 'businessname', 'merchant', 'merchantname', 'seller', 'sellername', 'store', 'storename', 'shipper', 'shippername', 'client', 'clientname', 'sender'],
    part: ['business', 'merchant', 'seller', 'shipper']
  },
  {
    k: 'date',
    label: 'Date',
    exact: [],
    part: []
  }
];

export const norm = (s: unknown): string =>
  String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');

const NULLS = new Set(['', 'nan', 'null', 'undefined', 'n/a', 'na', 'none', '-', '--']);
const pad2 = (n: number | string) => String(n).padStart(2, '0');

export function cleanValue(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  }
  const s = String(v).replace(/\s+/g, ' ').trim();
  return NULLS.has(s.toLowerCase()) ? null : s;
}

const isHubHdr = (n: string) => /hub|facility|warehouse|intransitto/.test(n);
const DATE_HDR = /date|time|created|updated|scheduled|deliveredat|pickedup|day$/;

export interface SheetDetection {
  tracking?: number;
  packageType?: number;
  packageSize?: number;
  shipType?: number;
  pickupCity?: number;
  dropCity?: number;
  pickupZone?: number;
  items?: number;
  business?: number;
  date?: number;
  hubs: number[];
  score: number;
}

export function detectSheetColumns(headers: string[], rows: unknown[][]): SheetDetection {
  const hnorm = headers.map(norm);
  const used = new Set<number>();
  const det: Record<string, number> = {};

  for (const r of ROLES) {
    if (r.k === 'date') continue;
    let i = hnorm.findIndex((h, ix) => !used.has(ix) && r.exact.includes(h));
    if (i < 0) {
      i = hnorm.findIndex((h, ix) => !used.has(ix) && !isHubHdr(h) && r.part.some((p) => h.includes(p)));
    }
    if (i >= 0) {
      det[r.k] = i;
      used.add(i);
    }
  }

  const hubs: number[] = [];
  hnorm.forEach((h, i) => {
    if (!used.has(i) && isHubHdr(h)) {
      hubs.push(i);
      used.add(i);
    }
  });

  // Date column detection from sheet cells if needed
  for (let i = 0; i < hnorm.length; i++) {
    if (used.has(i) || !DATE_HDR.test(hnorm[i])) continue;
    let ok = 0, tot = 0;
    for (let r = 0; r < Math.min(rows.length, 200); r++) {
      const v = rows[r]?.[i];
      if (v == null || v === '') continue;
      tot++;
      if (v instanceof Date || (typeof v === 'number' && v > 20000 && v < 80000)) ok++;
      else if (typeof v === 'string' && /\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(v)) ok++;
    }
    if (tot > 0 && ok / tot >= 0.7) {
      det.date = i;
      used.add(i);
      break;
    }
  }

  const score = Object.keys(det).length + (hubs.length ? 1 : 0);
  return { ...det, hubs, score };
}

export interface ParseResult {
  fileId: string;
  fileName: string;
  shipmentDate: string;
  records: ShipmentRecord[];
  sourceSheets: Array<{
    index: number;
    name: string;
    headerRowNumber: number;
    headers: string[];
    rows: Array<{ sourceRowNumber: number; values: unknown[]; dashboardRecord?: ShipmentRecord }>;
  }>;
  hubLabels: string[];
  allHeaders: string[];
  stats: {
    totalRowsRead: number;
    validShipments: number;
    duplicatesRemoved: number;
    missingTracking: number;
    sheetsCount: number;
  };
}

export function parseExcelBuffer(
  buffer: ArrayBuffer,
  fileId: string,
  fileName: string,
  shipmentDate: string,
  overrides?: Record<string, string>
): ParseResult {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });

  const [y, m, d] = shipmentDate.split('-');
  const dateMs = Date.UTC(+y, +m - 1, +d);

  const sheetsData = wb.SheetNames.map((name, sheetIndex) => {
    const ws = wb.Sheets[name];
    const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false
    });
    const sourceAoa: unknown[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    });

    // Find header row (within top 15 rows, the one with the most filled strings)
    let hi = 0;
    let best = -1;
    for (let i = 0; i < Math.min(15, aoa.length); i++) {
      const c = (aoa[i] || []).filter((v) => typeof v === 'string' && v.trim() !== '').length;
      if (c > best) {
        best = c;
        hi = i;
      }
    }

    const rawHdr = (aoa[hi] || []) as unknown[];
    const rows = aoa.slice(hi + 1);
    const ncol = Math.max(rawHdr.length, ...rows.slice(0, 50).map((r) => r.length), 0);
    const headers: string[] = [];
    for (let i = 0; i < ncol; i++) {
      const h = rawHdr[i];
      headers.push(h != null && String(h).trim() !== '' ? String(h).trim() : `Column ${i + 1}`);
    }

    const det = detectSheetColumns(headers, rows);

    let sourceHeaderIndex = 0;
    let sourceHeaderScore = -1;
    for (let i = 0; i < Math.min(15, sourceAoa.length); i++) {
      const count = (sourceAoa[i] || []).filter((value) => typeof value === 'string' && value.trim() !== '').length;
      if (count > sourceHeaderScore) {
        sourceHeaderScore = count;
        sourceHeaderIndex = i;
      }
    }

    const sourceHeader = (sourceAoa[sourceHeaderIndex] || []) as unknown[];
    const sourceColumnCount = Math.max(sourceHeader.length, ...sourceAoa.slice(sourceHeaderIndex + 1, sourceHeaderIndex + 51).map((row) => row.length), 0);
    const sourceHeaders = Array.from({ length: sourceColumnCount }, (_, index) => {
      const header = sourceHeader[index];
      return header != null && String(header).trim() !== '' ? String(header).trim() : `Column ${index + 1}`;
    });
    const sourceRows = sourceAoa.slice(sourceHeaderIndex + 1)
      .map((values, index) => ({ sourceRowNumber: sourceHeaderIndex + index + 2, values }))
      .filter(({ values }) => values.some((value) => value != null && value !== ''));

    return {
      index: sheetIndex,
      name,
      headers,
      hnorm: headers.map(norm),
      rows,
      det,
      sourceHeaderRowNumber: sourceHeaderIndex + 1,
      sourceHeaders,
      sourceRows,
    };
  });

  // Pick sheets with tracking or score >= 3
  let candidateSheets = sheetsData.filter((s) => s.det.tracking !== undefined || s.det.score >= 3);
  if (!candidateSheets.length) {
    // fallback to highest score sheet
    const sorted = [...sheetsData].sort((a, b) => b.det.score - a.det.score || b.rows.length - a.rows.length);
    if (sorted[0] && sorted[0].rows.length > 0) {
      candidateSheets = [sorted[0]];
    }
  }

  const allHeaders = Array.from(new Set(sheetsData.flatMap((s) => s.headers)));

  // Union of all hub labels
  const hubLabels: string[] = [];
  const hubNorms: string[] = [];
  candidateSheets.forEach((sh) => {
    sh.det.hubs.forEach((i) => {
      const hn = sh.hnorm[i];
      if (!hubNorms.includes(hn)) {
        hubNorms.push(hn);
        hubLabels.push(sh.headers[i]);
      }
    });
  });

  const records: ShipmentRecord[] = [];
  const seenTrackingInFile = new Set<string>();
  let totalRowsRead = 0;
  let duplicatesRemoved = 0;
  let missingTracking = 0;

  candidateSheets.forEach((sh) => {
    const getColIndex = (role: string): number => {
      if (overrides && overrides[role]) {
        const ovNorm = norm(overrides[role]);
        return sh.hnorm.indexOf(ovNorm);
      }
      return (sh.det as unknown as Record<string, number | undefined>)[role] ?? -1;
    };

    const ti = getColIndex('tracking');
    const ii = getColIndex('items');
    const bi = getColIndex('business');
    const sti = getColIndex('shipType');
    const pti = getColIndex('packageType');
    const psi = getColIndex('packageSize');
    const pci = getColIndex('pickupCity');
    const dci = getColIndex('dropCity');
    const pzi = getColIndex('pickupZone');

    const hubColIndices = hubLabels.map((l) => sh.hnorm.indexOf(norm(l)));

    for (let rIdx = 0; rIdx < sh.rows.length; rIdx++) {
      const row = sh.rows[rIdx];
      if (!row || row.every((c) => c == null || c === '')) continue;
      totalRowsRead++;

      let trackingStr: string | null = null;
      if (ti >= 0) {
        const tv = row[ti];
        trackingStr = typeof tv === 'number'
          ? tv.toLocaleString('fullwide', { useGrouping: false })
          : cleanValue(tv);

        if (!trackingStr) {
          missingTracking++;
          continue;
        }

        // Deduplicate tracking numbers within this specific file!
        if (seenTrackingInFile.has(trackingStr)) {
          duplicatesRemoved++;
          continue;
        }
        seenTrackingInFile.add(trackingStr);
      } else {
        // Fallback synthetic tracking number if sheet lacks tracking column
        trackingStr = `ROW-${fileId}-${records.length + 1}`;
      }

      // Items
      let itemsVal = 1;
      if (ii >= 0) {
        const iv = row[ii];
        const num = typeof iv === 'number' ? iv : parseFloat(String(iv == null ? '' : iv).replace(/,/g, ''));
        if (isFinite(num) && num >= 0) {
          itemsVal = num;
        }
      }

      // Hubs
      const recordHubs: Record<string, string | null> = {};
      let assignedHubVal: string | null = null;
      hubLabels.forEach((l, j) => {
        const colIdx = hubColIndices[j];
        const val = colIdx >= 0 ? cleanValue(row[colIdx]) : null;
        recordHubs[l] = val;
        if (/assigned/i.test(l) && val && !assignedHubVal) {
          assignedHubVal = val;
        }
      });

      if (!assignedHubVal) {
        // Fallback to first available non-empty hub
        assignedHubVal = Object.values(recordHubs).find((v) => v != null) || null;
      }

      const sourceRowNumber = sh.sourceRows[rIdx]?.sourceRowNumber;
      const rec: ShipmentRecord = {
        id: `${fileId}_${trackingStr}`,
        fileId,
        fileName,
        shipmentDate,
        dateMs,
        tracking: trackingStr,
        items: itemsVal,
        business: bi >= 0 ? cleanValue(row[bi]) : null,
        shipType: sti >= 0 ? cleanValue(row[sti]) : null,
        packageType: pti >= 0 ? cleanValue(row[pti]) : null,
        packageSize: psi >= 0 ? cleanValue(row[psi]) : null,
        pickupCity: pci >= 0 ? cleanValue(row[pci]) : null,
        dropCity: dci >= 0 ? cleanValue(row[dci]) : null,
        pickupZone: pzi >= 0 ? cleanValue(row[pzi]) : null,
        assignedHub: assignedHubVal,
        hubs: recordHubs,
        sourceSheetIndex: sh.index,
        sourceRowNumber,
      };

      records.push(rec);
    }
  });

  return {
    fileId,
    fileName,
    shipmentDate,
    records,
    sourceSheets: sheetsData.map((sheet) => {
      const recordsByRow = new Map(
        records
          .filter((record) => record.sourceSheetIndex === sheet.index && record.sourceRowNumber !== undefined)
          .map((record) => [record.sourceRowNumber as number, record])
      );

      return {
        index: sheet.index,
        name: sheet.name,
        headerRowNumber: sheet.sourceHeaderRowNumber,
        headers: sheet.sourceHeaders,
        rows: sheet.sourceRows.map((sourceRow) => ({
          ...sourceRow,
          dashboardRecord: recordsByRow.get(sourceRow.sourceRowNumber),
        })),
      };
    }),
    hubLabels,
    allHeaders,
    stats: {
      totalRowsRead,
      validShipments: records.length,
      duplicatesRemoved,
      missingTracking,
      sheetsCount: wb.SheetNames.length,
    },
  };
}
