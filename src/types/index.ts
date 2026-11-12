export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  detectedDate: string; // YYYY-MM-DD
  manualDate?: boolean;
  recordCount: number;
  uploadedAt: number;
  duplicateCount: number;
  sheetsCount?: number;
    rejectedCount?: number;
    source?: 'mysql' | 'legacy-migrated';
}

export interface ShipmentRecord {
  id: string; // unique record ID (fileId + '_' + tracking or index)
  fileId: string;
  fileName: string;
  shipmentDate: string; // YYYY-MM-DD
  dateMs: number; // UTC timestamp of shipmentDate
  tracking: string;
  items: number;
  business: string | null;
  shipType: string | null;
  packageType: string | null;
  packageSize: string | null;
  pickupCity: string | null;
  dropCity: string | null;
  pickupZone: string | null;
  assignedHub: string | null;
  hubs: Record<string, string | null>;
  rawDate?: string | null;
  pickedUpDate?: string | null;
  receivedTime?: string | null;
  firstReceivingBy?: string | null;
  sourceSheetIndex?: number;
  sourceRowNumber?: number;
}

export interface ColumnMapping {
  tracking: string;
  packageType: string;
  packageSize: string;
  shipType: string;
  pickupCity: string;
  dropCity: string;
  pickupZone: string;
  items: string;
  business: string;
  date: string;
}

export interface FilterState {
  hub: Set<string>;
  biz: Set<string>;
  st: Set<string>;
  pt: Set<string>;
  size: Set<string>;
  pc: Set<string>;
  dc: Set<string>;
  fileIds: Set<string>;
  lane: Set<string>;
  year: string; // 'all' or '2026', etc.
  month: string; // 'all' or '01'..'12' or '2026-07'
  dateFrom: string; // YYYY-MM-DD or ''
  dateTo: string; // YYYY-MM-DD or ''
  specificDate: string; // YYYY-MM-DD or 'all'
}

export interface HubAgg {
  name: string;
  n: number;
  items: number;
  rank: number;
  share: number;
  cum: number;
  vs: number;
  status: string;
}

export interface BizAgg {
  name: string;
  n: number;
  items: number;
  rank: number;
  share: number;
  cum: number;
  ips: number;
}

export interface AggregationResult {
  totalShipments: number;
  totalItems: number;
  activeHubs: number;
  zeroHubs: number;
  totalHubs: number;
  avgShipmentsPerHub: number;
  avgShipmentsPerBiz: number;
  highestHub: { name: string; n: number; share: number } | null;
  lowestHub: { name: string; n: number; share: number } | null;
  hubRows: HubAgg[];
  bizRows: BizAgg[];
  shipTypeRows: { name: string; n: number; share: number; items: number }[];
  pkgTypeRows: { name: string; n: number; share: number }[];
  pickupCityRows: { name: string; n: number; share: number }[];
  dropCityRows: { name: string; n: number; share: number }[];
  pickupZoneRows: { name: string; n: number; share: number }[];
  packageSizeRows: { name: string; n: number; share: number }[];
  laneRows: { name: string; n: number; share: number }[];
  dailyTrend: { date: string; n: number; items: number }[];
  monthlyTrend: { month: string; n: number; items: number }[];
  dayOfWeekTrend: { day: string; dayIndex: number; n: number }[];
  hubDailyPerformance: { date: string; topHubs: { name: string; n: number }[] }[];
  bizDailyPerformance: { date: string; topBiz: { name: string; n: number }[] }[];
  monthlyMoM: { month: string; n: number; growthPct: number | null }[];
  highestDay: { date: string; n: number } | null;
  lowestDay: { date: string; n: number } | null;
  avgDailyShipments: number;
}
