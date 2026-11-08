import type { BostaLiveDelivery } from '../services/api';

export interface MissScanRow {
  delivery: BostaLiveDelivery;
  trackingNumber: string;
  business: string;
  type: string;
  device: string;
  assignedHub: string;
  receivedAt: Date;
  minutes: number;
}

type Event = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function date(value: unknown): Date | null {
  const parsed = new Date(text(value));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function sameHub(value: unknown, hubId: string, hubName: string): boolean {
  if (!value) return false;
  if (typeof value === 'object') {
    const hub = value as Record<string, unknown>;
    return text(hub._id) === hubId || text(hub.name).toLowerCase() === hubName.toLowerCase();
  }
  return text(value) === hubId || text(value).toLowerCase() === hubName.toLowerCase();
}

export function deliveryHistory(item: BostaLiveDelivery): Event[] {
  const history = item.stateHistory || item.history || item.states || item.timeline || item.events || item.logs || item.trackingHistory;
  return Array.isArray(history) ? history : [];
}

export function historyTime(event: Event): Date | null {
  return date(event.timestamp || event.time || event.createdAt || event.updatedAt || event.date);
}

export function historyLabel(event: Event): string {
  return [event.value, event.status, event.name, event.title, event.action, event.description, event.message, event.stateName]
    .map(text).filter(Boolean).join(' ');
}

function eventHub(event: Event): unknown {
  return event.warehouse || event.hub || event.hubData || event.location || event.facility || event.hubId;
}

function receivedTime(item: BostaLiveDelivery, hubId: string, hubName: string): Date | null {
  const direct = item.state?.receivedAtWarehouse;
  if (direct?.time && (!direct.warehouse || sameHub(direct.warehouse, hubId, hubName))) {
    const result = date(direct.time);
    if (result) return result;
  }
  if (item.firstHub?.time && sameHub(item.firstHub.warehouse, hubId, hubName)) {
    const result = date(item.firstHub.time);
    if (result) return result;
  }
  const matches = deliveryHistory(item).filter((event) => {
    const code = text(event.state || event.code || event.stateCode);
    const label = historyLabel(event).toLowerCase();
    const hub = eventHub(event);
    return (code === '24' || label.includes('received at warehouse') || label.includes('received'))
      && (!hub || sameHub(hub, hubId, hubName));
  }).map(historyTime).filter((value): value is Date => value !== null).sort((a, b) => a.getTime() - b.getTime());
  return matches[0] || null;
}

function readyTime(item: BostaLiveDelivery, hubId: string, hubName: string): Date | null {
  const direct = item.state?.readyToDispatch;
  const warehouse = direct?.warehouse || item.state?.receivedAtWarehouse?.warehouse;
  if (direct?.time && (!warehouse || sameHub(warehouse, hubId, hubName))) {
    const result = date(direct.time);
    if (result) return result;
  }
  if (item.readyToDispatchAt || item.readyToDispatchTime) {
    const result = date(item.readyToDispatchAt || item.readyToDispatchTime);
    if (result) return result;
  }
  const readyLogs = Array.isArray(item.log) ? item.log.filter((entry) => {
    const action = entry.actionsList as Record<string, unknown> | undefined;
    const state = action?.state_childState as Record<string, unknown> | undefined;
    return text(state?.after) === '5';
  }) : [];
  const logTime = readyLogs.map((entry) => date(entry.time || entry.timestamp || entry.createdAt))
    .filter((value): value is Date => value !== null).sort((a, b) => a.getTime() - b.getTime())[0];
  if (logTime) return logTime;
  const matches = deliveryHistory(item).filter((event) => {
    const code = text(event.state || event.code || event.stateCode);
    const label = historyLabel(event).toLowerCase();
    const hub = eventHub(event);
    return (code === '5' || code === '24&5' || label.includes('ready to dispatch'))
      && (!hub || sameHub(hub, hubId, hubName));
  }).map(historyTime).filter((value): value is Date => value !== null).sort((a, b) => a.getTime() - b.getTime());
  return matches[0] || null;
}

function deliveryType(item: BostaLiveDelivery): string {
  const value = item.type ?? item.deliveryType;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return text(record.name ?? record.label ?? record.value ?? record.type) || '—';
  }
  return text(value) || '—';
}

function deviceSource(item: BostaLiveDelivery): string {
  const values: string[] = [];
  const keys = /device|platform|user.?agent|client|application|app.?name|channel|origin|source|scanner|created.?from|updated.?from/i;
  const visited = new WeakSet<object>();
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || depth > 5 || visited.has(value)) return;
    visited.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (keys.test(key)) {
        if (typeof child === 'string' || typeof child === 'number') values.push(String(child));
        else if (child && typeof child === 'object') Object.values(child).forEach((nested) => {
          if (typeof nested === 'string' || typeof nested === 'number') values.push(String(nested));
        });
      }
      if (child && typeof child === 'object') visit(child, depth + 1);
    }
  };
  visit(item, 0);
  const info = values.join(' ').toLowerCase();
  if (/android|bosta.?driver.?app/.test(info)) return 'Android';
  if (/laptop|desktop|windows|macos|mac os|linux/.test(info)) return 'Laptop';
  if (/web|browser|website|portal/.test(info)) return 'Web';
  return 'Unknown';
}

export function buildMissScanRows(deliveries: BostaLiveDelivery[], hubId: string, hubName: string, now: number): MissScanRow[] {
  return deliveries.flatMap((item) => {
    if (text(item.state?.code) !== '24' || text(item.state?.childState) === '5') return [];
    const receivedAt = receivedTime(item, hubId, hubName);
    if (!receivedAt || readyTime(item, hubId, hubName)) return [];
    return [{
      delivery: item,
      trackingNumber: text(item.trackingNumber || item._id),
      business: item.sender?.name || 'Not provided',
      type: deliveryType(item),
      device: deviceSource(item),
      assignedHub: item.assignedHub?.name || item.assignedHubName || item.destinationHub?.name || item.hub?.name || 'Unspecified',
      receivedAt,
      minutes: Math.floor(Math.max(0, now - receivedAt.getTime()) / 60_000),
    }];
  }).sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
}

export function duration(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  return days ? `${days}d ${hours}h ${mins}m` : hours ? `${hours}h ${mins}m` : `${mins}m`;
}
