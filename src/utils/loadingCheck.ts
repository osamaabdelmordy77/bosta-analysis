export interface LoadingCheckSeal {
  number: string;
  type: string;
  packages: string;
  state: string;
  source: string;
  destination: string;
  assignedHub: string;
  updated: string;
  destinationHubId?: string;
  shipmentTrackingNumbers?: string[];
  shipmentIds?: string[];
}

export const LOADING_CHECK_BLOCK_WIDTH = 5;

export interface LoadingCheckEnrichmentEntry {
  row: number;
  sealColumn: number;
  sealKey: string;
}

export interface LoadingCheckEnrichmentUpdate extends LoadingCheckEnrichmentEntry {
  assignedHub: string;
}

const recordOf = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const text = (value: unknown): string => value === null || value === undefined ? '' : String(value);

export function normalizeSealKey(value: unknown): string {
  return text(value).trim().toLowerCase().replace(/\s+/g, '');
}

export function findSystemSealRows(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 5 || value == null) return [];
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
  if (typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  for (const key of ['data', 'result', 'message', 'seals', 'items', 'results']) {
    const found = findSystemSealRows(record[key], depth + 1);
    if (found.length) return found;
  }
  for (const nested of Object.values(record)) {
    const found = findSystemSealRows(nested, depth + 1);
    if (found.length) return found;
  }
  return [];
}

function hubName(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  const hub = recordOf(value);
  return text(hub.name ?? hub.nameEn ?? hub.nameAr ?? hub._id ?? hub.id);
}

function firstHubName(...values: unknown[]): string {
  for (const value of values) {
    const name = hubName(value).trim();
    if (name) return name;
  }
  return '';
}

function hubId(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  const hub = recordOf(value);
  return text(hub._id ?? hub.id).trim();
}

function deliveryDestination(value: unknown): string {
  const delivery = recordOf(value);
  const transit = recordOf(delivery.warehouseTransit);
  return firstHubName(
    delivery.destinationHubName,
    delivery.destinationWarehouseName,
    delivery.destinationHub,
    delivery.destinationWarehouse,
    transit.destinationWarehouse,
  );
}

export function getShipmentHubName(value: unknown): string {
  const delivery = recordOf(value);
  const transit = recordOf(delivery.warehouseTransit);
  return deliveryDestination(delivery)
    || firstHubName(
      delivery.assignedHubName,
      delivery.assignedHub,
      delivery.hubName,
      delivery.hub,
      transit.destinationWarehouse,
    );
}

export function getShipmentTrackingNumber(value: unknown): string {
  return trackingNumber(value);
}

function trackingNumber(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  const shipment = recordOf(value);
  return text(shipment.trackingNumber ?? shipment.tracking ?? shipment.barcode ?? shipment.awb ?? shipment.number).trim();
}

export function parseSystemSeal(value: unknown): LoadingCheckSeal | null {
  if (!value || typeof value !== 'object') return null;
  const item = recordOf(value);
  const seal = recordOf(item.seal);
  const details = recordOf(item.data ?? item.details);
  const number = text(
    item.sealNumber ?? item.sealCode ?? item.code ?? item.number ?? item.sealName
      ?? seal.sealNumber ?? seal.sealCode ?? seal.code ?? seal.number ?? seal.sealName
      ?? details.sealNumber ?? details.sealCode ?? details.code,
  ).trim();
  if (!number) return null;

  const rawState = item.state ?? item.status ?? item.workflowStatus ?? seal.state ?? seal.status ?? details.state ?? 'Unknown';
  const state = typeof rawState === 'object'
    ? text(recordOf(rawState).value ?? recordOf(rawState).name ?? recordOf(rawState).status ?? 'Unknown')
    : text(rawState);
  const shipmentRows = item.deliveries ?? item.shipments ?? item.packages ?? item.trackingNumbers ?? item.initialTrackingNumbers
    ?? seal.deliveries ?? seal.shipments ?? seal.packages ?? seal.trackingNumbers ?? seal.initialTrackingNumbers;
  const packages = item.initialTrackingNumbersCount ?? item.packagesCount ?? item.numberOfPackages ?? item.noOfPackages
    ?? item.numberOfShipments ?? item.numberOfDeliveries ?? item.shipmentCount ?? item.deliveryCount
    ?? item.deliveriesCount ?? item.shipmentsCount ?? (Array.isArray(shipmentRows) ? shipmentRows.length : '');
  const assigned = item.assignedHub ?? seal.assignedHub ?? item.hub;
  const source = item.sourceWarehouse ?? item.sourceHub ?? item.originWarehouse ?? item.source ?? seal.sourceWarehouse ?? seal.sourceHub;
  const sourceName = text(item.sourceHubName ?? item.sourceWarehouseName ?? seal.sourceHubName ?? seal.sourceWarehouseName)
    || hubName(source) || text(item.source);
  const destination = recordOf(item.destinationWarehouse ?? item.destinationHub ?? seal.destinationWarehouse);
  const shipments = Array.isArray(shipmentRows) ? shipmentRows : [];
  const destinationValue = item.destinationWarehouse ?? item.destinationHub ?? seal.destinationWarehouse ?? seal.destinationHub;
  const sealDestinationValue = seal.destinationWarehouse ?? seal.destinationHub;
  const assignedHub = firstHubName(
    item.assignedHubName,
    item.hubName,
    seal.assignedHubName,
    assigned,
  ) || shipments.map(getShipmentHubName).find(Boolean)
    || firstHubName(item.destinationWarehouseName, item.destinationHubName, destination, item.destination)
    || firstHubName(seal.destinationWarehouseName, seal.destinationHubName, sealDestinationValue, seal.destination);
  const destinationHubId = [
    item.destinationWarehouseId,
    item.destinationHubId,
    destination._id,
    destination.id,
    hubId(destinationValue),
    seal.destinationWarehouseId,
    seal.destinationHubId,
    hubId(sealDestinationValue),
    ...shipments.map((shipment) => {
      const shipmentRow = recordOf(shipment);
      const shipmentTransit = recordOf(shipmentRow.warehouseTransit);
      return shipmentRow.destinationWarehouseId ?? shipmentRow.destinationHubId
        ?? hubId(shipmentRow.destinationWarehouse ?? shipmentRow.destinationHub ?? shipmentTransit.destinationWarehouse);
    }),
  ].map((value) => text(value).trim()).find(Boolean) || '';
  const shipmentTrackingNumbers = Array.from(new Set(shipments.map(trackingNumber).filter(Boolean)));
  const shipmentIds = Array.from(new Set(shipments.map((shipment) => {
    const row = recordOf(shipment);
    return text(row._id ?? row.id).trim();
  }).filter(Boolean)));

  return {
    number,
    type: text(item.type ?? item.sealType ?? seal.type ?? seal.sealType ?? details.type),
    packages: text(packages),
    state: state || 'Unknown',
    source: sourceName,
    destination: text(item.destinationWarehouseName ?? item.destinationHubName ?? destination.name)
      || hubName(item.destinationWarehouse ?? item.destinationHub) || text(item.destination),
    assignedHub,
    destinationHubId,
    shipmentTrackingNumbers,
    shipmentIds,
    updated: text(item.updatedAt ?? item.updated_at ?? item.lastUpdate ?? item.createdAt ?? seal.updatedAt ?? seal.createdAt ?? ''),
  };
}

export function normalizeSystemSeals(value: unknown): LoadingCheckSeal[] {
  const unique = new Map<string, LoadingCheckSeal>();
  findSystemSealRows(value).forEach((row) => {
    const seal = parseSystemSeal(row);
    if (seal) unique.set(normalizeSealKey(seal.number), seal);
  });
  return Array.from(unique.values());
}

export function enrichLoadingCheckEntries(
  entries: LoadingCheckEnrichmentEntry[],
  seals: Array<Pick<LoadingCheckSeal, 'number' | 'assignedHub'>>,
): LoadingCheckEnrichmentUpdate[] {
  const byNumber = new Map(seals.map((seal) => [normalizeSealKey(seal.number), seal.assignedHub]));
  return entries.flatMap((entry) => {
    const assignedHub = byNumber.get(entry.sealKey);
    return !assignedHub ? [] : [{ ...entry, assignedHub }];
  });
}

export function enrichLoadingCheckRows(
  rows: string[][],
  seals: Array<Pick<LoadingCheckSeal, 'number' | 'assignedHub'>>,
): LoadingCheckEnrichmentUpdate[] {
  const entries: LoadingCheckEnrichmentEntry[] = [];
  rows.forEach((row, rowIndex) => {
    for (let sealColumn = 0; sealColumn < row.length; sealColumn += LOADING_CHECK_BLOCK_WIDTH) {
      const sealKey = normalizeSealKey(row[sealColumn]);
      if (sealKey) entries.push({ row: rowIndex, sealColumn, sealKey });
    }
  });
  return enrichLoadingCheckEntries(entries, seals);
}

export function columnName(index: number): string {
  let result = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    result = String.fromCharCode(65 + (value - 1) % 26) + result;
  }
  return result;
}

export function columnIndex(name: string): number {
  let result = 0;
  for (const character of name.toUpperCase()) result = result * 26 + character.charCodeAt(0) - 64;
  return result - 1;
}

class ArithmeticParser {
  private readonly tokens: string[];
  private index = 0;

  constructor(private readonly expression: string) {
    this.tokens = expression.match(/\d+(?:\.\d+)?|[()+*/-]/g) || [];
    if (this.tokens.join('') !== expression.replace(/\s/g, '')) throw new Error('Invalid formula');
  }

  parse(): number {
    const value = this.sum();
    if (this.index !== this.tokens.length) throw new Error('Invalid formula');
    return value;
  }

  private sum(): number {
    let value = this.product();
    while (this.tokens[this.index] === '+' || this.tokens[this.index] === '-') {
      const operation = this.tokens[this.index++];
      const next = this.product();
      value = operation === '+' ? value + next : value - next;
    }
    return value;
  }

  private product(): number {
    let value = this.atom();
    while (this.tokens[this.index] === '*' || this.tokens[this.index] === '/') {
      const operation = this.tokens[this.index++];
      const next = this.atom();
      value = operation === '*' ? value * next : value / next;
    }
    return value;
  }

  private atom(): number {
    const token = this.tokens[this.index++];
    if (token === '-') return -this.atom();
    if (token === '+') return this.atom();
    if (token === '(') {
      const value = this.sum();
      if (this.tokens[this.index++] !== ')') throw new Error('Invalid formula');
      return value;
    }
    if (!token || !/^\d/.test(token)) throw new Error('Invalid formula');
    return Number(token);
  }
}

export function formulaValue(raw: string, rows: string[][]): string {
  if (!raw.startsWith('=')) return raw;
  const expression = raw.slice(1).trim();
  if (!/^[\dA-Z()+\-*/.\s]+$/i.test(expression)) return '#VALUE!';
  const expanded = expression.replace(/\b([A-Z]+)(\d+)\b/gi, (_match, column: string, rowNumber: string) => {
    const value = rows[Number(rowNumber) - 1]?.[columnIndex(column)] ?? '';
    return /^-?\d+(\.\d+)?$/.test(String(value)) ? String(value) : '0';
  });
  if (!/^[\d()+\-*/.\s]+$/.test(expanded)) return '#VALUE!';
  try {
    const result = new ArithmeticParser(expanded).parse();
    return Number.isFinite(result) ? String(Number(result.toFixed(8))) : '#VALUE!';
  } catch {
    return '#VALUE!';
  }
}

export function isDispatchedSealState(value: string): boolean {
  return /dispatch|transfer|transit|closed|delivered|sent|on[\s_-]?way/i.test(value);
}
