import type { BostaLiveDelivery } from '../services/api';

export type DelayCategory = 'normal' | 'gt1' | 'gt2' | 'gt3';

export interface ReceivedToReadyInfo {
  diffMinutes: number;
  formattedDiff: string;
  receivedAt: Date | null;
  readyAt: Date | null;
  delayCategory: DelayCategory;
}

export interface TimeAnalyzedItem {
  delivery: BostaLiveDelivery;
  trackingNumber: string;
  assignedHub: string;
  timeInfo: ReceivedToReadyInfo;
}

type AuditValue = { before?: unknown; after?: unknown };
type AuditEntry = Record<string, unknown> & {
  time?: string;
  timestamp?: string;
  createdAt?: string;
  actionType?: string;
  actionsList?: Record<string, unknown>;
  takenBy?: { userName?: string; name?: string };
};

export interface RemovedSealItem {
  trackingNumber: string;
  delivery: BostaLiveDelivery;
  readyAt: Date;
  removedAt: Date;
  sealNumber: string;
  newSealNumber: string;
  removedBy: string;
  removalReason: string;
  readyAudit: AuditEntry;
  removalAudit: AuditEntry;
}

export interface SealRemovalTransition {
  trackingNumber: string;
  oldSealNumber: string;
  newSealNumber: string;
  removedAt: Date;
  reassignedAt: Date | null;
  removedBy: string;
  reason: string;
  auditEvent: AuditEntry;
}

export interface SealLogRow {
  id: string;
  sealNumber: string;
  assignedHubId: string;
  assignedHubName: string;
  businessNames: string[];
  shipmentCount: number;
  firstShipmentAt: Date | null;
  openedAt: Date | null;
  closedAt: Date | null;
  status: string;
  hasRemoval: boolean;
  removalTransitions: SealRemovalTransition[];
}

const ALEX_SORTING_FACILITY_ID = '030000000133';
const ALEX_SORTING_FACILITY_NAME = 'Alex Sorting Facility';
const HISTORY_KEYS = [
  'stateHistory', 'history', 'states', 'timeline', 'events', 'logs', 'trackingHistory',
  'deliveryHistory', 'trackingEvents', 'stateLogs', 'auditLogs', 'sealHistory', 'sealEvents', 'activities', 'activityLog',
] as const;
const EXAMPLE_TRACKING_NUMBERS = [
  '2570562201', '975386802', '4976158258', '7100943225', '1232085843',
  '9448734718', '4014932290', '8431502219', '3702582796', '3880138692',
  '5411868887', '1839802462', '7759920572', '7084359752', '7590349275',
];

const recordOf = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => value == null ? '' : String(value);

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizedLocation(value: unknown): { id: string; name: string } {
  if (typeof value === 'string') return { id: value, name: value.toLowerCase().replace(/[^a-z0-9]/g, '') };
  const record = recordOf(value);
  return {
    id: text(record._id ?? record.id),
    name: text(record.name ?? record.nameAr).toLowerCase().replace(/[^a-z0-9]/g, ''),
  };
}

function sameHub(value: unknown, hubId: string, hubName: string): boolean {
  if (!value) return false;
  const location = normalizedLocation(value);
  const normalizedName = hubName.toLowerCase().replace(/[^a-z0-9]/g, '');
  return location.id === hubId || location.name === normalizedName;
}

function timeAnalysisHistory(delivery: BostaLiveDelivery): Record<string, unknown>[] {
  const record = recordOf(delivery);
  for (const key of ['stateHistory', 'history', 'states', 'timeline', 'events', 'logs', 'trackingHistory']) {
    if (Array.isArray(record[key])) return record[key] as Record<string, unknown>[];
  }
  return [];
}

function auditHistoryFallback(delivery: BostaLiveDelivery): Record<string, unknown>[] {
  const record = recordOf(delivery);
  for (const key of ['stateHistory', 'history', 'states', 'timeline', 'events', 'logs', 'trackingHistory']) {
    if (Array.isArray(record[key])) return record[key] as Record<string, unknown>[];
  }
  return [];
}

function eventDate(event: Record<string, unknown>): Date | null {
  return parseDate(event.timestamp ?? event.time ?? event.createdAt ?? event.updatedAt ?? event.date);
}

function eventLocation(event: Record<string, unknown>): unknown {
  return event.warehouse ?? event.hub ?? event.hubData ?? event.location ?? event.facility ?? event.hubId;
}

function eventLabel(event: Record<string, unknown>): string {
  return [event.value, event.status, event.name, event.title, event.action, event.description, event.message, event.stateName]
    .map(text).filter(Boolean).join(' ').toLowerCase();
}

function getAssignedHubName(delivery: BostaLiveDelivery): string {
  const record = recordOf(delivery);
  const assigned = recordOf(record.assignedHub);
  const destination = recordOf(record.destinationHub);
  const hub = recordOf(record.hub);
  const city = recordOf(recordOf(record.dropOffAddress).city);
  return text(assigned.name ?? record.assignedHubName ?? destination.name ?? hub.name)
    || (text(city.nameAr ?? city.name) ? `Area: ${text(city.nameAr ?? city.name)}` : 'Unspecified (Unassigned)');
}

function getHubReceivedTime(delivery: BostaLiveDelivery, hubId: string, hubName: string): Date | null {
  const record = recordOf(delivery);
  const state = recordOf(record.state);
  const received = recordOf(state.receivedAtWarehouse);
  if (received.time && (!received.warehouse || sameHub(received.warehouse, hubId, hubName))) {
    const parsed = parseDate(received.time);
    if (parsed) return parsed;
  }

  const firstHub = recordOf(record.firstHub);
  if (firstHub.time && sameHub(firstHub.warehouse, hubId, hubName)) {
    const parsed = parseDate(firstHub.time);
    if (parsed) return parsed;
  }

  const matches = timeAnalysisHistory(delivery).filter((event) => {
    const code = text(event.state ?? event.code ?? event.stateCode);
    const label = eventLabel(event);
    const location = eventLocation(event);
    const isReceipt = code === '24' || label.includes('received at warehouse') || label.includes('received');
    return isReceipt && (!location || sameHub(location, hubId, hubName));
  }).map(eventDate).filter((value): value is Date => Boolean(value)).sort((a, b) => a.getTime() - b.getTime());
  return matches[0] || null;
}

function getHubReadyTime(delivery: BostaLiveDelivery, hubId: string, hubName: string): Date | null {
  const record = recordOf(delivery);
  const state = recordOf(record.state);
  const ready = recordOf(state.readyToDispatch);
  const received = recordOf(state.receivedAtWarehouse);
  const readyWarehouse = ready.warehouse ?? received.warehouse;
  if (ready.time && (!readyWarehouse || sameHub(readyWarehouse, hubId, hubName))) {
    const parsed = parseDate(ready.time);
    if (parsed) return parsed;
  }

  const readyState = ['24&5', '5'].includes(text(state.code))
    || (text(state.code) === '24' && text(state.childState) === '5')
    || text(state.value).toLowerCase().includes('ready to dispatch');
  if (readyState) {
    const stateTime = state.time ?? state.updatedAt ?? state.createdAt ?? record.updatedAt;
    if (stateTime) {
      const parsed = parseDate(stateTime);
      if (parsed) return parsed;
    }
  }

  const sourceWarehouse = received.warehouse ?? recordOf(record.firstHub).warehouse;
  for (const key of ['readyToDispatchAt', 'readyToDispatchTime']) {
    if (record[key] && (!sourceWarehouse || sameHub(sourceWarehouse, hubId, hubName))) {
      const parsed = parseDate(record[key]);
      if (parsed) return parsed;
    }
  }

  const logs = Array.isArray(record.log) ? record.log as Record<string, unknown>[] : [];
  const readyLogTimes = logs.filter((entry) => text(recordOf(recordOf(entry.actionsList).state_childState).after) === '5')
    .map((entry) => parseDate(entry.time ?? entry.timestamp ?? entry.createdAt))
    .filter((value): value is Date => Boolean(value)).sort((a, b) => a.getTime() - b.getTime());
  if (readyLogTimes[0]) return readyLogTimes[0];

  const historyReadyTimes = timeAnalysisHistory(delivery).filter((event) => {
    const code = text(event.state ?? event.code ?? event.stateCode);
    const label = eventLabel(event);
    const location = eventLocation(event);
    const isReady = code === '5' || code === '24&5' || label.includes('ready to dispatch') || label.includes('ready');
    return isReady && (!location || sameHub(location, hubId, hubName));
  }).map(eventDate).filter((value): value is Date => Boolean(value)).sort((a, b) => a.getTime() - b.getTime());
  return historyReadyTimes[0] || null;
}

export function analyzeTimeDeliveries(deliveries: BostaLiveDelivery[], hubId: string, hubName: string): {
  rows: TimeAnalyzedItem[];
  countGt1: number;
  countGt2: number;
  countGt3: number;
  hubSummaries: { hubName: string; count: number; averageMinutes: number; overOneHour: number }[];
} {
  let countGt1 = 0;
  let countGt2 = 0;
  let countGt3 = 0;
  const rows = deliveries.flatMap((delivery): TimeAnalyzedItem[] => {
    const receivedAt = getHubReceivedTime(delivery, hubId, hubName);
    const readyAt = getHubReadyTime(delivery, hubId, hubName);
    if (!receivedAt || !readyAt) return [];
    const diffMinutes = Math.floor(Math.max(0, readyAt.getTime() - receivedAt.getTime()) / 60_000);
    if (diffMinutes >= 60) countGt1 += 1;
    if (diffMinutes >= 120) countGt2 += 1;
    if (diffMinutes >= 180) countGt3 += 1;
    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;
    const delayCategory: DelayCategory = diffMinutes >= 180 ? 'gt3' : diffMinutes >= 120 ? 'gt2' : diffMinutes >= 60 ? 'gt1' : 'normal';
    return [{
      delivery,
      trackingNumber: text(delivery.trackingNumber || delivery._id),
      assignedHub: getAssignedHubName(delivery),
      timeInfo: { diffMinutes, formattedDiff: hours > 0 ? `${hours}h ${minutes}m` : `${minutes} minutes`, receivedAt, readyAt, delayCategory },
    }];
  }).sort((a, b) => b.timeInfo.diffMinutes - a.timeInfo.diffMinutes);

  const grouped = new Map<string, TimeAnalyzedItem[]>();
  rows.forEach((row) => grouped.set(row.assignedHub, [...(grouped.get(row.assignedHub) || []), row]));
  const hubSummaries = Array.from(grouped.entries()).map(([name, group]) => ({
    hubName: name,
    count: group.length,
    averageMinutes: Math.round(group.reduce((total, row) => total + row.timeInfo.diffMinutes, 0) / group.length),
    overOneHour: group.filter((row) => row.timeInfo.diffMinutes >= 60).length,
  })).sort((a, b) => b.count - a.count);
  return { rows, countGt1, countGt2, countGt3, hubSummaries };
}

function getAllHistory(delivery: BostaLiveDelivery): Record<string, unknown>[] {
  const record = recordOf(delivery);
  const nested = recordOf(record.shipmentDetailsBusinessView);
  const events = [record, nested].flatMap((source) => [
    ...HISTORY_KEYS.flatMap((key) => Array.isArray(source[key]) ? source[key] as Record<string, unknown>[] : []),
    ...(Array.isArray(source.log) ? source.log as Record<string, unknown>[] : []),
  ]);
  return events.length ? events : auditHistoryFallback(delivery);
}

export function hasDeliveryAuditLog(delivery: BostaLiveDelivery): boolean {
  return getAllHistory(delivery).some((event) => {
    const actions = recordOf(event.actionsList);
    return Object.keys(actions).length > 0;
  });
}

function collectEventText(value: unknown, depth = 0): string[] {
  if (depth > 4 || value == null) return [];
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => collectEventText(item, depth + 1));
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => [key, ...collectEventText(child, depth + 1)]);
  return [];
}

function occurredAtAlex(event: Record<string, unknown>): boolean {
  if (sameHub(eventLocation(event), ALEX_SORTING_FACILITY_ID, ALEX_SORTING_FACILITY_NAME)) return true;
  const takenBy = recordOf(event.takenBy);
  if (text(takenBy.userName ?? takenBy.name).toLowerCase().replace(/[^a-z0-9]/g, '').includes('alexsortingfacility')) return true;
  const actions = recordOf(event.actionsList);
  const scanned = recordOf(actions.lastScannedHub).after;
  if (sameHub(scanned, ALEX_SORTING_FACILITY_ID, ALEX_SORTING_FACILITY_NAME)) return true;
  const locationKeys = ['warehouseId', 'hubName', 'warehouseName', 'locationName', 'facilityName', 'branch', 'branchName', 'lastScannedHub_name'];
  return locationKeys.some((key) => sameHub(event[key], ALEX_SORTING_FACILITY_ID, ALEX_SORTING_FACILITY_NAME));
}

function isReadyEvent(event: Record<string, unknown>): boolean {
  const code = text(event.state ?? event.code ?? event.stateCode).toLowerCase();
  const textValue = collectEventText(event).join(' ').toLowerCase();
  const childState = recordOf(recordOf(event.actionsList).state_childState);
  return code === '5' || code === '24&5' || textValue.includes('ready to dispatch') || text(childState.after) === '5';
}

function isReceivedAtAlexEvent(event: Record<string, unknown>): boolean {
  const actions = recordOf(event.actionsList);
  const stateChange = recordOf(actions.state_code);
  const code = text(event.state ?? event.code ?? event.stateCode ?? stateChange.after);
  const eventText = collectEventText(event).join(' ').toLowerCase();
  return (code === '24' || eventText.includes('received at warehouse') || eventText.includes('received at hub')) && occurredAtAlex(event);
}

function sealAddedValue(event: Record<string, unknown>): string {
  const actions = recordOf(event.actionsList);
  const sealChange = recordOf(actions.sealNumber);
  const childState = recordOf(actions.state_childState);
  const value = text(sealChange.after).trim();
  return value && (sealChange.before !== value || text(childState.after) === '5') ? value : '';
}

function isRemoveFromSealEvent(event: Record<string, unknown>): boolean {
  const actions = recordOf(event.actionsList);
  const sealChange = recordOf(actions.sealNumber);
  const childState = recordOf(actions.state_childState);
  if (Boolean(sealChange.before) && sealChange.after == null && text(childState.before) === '5' && childState.after == null) return true;
  const normalized = collectEventText(event).join(' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return /remove\w*\s+(?:delivery\s+|shipment\s+|tracking\s+number\s+)?from\s+(?:the\s+)?seal/.test(normalized)
    || /seal\s+(?:was\s+|has\s+been\s+)?remov\w*/.test(normalized)
    || (/remov\w*/.test(normalized) && /\bseal\b/.test(normalized) && /delivery|shipment|tracking/.test(normalized))
    || /removefromseal/.test(normalized.replace(/\s/g, ''));
}

function getRemovalDetails(event: Record<string, unknown>): Pick<RemovedSealItem, 'sealNumber' | 'removedBy' | 'removalReason'> {
  const actions = recordOf(event.actionsList);
  const sealChange = recordOf(actions.sealNumber);
  const takenBy = recordOf(event.takenBy);
  const reasonEntry = Object.entries(actions).find(([key]) => /reason|remark|comment|note/i.test(key))?.[1];
  const reasonRecord = recordOf(reasonEntry);
  const reason = reasonEntry && typeof reasonEntry === 'object' ? text(reasonRecord.after ?? reasonRecord.before) : text(reasonEntry);
  return {
    sealNumber: text(sealChange.before) || '—',
    removedBy: text(takenBy.userName ?? takenBy.name) || '—',
    removalReason: reason || text(event.reason ?? event.remark ?? event.comment) || 'Not recorded in API log',
  };
}

function analyzeRemovedDelivery(delivery: BostaLiveDelivery): RemovedSealItem | null {
  const trackingNumber = text(delivery.trackingNumber || delivery._id).trim();
  if (!trackingNumber) return null;
  const events = getAllHistory(delivery).filter(occurredAtAlex).map((event) => ({ event, time: eventDate(event) }))
    .filter((item): item is { event: Record<string, unknown>; time: Date } => Boolean(item.time))
    .sort((a, b) => a.time.getTime() - b.time.getTime());
  const receipts = events.filter(({ event }) => isReceivedAtAlexEvent(event));
  const readyEvents = events.filter(({ event }) => isReadyEvent(event));
  const removals = events.map((item, index) => ({ ...item, index })).filter(({ event }) => isRemoveFromSealEvent(event));
  for (const removed of removals) {
    const ready = readyEvents.find((entry) => entry.time < removed.time && receipts.some((receipt) => receipt.time < entry.time));
    if (!ready) continue;
    const newSealNumber = events.slice(removed.index + 1).map(({ event }) => sealAddedValue(event)).find(Boolean) || '—';
    return {
      trackingNumber, delivery, readyAt: ready.time, removedAt: removed.time,
      newSealNumber, readyAudit: ready.event as AuditEntry, removalAudit: removed.event as AuditEntry,
      ...getRemovalDetails(removed.event),
    };
  }
  return null;
}

export function buildRemovedSealItems(deliveries: BostaLiveDelivery[]): RemovedSealItem[] {
  return deliveries.map(analyzeRemovedDelivery).filter((item): item is RemovedSealItem => item !== null)
    .sort((a, b) => b.removedAt.getTime() - a.removedAt.getTime());
}

function auditValue(value: unknown): AuditValue {
  return recordOf(value) as AuditValue;
}

function isSealAddedEvent(entry: AuditEntry): { sealNumber: string; time: Date } | null {
  const change = auditValue(recordOf(entry.actionsList).sealNumber);
  const childState = auditValue(recordOf(entry.actionsList).state_childState);
  const sealNumber = text(change.after).trim();
  const time = parseDate(entry.time ?? entry.timestamp ?? entry.createdAt);
  if (!sealNumber || !time || (change.before === sealNumber && text(childState.after) !== '5')) return null;
  return { sealNumber, time };
}

function isReceivedAtAlex(entry: AuditEntry): boolean {
  const actions = recordOf(entry.actionsList);
  const stateCode = auditValue(actions.state_code);
  const stateName = auditValue(actions.state_value);
  const receivedHub = auditValue(actions.state_receivedAtWarehouse_warehouse);
  const receivedAtAlex = normalizedLocation(receivedHub.after ?? receivedHub.before);
  const isReceipt = text(stateCode.after) === '24' || /received at warehouse|received at hub/i.test(text(stateName.after));
  return isReceipt && (receivedAtAlex.id === ALEX_SORTING_FACILITY_ID || receivedAtAlex.name === 'alexsortingfacility' || auditEventAtAlex(entry));
}

function auditEventAtAlex(entry: AuditEntry): boolean {
  const actions = recordOf(entry.actionsList);
  const scanHub = auditValue(actions.lastScannedHub);
  const receiptHub = auditValue(actions.state_receivedAtWarehouse_warehouse);
  if ([scanHub.after, scanHub.before, receiptHub.after, receiptHub.before].some((value) => sameHub(value, ALEX_SORTING_FACILITY_ID, ALEX_SORTING_FACILITY_NAME))) return true;
  const flatName = normalizedLocation(auditValue(actions.lastScannedHub_name).after ?? auditValue(actions.lastScannedHub_name).before).name;
  if (flatName === 'alexsortingfacility') return true;
  const actor = text(recordOf(entry.takenBy).userName ?? recordOf(entry.takenBy).name).toLowerCase().replace(/[^a-z0-9]/g, '');
  return actor.includes('alexsortingfacility');
}

function isReadyAtAlex(entry: AuditEntry): boolean {
  const actions = recordOf(entry.actionsList);
  return text(auditValue(actions.state_childState).after) === '5'
    && Boolean(text(auditValue(actions.sealNumber).after).trim()) && auditEventAtAlex(entry);
}

function getLogEntries(delivery: BostaLiveDelivery): AuditEntry[] {
  const record = recordOf(delivery);
  const nested = recordOf(record.shipmentDetailsBusinessView);
  const rows = Array.isArray(record.log) ? record.log : Array.isArray(nested.log) ? nested.log : [];
  return rows as AuditEntry[];
}

function getRemovalTransition(logs: AuditEntry[], index: number, trackingNumber: string): SealRemovalTransition | null {
  const entry = logs[index];
  const actions = recordOf(entry.actionsList);
  const sealChange = auditValue(actions.sealNumber);
  const childState = auditValue(actions.state_childState);
  const oldSealNumber = text(sealChange.before).trim();
  if (!oldSealNumber || sealChange.after != null || text(childState.before) !== '5' || childState.after != null) return null;
  const removedAt = parseDate(entry.time ?? entry.timestamp ?? entry.createdAt);
  if (!removedAt || !auditEventAtAlex(entry)) return null;

  const receipts = logs.flatMap((candidate) => {
    if (!isReceivedAtAlex(candidate)) return [];
    const time = parseDate(candidate.time ?? candidate.timestamp ?? candidate.createdAt);
    return time && time < removedAt ? [time] : [];
  }).sort((a, b) => a.getTime() - b.getTime());
  const firstReceipt = receipts[0];
  if (!firstReceipt || !logs.some((candidate) => {
    if (!isReadyAtAlex(candidate)) return false;
    const time = parseDate(candidate.time ?? candidate.timestamp ?? candidate.createdAt);
    return Boolean(time && time > firstReceipt && time < removedAt);
  })) return null;

  let newSealNumber = '';
  let reassignedAt: Date | null = null;
  for (const later of logs.slice(index + 1)) {
    const added = isSealAddedEvent(later);
    if (added && added.time >= removedAt && isReadyAtAlex(later)) {
      newSealNumber = added.sealNumber;
      reassignedAt = added.time;
      break;
    }
  }
  const reasonValue = Object.entries(actions).find(([key]) => /reason|remark|comment|note/i.test(key))?.[1];
  const reasonRecord = recordOf(reasonValue);
  const reason = reasonValue && typeof reasonValue === 'object' ? reasonRecord.after ?? reasonRecord.before : reasonValue;
  const takenBy = recordOf(entry.takenBy);
  return {
    trackingNumber, oldSealNumber, newSealNumber: newSealNumber || '—', removedAt, reassignedAt,
    removedBy: text(takenBy.userName ?? takenBy.name) || '—',
    reason: text(reason) || 'Not recorded in API log', auditEvent: entry,
  };
}

function isSealClosedEvent(entry: AuditEntry, sealNumber: string): Date | null {
  const actions = recordOf(entry.actionsList);
  const sealChange = auditValue(actions.sealNumber);
  const entrySeal = text(sealChange.before ?? sealChange.after).trim();
  if (entrySeal !== sealNumber || !/(close|closed|seal|dispatch)/.test(text(entry.actionType).toLowerCase())) return null;
  return parseDate(entry.time ?? entry.timestamp ?? entry.createdAt);
}

function assignedHubDetails(delivery: BostaLiveDelivery): { id: string; name: string } {
  const record = recordOf(delivery);
  const assigned = recordOf(record.assignedHub);
  return { id: text(assigned._id), name: getAssignedHubName(delivery) };
}

export function buildSealLogRows(deliveries: BostaLiveDelivery[]): SealLogRow[] {
  const transitionsBySeal = new Map<string, SealRemovalTransition[]>();
  const bySeal = new Map<string, {
    sealNumber: string; hubId: string; hubName: string; firstShipmentAt: Date | null; openedAt: Date | null;
    closedAt: Date | null; businesses: Set<string>; shipments: Set<string>;
  }>();
  for (const delivery of deliveries) {
    const logs = getLogEntries(delivery);
    const trackingNumber = text(delivery.trackingNumber || delivery._id);
    for (let index = 0; index < logs.length; index += 1) {
      const transition = getRemovalTransition(logs, index, trackingNumber);
      if (transition) [transition.oldSealNumber, transition.newSealNumber].filter((seal) => seal && seal !== '—').forEach((seal) => {
        const key = seal.toLowerCase();
        transitionsBySeal.set(key, [...(transitionsBySeal.get(key) || []), transition]);
      });

      const added = isSealAddedEvent(logs[index]);
      if (!added) continue;
      const key = added.sealNumber.toLowerCase();
      const current = bySeal.get(key);
      const hub = assignedHubDetails(delivery);
      const business = text(recordOf(delivery.sender).name).trim();
      const closeTimes = logs.map((event) => isSealClosedEvent(event, added.sealNumber))
        .filter((date): date is Date => Boolean(date)).sort((a, b) => a.getTime() - b.getTime());
      const closedAt = closeTimes[0] || null;
      if (!current) {
        bySeal.set(key, {
          sealNumber: added.sealNumber, hubId: hub.id, hubName: hub.name,
          firstShipmentAt: added.time, openedAt: added.time, closedAt,
          businesses: new Set(business ? [business] : []), shipments: new Set([trackingNumber]),
        });
        continue;
      }
      if (!current.firstShipmentAt || added.time < current.firstShipmentAt) {
        current.firstShipmentAt = added.time;
        current.openedAt = added.time;
        if (hub.id || hub.name !== 'Unspecified (Unassigned)') { current.hubId = hub.id; current.hubName = hub.name; }
      }
      if (!current.closedAt || (closedAt && closedAt < current.closedAt)) current.closedAt = closedAt;
      if (business) current.businesses.add(business);
      current.shipments.add(trackingNumber);
    }
  }

  return Array.from(bySeal.values()).map((seal) => {
    const removalTransitions = transitionsBySeal.get(seal.sealNumber.toLowerCase()) || [];
    return {
      id: seal.sealNumber.toLowerCase(), sealNumber: seal.sealNumber,
      assignedHubId: seal.hubId, assignedHubName: seal.hubName, businessNames: Array.from(seal.businesses),
      shipmentCount: seal.shipments.size, firstShipmentAt: seal.firstShipmentAt, openedAt: seal.openedAt,
      closedAt: seal.closedAt, status: seal.closedAt ? 'Closed' : 'Ready to Dispatch',
      hasRemoval: removalTransitions.length > 0, removalTransitions,
    };
  }).sort((a, b) => (b.firstShipmentAt?.getTime() || 0) - (a.firstShipmentAt?.getTime() || 0));
}

export { ALEX_SORTING_FACILITY_ID, ALEX_SORTING_FACILITY_NAME, EXAMPLE_TRACKING_NUMBERS };
