import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  getBostaConnection, getBostaDispatchSealsPage, getBostaHubs, getBostaMasterSealManifest,
  getBostaMasterSealsPage,
} from '../services/api';
import type { BostaHubOption } from '../services/api';
import { useWrongShipmentsConfig } from '../contexts/WrongShipmentsContext';
import type { MasterSealDispatch, MasterSealManifest, MasterSealManifestSeal } from '../types/dispatch';
import { downloadBlob, escapeCsv } from '../utils/exportUtils';

const PAGE_LIMIT = 50;
const MANIFEST_DATE_STORAGE_KEY = 'bosta-mainfest-dispatch-date';
const SOURCE_BRANCHES = ['Alexandria', 'Smouha', 'Khorshid', 'El Agamy', 'Box-Agmy', 'Box-Alexandria', 'FM Alexandria'];
const ALEX_HUB_ID_FALLBACK = '030000000133';
const ALEX_HUB_NAME = 'Alex Sorting Facility';

type HubTarget = { id: string; name: string; branch: string };
type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
}

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

function canonicalBranchName(name: string): string {
  const value = normalize(name);
  if (value.includes('smouha')) return 'Smouha';
  if (value.includes('khorshid')) return 'Khorshid';
  if (value.includes('boxagmy') || value.includes('boxagamy') || value.includes('boxelagmy')) return 'Box-Agmy';
  if (value.includes('boxalex')) return 'Box-Alexandria';
  if (value.includes('fmalex')) return 'FM Alexandria';
  if (value.includes('elagmy') || value.includes('elagamy') || value.includes('agmy') || value.includes('agamy')) return 'El Agamy';
  if (value.includes('alexandria') && !value.includes('sorting')) return 'Alexandria';
  if (value === 'cairosortingfacility') return 'Cairo Sorting Facility';
  return name || 'Unknown source branch';
}

function egyptDayRange(date: string): { start: string; end: string } {
  const toUtc = (hour: number, minute: number, second: number) => {
    const [year, month, day] = date.split('-').map(Number);
    const targetUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(targetUtc));
    const part = (type: string) => Number(parts.find((item) => item.type === type)?.value || 0);
    const cairoAsUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
    return new Date(targetUtc - (cairoAsUtc - targetUtc)).toISOString().replace('.000Z', '+00:00');
  };
  return { start: toUtc(0, 0, 0), end: toUtc(23, 59, 59) };
}

function egyptToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function savedManifestDate(): string {
  try {
    const saved = window.localStorage.getItem(MANIFEST_DATE_STORAGE_KEY) || '';
    return /^\d{4}-\d{2}-\d{2}$/.test(saved) ? saved : egyptToday();
  } catch {
    return egyptToday();
  }
}

function persistManifestDate(date: string): void {
  try {
    if (date === egyptToday()) window.localStorage.removeItem(MANIFEST_DATE_STORAGE_KEY);
    else window.localStorage.setItem(MANIFEST_DATE_STORAGE_KEY, date);
  } catch {
    // The active page state still works when browser storage is unavailable.
  }
}

function findRows(value: unknown, depth = 0): RecordValue[] {
  if (depth > 5 || value == null) return [];
  if (Array.isArray(value)) return value.filter((row): row is RecordValue => Boolean(row && typeof row === 'object' && !Array.isArray(row)));
  if (typeof value !== 'object') return [];
  const record = value as RecordValue;
  for (const key of ['masterSeals', 'data', 'result', 'message', 'seals', 'items', 'results']) {
    const rows = findRows(record[key], depth + 1);
    if (rows.length) return rows;
  }
  for (const nested of Object.values(record)) {
    const rows = findRows(nested, depth + 1);
    if (rows.length) return rows;
  }
  return [];
}

function mapMasterSeals(value: unknown, destinationHubId: string): MasterSealDispatch[] {
  return findRows(value).map((row, index) => ({
    _id: String(row._id ?? row.id ?? `master-${destinationHubId}-${index}`),
    sealNumber: String(row.sealNumber ?? ''),
    sourceHubName: String(row.sourceHubName ?? ''),
    destinationHubName: String(row.destinationHubName ?? ''),
    sourceHubId: String(row.sourceHubId ?? row.sourceWarehouseId ?? ''),
    destinationHubId: String(row.destinationHubId ?? row.destinationWarehouseId ?? destinationHubId),
    createdAt: String(row.createdAt ?? ''),
    openedAt: row.openedAt ? String(row.openedAt) : undefined,
    normalSealsCount: Number(row.normalSealsCount ?? 0),
    bulkySealsCount: Number(row.bulkySealsCount ?? 0),
    passthroughSealsCount: Number(row.passthroughSealsCount ?? 0),
    transitTime: (row.transitTime as MasterSealDispatch['transitTime']) ?? null,
  })).filter((row) => row.sealNumber);
}

function hubTargets(hubs: BostaHubOption[], direction: 'to-alex' | 'from-alex'): { alex: HubTarget; destinations: HubTarget[] } {
  const alexHub = hubs.find((hub) => normalize(hub.name) === 'alexsortingfacility');
  const alex: HubTarget = {
    id: alexHub?.id || ALEX_HUB_ID_FALLBACK,
    name: alexHub?.name || ALEX_HUB_NAME,
    branch: ALEX_HUB_NAME,
  };
  const destinations = direction === 'to-alex'
    ? [alex]
    : hubs.flatMap((hub) => {
      const branch = canonicalBranchName(hub.name);
      const isCairoSorting = normalize(hub.name) === 'cairosortingfacility';
      if (!SOURCE_BRANCHES.includes(branch) && !isCairoSorting) return [];
      return [{ id: hub.id, name: hub.name, branch: isCairoSorting ? 'Cairo Sorting Facility' : branch }];
    });
  return { alex, destinations };
}

function isForDirection(master: MasterSealDispatch, direction: 'to-alex' | 'from-alex', target: HubTarget, alex: HubTarget): boolean {
  if (direction === 'to-alex') {
    return (master.destinationHubId === alex.id || normalize(master.destinationHubName).includes('alexsortingfacility'));
  }
  return (master.sourceHubId === alex.id || normalize(master.sourceHubName).includes('alexsortingfacility'))
    && (master.destinationHubId === target.id || normalize(master.destinationHubName) === normalize(target.name));
}

function trackingNumbersFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((shipment) => {
    if (typeof shipment === 'string' || typeof shipment === 'number') return String(shipment);
    const record = asRecord(shipment);
    return String(record.trackingNumber ?? record.tracking ?? record.barcode ?? record.awb ?? '');
  }).filter(Boolean);
}

function normalizeManifest(value: unknown, master: MasterSealDispatch, targetName: string): MasterSealManifest {
  const root = asRecord(value);
  const rootData = asRecord(root.data);
  const rootResult = asRecord(root.result);
  const manifest = asRecord(root.masterSealManifest ?? rootData.masterSealManifest ?? rootResult.masterSealManifest);
  if (!Object.keys(manifest).length) throw new Error('The response did not include masterSealManifest.');
  if (root.success === false) throw new Error(String(root.message || 'Manifest request failed.'));

  const seals = Array.isArray(manifest.seals) ? manifest.seals.map(asRecord) : [];
  const target = normalize(targetName);
  const destinationSeals = seals.filter((seal) => normalize(String(seal.destinationHubName ?? '')) === target);
  const expected = Number(manifest.expectedTrackingNumbersCount ?? 0);
  const received = Number(manifest.receivedTrackingNumbersCount ?? 0);
  const missed = Number(manifest.missedTrackingNumberCount ?? 0);
  const selected = seals.length ? destinationSeals : [];

  return {
    sealNumber: String(manifest.sealNumber ?? master.sealNumber),
    sourceHubName: String(manifest.sourceHubName ?? master.sourceHubName),
    destinationHubName: String(manifest.destinationHubName ?? targetName),
    createdAt: String(manifest.createdAt ?? master.createdAt),
    expectedTrackingNumbersCount: seals.length ? selected.reduce((sum, seal) => sum + Number(seal.expectedTrackingNumbersCount ?? 0), 0) : expected,
    receivedTrackingNumbersCount: seals.length ? selected.reduce((sum, seal) => sum + Number(seal.receivedTrackingNumbersCount ?? 0), 0) : received,
    missedTrackingNumberCount: seals.length ? selected.reduce((sum, seal) => sum + Number(seal.missedTrackingNumberCount ?? 0), 0) : missed,
    seals: selected.map((seal): MasterSealManifestSeal => ({
      sealNumber: String(seal.sealNumber ?? ''),
      destinationHubName: String(seal.destinationHubName ?? targetName),
      sealType: String(seal.sealType ?? ''),
      expectedTrackingNumbersCount: Number(seal.expectedTrackingNumbersCount ?? 0),
      receivedTrackingNumbersCount: Number(seal.receivedTrackingNumbersCount ?? 0),
      missedTrackingNumberCount: Number(seal.missedTrackingNumberCount ?? 0),
      trackingNumbers: trackingNumbersFrom(seal.trackingNumbers ?? seal.initialTrackingNumbers ?? seal.deliveries),
    })),
  };
}

function mapChildSeal(value: RecordValue): { sealNumber: string; destinationHubName: string; trackingNumbers: string[] } | null {
  const seal = asRecord(value.seal);
  const sealNumber = String(value.sealNumber ?? value.sealCode ?? value.code ?? value.number ?? seal.sealNumber ?? seal.sealCode ?? '').trim();
  if (!sealNumber) return null;
  const destination = asRecord(value.destinationWarehouse ?? value.destinationHub ?? seal.destinationWarehouse ?? seal.destinationHub);
  const shipmentRows = value.trackingNumbers ?? value.initialTrackingNumbers ?? value.deliveries ?? value.shipments
    ?? seal.trackingNumbers ?? seal.initialTrackingNumbers ?? seal.deliveries;
  return {
    sealNumber,
    destinationHubName: String(value.destinationWarehouseName ?? value.destinationHubName ?? destination.name ?? ''),
    trackingNumbers: trackingNumbersFrom(shipmentRows),
  };
}

async function fetchAllChildSeals(
  slug: string,
  sourceHubId: string,
  destinationHubId: string,
  signal: AbortSignal,
) {
  const unique = new Map<string, { sealNumber: string; destinationHubName: string; trackingNumbers: string[] }>();
  for (let page = 1; page <= 1000; page += 1) {
    const response = await getBostaDispatchSealsPage(slug, sourceHubId, page, destinationHubId, signal, true);
    const rows = findRows(response);
    rows.map(mapChildSeal).filter((seal): seal is NonNullable<typeof seal> => Boolean(seal))
      .forEach((seal) => unique.set(normalize(seal.sealNumber), seal));
    if (rows.length < 500) break;
    if (page === 1000) throw new Error('Seal search exceeded its safe page limit.');
  }
  return Array.from(unique.values());
}

export interface MasterSealBranchGroup {
  branch: string;
  dispatches: MasterSealDispatch[];
  openedDispatches: number;
  pendingDispatches: number;
  normalSeals: number;
  bulkySeals: number;
  passthroughSeals: number;
  expectedShipments: number;
  receivedShipments: number;
  missedShipments: number;
  manifestsLoaded: number;
  manifestFailures: number;
}

export type ShipmentExportCategory = 'sent' | 'received' | 'remaining';

export function useMasterSealDispatches(options?: { includeDetails?: boolean }) {
  const { organizationSlug, direction } = useWrongShipmentsConfig();
  const includeDetails = options?.includeDetails ?? true;
  const [date, setDate] = useState(() => direction === 'from-alex' ? savedManifestDate() : egyptToday());
  const dateSelectionIsManual = useRef(date !== egyptToday());
  const [dispatches, setDispatches] = useState<MasterSealDispatch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState('');
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const sequence = useRef(0);
  const selectDate = useCallback((nextDate: string) => {
    dateSelectionIsManual.current = nextDate !== egyptToday();
    if (direction === 'from-alex') persistManifestDate(nextDate);
    setDate(nextDate);
  }, [direction]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (dateSelectionIsManual.current) return;
      const today = egyptToday();
      setDate((current) => current === today ? current : today);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const requestId = ++sequence.current;
    const controller = new AbortController();
    if (!organizationSlug) {
      setDispatches([]);
      setError('Select an organization to load dispatch records.');
      return () => controller.abort();
    }

    const load = async () => {
      setIsLoading(true);
      setError('');
      setLoadingDetail(direction === 'to-alex' ? 'Loading Master Seal records destined for Alex…' : 'Loading Master Seal records from Alex…');
      if (includeDetails) setDispatches([]);
      try {
        if (!await getBostaConnection(organizationSlug)) throw new Error('Connect your Bosta token in the fixed header to load dispatch records.');
        const currentHubs = await getBostaHubs(organizationSlug);
        if (controller.signal.aborted || requestId !== sequence.current) return;
        const { alex, destinations } = hubTargets(currentHubs, direction);
        if (!destinations.length) throw new Error('None of the Wrong Shipments destination hubs, including Cairo Sorting Facility, were returned by Bosta.');

        const range = egyptDayRange(date);
        const rangeStart = Date.parse(range.start);
        const rangeEnd = Date.parse(range.end);
        const all: MasterSealDispatch[] = [];
        const targetFailures: string[] = [];
        let nextTarget = 0;
        const loadTarget = async () => {
          while (!controller.signal.aborted && requestId === sequence.current) {
            const targetIndex = nextTarget++;
            if (targetIndex >= destinations.length) return;
            const target = destinations[targetIndex];
            try {
              for (let page = 1; page <= 10000; page += 1) {
                const response = await getBostaMasterSealsPage(organizationSlug, page, target.id, range.start, range.end, controller.signal);
                if (controller.signal.aborted || requestId !== sequence.current) return;
                const rows = mapMasterSeals(response, target.id);
                const filtered = rows.filter((row) => {
                  const createdAt = Date.parse(row.createdAt);
                  return Number.isFinite(createdAt) && createdAt >= rangeStart && createdAt <= rangeEnd
                    && isForDirection(row, direction, target, alex);
                }).map((row) => direction === 'from-alex' ? { ...row, destinationHubName: target.branch } : row);
                all.push(...filtered);
                if (includeDetails) setDispatches(all.slice());
                setLoadingDetail(`Loading ${target.branch} · page ${page} · ${all.length.toLocaleString('en-US')} Master Seals`);
                if (rows.length < PAGE_LIMIT) break;
                if (page === 10000) throw new Error(`The search for ${target.name} exceeded its safe page limit.`);
              }
            } catch {
              if (controller.signal.aborted) return;
              targetFailures.push(target.branch);
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(4, destinations.length) }, () => loadTarget()));
        if (controller.signal.aborted || requestId !== sequence.current) return;
        if (targetFailures.length) setError(`Could not load Master Seal pages for: ${Array.from(new Set(targetFailures)).join(', ')}. Other destinations remain available.`);

        const uniqueMasters = Array.from(new Map(all.map((item) => [`${normalize(item.sealNumber)}:${item.destinationHubId || normalize(item.destinationHubName)}`, item])).values());
        if (!includeDetails) {
          setDispatches((current) => {
            const combined = new Map<string, MasterSealDispatch>();
            if (targetFailures.length) {
              current.forEach((item) => combined.set(`${normalize(item.sealNumber)}:${item.destinationHubId || normalize(item.destinationHubName)}`, item));
            }
            uniqueMasters.forEach((item) => combined.set(`${normalize(item.sealNumber)}:${item.destinationHubId || normalize(item.destinationHubName)}`, item));
            return Array.from(combined.values());
          });
          setLastUpdated(Date.now());
          return;
        }
        let nextManifest = 0;
        let completedManifests = 0;
        const loadManifestWorker = async () => {
          while (!controller.signal.aborted && requestId === sequence.current) {
            const index = nextManifest++;
            if (index >= uniqueMasters.length) return;
            const master = uniqueMasters[index];
            try {
              const rawManifest = await getBostaMasterSealManifest(organizationSlug, master.sealNumber, controller.signal);
              const expectedDestination = direction === 'to-alex' ? alex.name
                : currentHubs.find((hub) => hub.id === master.destinationHubId)?.name || master.destinationHubName;
              const manifest = normalizeManifest(rawManifest, master, expectedDestination);
              const reportedDestination = manifest.destinationHubName || master.destinationHubName;
              uniqueMasters[index] = normalize(reportedDestination) === normalize(expectedDestination)
                ? { ...master, manifest }
                : { ...master, excludeFromAlex: true };
            } catch (manifestError) {
              if (controller.signal.aborted) return;
              uniqueMasters[index] = {
                ...master,
                manifestError: manifestError instanceof Error ? manifestError.message : 'Could not load manifest.',
              };
            }
            completedManifests += 1;
            setLoadingDetail(`Loading Master Seal details · ${completedManifests} of ${uniqueMasters.length}`);
            setDispatches(uniqueMasters.slice());
          }
        };
        await Promise.all(Array.from({ length: Math.min(4, uniqueMasters.length) }, () => loadManifestWorker()));
        if (controller.signal.aborted || requestId !== sequence.current) return;

        const routes = new Map<string, HubTarget>();
        for (const master of uniqueMasters) {
          if (!master.manifest || master.excludeFromAlex) continue;
          if (direction === 'to-alex') {
            const branch = canonicalBranchName(master.sourceHubName);
            const hub = currentHubs.find((candidate) => canonicalBranchName(candidate.name) === branch);
            if (hub) routes.set(hub.id, { id: hub.id, name: hub.name, branch });
          } else {
            const hub = currentHubs.find((candidate) => candidate.id === master.destinationHubId)
              || currentHubs.find((candidate) => normalize(candidate.name) === normalize(master.destinationHubName));
            if (hub) routes.set(hub.id, { id: hub.id, name: hub.name, branch: canonicalBranchName(master.destinationHubName) });
          }
        }

        const routeList = Array.from(routes.values());
        let nextRoute = 0;
        let completedRoutes = 0;
        const hydrateRoute = async () => {
          while (!controller.signal.aborted && requestId === sequence.current) {
            const route = routeList[nextRoute++];
            if (!route) return;
            try {
              const sourceHubId = direction === 'to-alex' ? route.id : alex.id;
              const destinationHubId = direction === 'to-alex' ? alex.id : route.id;
              setLoadingDetail(`Loading ${route.branch} seal tracking numbers…`);
              const routeSeals = await fetchAllChildSeals(organizationSlug, sourceHubId, destinationHubId, controller.signal);
              const sealMap = new Map(routeSeals.map((seal) => [normalize(seal.sealNumber), seal]));
              for (const master of uniqueMasters) {
                const sameGroup = direction === 'to-alex'
                  ? canonicalBranchName(master.sourceHubName) === route.branch
                  : (master.destinationHubId === route.id || normalize(master.destinationHubName) === normalize(route.branch));
                if (!master.manifest || !sameGroup) continue;
                const childSeals = master.manifest.seals.map((childSeal) => {
                  const match = sealMap.get(normalize(childSeal.sealNumber));
                  if (!match) return childSeal;
                  const expectedDestination = direction === 'to-alex' ? alex.name : route.name;
                  if (match.destinationHubName && normalize(match.destinationHubName) !== normalize(expectedDestination)) return childSeal;
                  const trackingNumbers = Array.from(new Set([...(childSeal.trackingNumbers || []), ...match.trackingNumbers]
                    .map((number) => number.trim()).filter(Boolean)));
                  return { ...childSeal, trackingNumbers };
                });
                master.manifest = { ...master.manifest, seals: childSeals };
              }
            } catch {
              // Preserve manifest counts when child-seal contents cannot be loaded.
            }
            completedRoutes += 1;
            setDispatches(uniqueMasters.filter((item) => !item.excludeFromAlex).slice());
            setLoadingDetail(`Loading destination seal contents · ${completedRoutes} of ${routeList.length}`);
          }
        };
        await Promise.all(Array.from({ length: Math.min(3, routeList.length) }, () => hydrateRoute()));
        if (controller.signal.aborted || requestId !== sequence.current) return;
        setDispatches(uniqueMasters.filter((item) => !item.excludeFromAlex));
        setLastUpdated(Date.now());
      } catch (loadError) {
        if (controller.signal.aborted || requestId !== sequence.current) return;
        setError(loadError instanceof Error ? loadError.message : 'Could not load dispatch records.');
      } finally {
        if (requestId === sequence.current) {
          setIsLoading(false);
          setLoadingDetail('');
        }
      }
    };

    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [date, direction, includeDetails, organizationSlug, refreshKey]);

  const groups = useMemo(() => {
    const groupNames = direction === 'from-alex' ? [...SOURCE_BRANCHES, 'Cairo Sorting Facility'] : SOURCE_BRANCHES;
    const grouped = new Map<string, MasterSealDispatch[]>();
    for (const branch of groupNames) grouped.set(branch, []);
    for (const dispatch of dispatches) {
      const branch = canonicalBranchName(direction === 'from-alex' ? dispatch.destinationHubName : dispatch.sourceHubName);
      grouped.set(branch, [...(grouped.get(branch) || []), dispatch]);
    }
    return Array.from(grouped, ([branch, rows]): MasterSealBranchGroup => ({
      branch,
      dispatches: rows.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      openedDispatches: rows.filter((row) => Boolean(row.openedAt)).length,
      pendingDispatches: rows.filter((row) => !row.openedAt).length,
      normalSeals: rows.reduce((total, row) => total + row.normalSealsCount, 0),
      bulkySeals: rows.reduce((total, row) => total + row.bulkySealsCount, 0),
      passthroughSeals: rows.reduce((total, row) => total + row.passthroughSealsCount, 0),
      expectedShipments: rows.reduce((total, row) => total + (row.manifest?.expectedTrackingNumbersCount ?? 0), 0),
      receivedShipments: rows.reduce((total, row) => total + (row.manifest?.receivedTrackingNumbersCount ?? 0), 0),
      missedShipments: rows.reduce((total, row) => total + (row.manifest?.missedTrackingNumberCount ?? 0), 0),
      manifestsLoaded: rows.filter((row) => Boolean(row.manifest)).length,
      manifestFailures: rows.filter((row) => Boolean(row.manifestError)).length,
    })).sort((a, b) => a.branch.localeCompare(b.branch));
  }, [direction, dispatches]);

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);
  const exportShipmentCsv = useCallback((category: ShipmentExportCategory, branchName?: string) => {
    const categoryLabels: Record<ShipmentExportCategory, string> = direction === 'to-alex'
      ? { sent: 'sent-to-alex', received: 'received-at-alex', remaining: 'remaining-at-alex' }
      : { sent: 'sent-from-alex', received: 'received-at-destination', remaining: 'remaining-at-destination' };
    const rows: (string | number)[][] = [[
      'Row Type', 'Export Category', 'Date', direction === 'to-alex' ? 'Source Branch' : 'Source Hub', 'Destination', 'Master Seal', 'Child Seal', 'Seal Type',
      'Sent Count', 'Received Count', 'Remaining Count', 'Tracking Number', 'Tracking List Note',
    ]];
    const selectedGroups = branchName ? groups.filter((group) => group.branch === branchName) : groups;
    for (const group of selectedGroups) {
      for (const master of group.dispatches) {
        if (!master.manifest) continue;
        const seals = master.manifest.seals.length > 0 ? master.manifest.seals : [{
          sealNumber: '', destinationHubName: master.manifest.destinationHubName, sealType: 'Master Seal total',
          expectedTrackingNumbersCount: master.manifest.expectedTrackingNumbersCount,
          receivedTrackingNumbersCount: master.manifest.receivedTrackingNumbersCount,
          missedTrackingNumberCount: master.manifest.missedTrackingNumberCount, trackingNumbers: [],
        }];
        for (const seal of seals) {
          const categoryCount = category === 'sent' ? seal.expectedTrackingNumbersCount
            : category === 'received' ? seal.receivedTrackingNumbersCount : seal.missedTrackingNumberCount;
          if (categoryCount <= 0) continue;
          const source = direction === 'to-alex' ? group.branch : ALEX_HUB_NAME;
          const destination = direction === 'to-alex' ? ALEX_HUB_NAME : master.destinationHubName;
          rows.push([
            'SEAL SUMMARY', categoryLabels[category], date, source, destination, master.sealNumber, seal.sealNumber, seal.sealType,
            seal.expectedTrackingNumbersCount, seal.receivedTrackingNumbersCount, seal.missedTrackingNumberCount, '',
            seal.trackingNumbers?.length ? 'Counts apply to this seal; rows below list its tracking numbers.' : 'The API did not return tracking numbers for this seal.',
          ]);
          for (const trackingNumber of seal.trackingNumbers || []) rows.push([
            'TRACKING NUMBER', categoryLabels[category], date, source, destination, master.sealNumber, seal.sealNumber, seal.sealType,
            '', '', '', trackingNumber, 'Per-tracking received/remaining status is not supplied by the manifest.',
          ]);
        }
      }
    }
    if (rows.length === 1) { alert('There is no manifest data available to export for this category.'); return; }
    const csv = `\uFEFF${rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n')}`;
    const suffix = branchName ? `-${normalize(branchName)}` : '-all-destinations';
    const filename = direction === 'to-alex' ? 'alex-shipments' : 'alex-outbound-shipments';
    downloadBlob(`${filename}-${categoryLabels[category]}${suffix}-${date}.csv`, csv, 'text/csv;charset=utf-8');
  }, [date, direction, groups]);

  const exportCsv = useCallback(() => {
    const rows: (string | number)[][] = [[
      'Record Type', 'Date', direction === 'to-alex' ? 'Source Branch' : 'Source Hub', 'Destination', 'Master Seal', 'Child Seal', 'Seal Type',
      'Expected Shipments', 'Received Shipments', 'Missing Shipments', 'Manifest Status',
    ]];
    for (const group of groups) {
      if (!group.dispatches.length) continue;
      rows.push([
        'BRANCH TOTAL', date, direction === 'to-alex' ? group.branch : ALEX_HUB_NAME,
        direction === 'to-alex' ? ALEX_HUB_NAME : group.branch, '', '', '',
        group.expectedShipments, group.receivedShipments, group.missedShipments, `${group.manifestsLoaded}/${group.dispatches.length} manifests loaded`,
      ]);
      for (const master of group.dispatches) {
        rows.push([
          'MASTER SEAL', date, direction === 'to-alex' ? group.branch : ALEX_HUB_NAME,
          direction === 'to-alex' ? ALEX_HUB_NAME : master.destinationHubName, master.sealNumber, '', '',
          master.manifest?.expectedTrackingNumbersCount ?? '', master.manifest?.receivedTrackingNumbersCount ?? '',
          master.manifest?.missedTrackingNumberCount ?? '', master.manifest ? 'Loaded' : master.manifestError ? 'Failed' : 'Loading',
        ]);
        for (const seal of master.manifest?.seals || []) rows.push([
          'CHILD SEAL', date, direction === 'to-alex' ? group.branch : ALEX_HUB_NAME,
          direction === 'to-alex' ? seal.destinationHubName : master.destinationHubName, master.sealNumber, seal.sealNumber, seal.sealType,
          seal.expectedTrackingNumbersCount, seal.receivedTrackingNumbersCount, seal.missedTrackingNumberCount, master.manifest ? 'Loaded' : 'Failed',
        ]);
      }
    }
    const csv = `\uFEFF${rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n')}`;
    downloadBlob(`${direction === 'to-alex' ? 'alex-master-dispatches' : 'alex-outbound-master-dispatches'}-${date}.csv`, csv, 'text/csv;charset=utf-8');
  }, [date, direction, groups]);

  const exportMasterTrackingWorkbook = useCallback((masterSealNumber?: string) => {
    const selectedMasters = masterSealNumber
      ? dispatches.filter((master) => master.sealNumber.toLowerCase() === masterSealNumber.toLowerCase())
      : dispatches;
    const trackingRows: (string | number)[][] = [[
      'Tracking Number', direction === 'to-alex' ? 'Source Branch' : 'Source Hub', 'Destination', 'Master Seal', 'Child Seal', 'Seal Type', 'Dispatch Date',
    ]];
    const summaryRows: (string | number)[][] = [[
      direction === 'to-alex' ? 'Source Branch' : 'Source Hub', 'Master Seal', 'Child Seal', 'Seal Type', 'Expected Tracking Numbers', 'Tracking Numbers Downloaded', 'Not Returned by API',
    ]];
    for (const master of selectedMasters) {
      for (const seal of master.manifest?.seals || []) {
        const trackingNumbers = [...new Set((seal.trackingNumbers || []).map((number) => number.trim()).filter(Boolean))];
        const source = direction === 'to-alex' ? master.sourceHubName : ALEX_HUB_NAME;
        const destination = direction === 'to-alex' ? ALEX_HUB_NAME : master.destinationHubName;
        summaryRows.push([source, master.sealNumber, seal.sealNumber, seal.sealType, seal.expectedTrackingNumbersCount, trackingNumbers.length, Math.max(0, seal.expectedTrackingNumbersCount - trackingNumbers.length)]);
        for (const trackingNumber of trackingNumbers) trackingRows.push([
          trackingNumber, source, destination, master.sealNumber, seal.sealNumber, seal.sealType, master.createdAt,
        ]);
      }
    }
    if (trackingRows.length === 1) { alert('No tracking numbers were returned for these seals. An empty tracking workbook will not be created. Refresh and try again.'); return; }
    const workbook = XLSX.utils.book_new();
    const trackingSheet = XLSX.utils.aoa_to_sheet(trackingRows);
    trackingSheet['!cols'] = [{ wch: 22 }, { wch: 24 }, { wch: 28 }, { wch: 20 }, { wch: 32 }, { wch: 14 }, { wch: 24 }];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    summarySheet['!cols'] = [{ wch: 24 }, { wch: 20 }, { wch: 32 }, { wch: 14 }, { wch: 26 }, { wch: 28 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(workbook, trackingSheet, 'Tracking Numbers');
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Seal Summary');
    const suffix = masterSealNumber ? `-${masterSealNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '-all-destinations';
    XLSX.writeFile(workbook, `${direction === 'to-alex' ? 'alex-seal-tracking' : 'alex-outbound-seal-tracking'}${suffix}-${date}.xlsx`);
  }, [date, direction, dispatches]);

  return {
    date,
    setDate: selectDate,
    groups,
    dispatches,
    totalDispatches: dispatches.length,
    totalOpened: dispatches.filter((item) => Boolean(item.openedAt)).length,
    totalPending: dispatches.filter((item) => !item.openedAt).length,
    totalExpectedShipments: dispatches.reduce((total, item) => total + (item.manifest?.expectedTrackingNumbersCount ?? 0), 0),
    totalReceivedShipments: dispatches.reduce((total, item) => total + (item.manifest?.receivedTrackingNumbersCount ?? 0), 0),
    totalMissedShipments: dispatches.reduce((total, item) => total + (item.manifest?.missedTrackingNumberCount ?? 0), 0),
    totalTrackingNumbers: dispatches.reduce((total, item) => total + (item.manifest?.seals || []).reduce((sealTotal, seal) => sealTotal + (seal.trackingNumbers?.length || 0), 0), 0),
    manifestsLoaded: dispatches.filter((item) => Boolean(item.manifest)).length,
    manifestFailures: dispatches.filter((item) => Boolean(item.manifestError)).length,
    totalSeals: dispatches.reduce((total, item) => total + item.normalSealsCount + item.bulkySealsCount + item.passthroughSealsCount, 0),
    isLoading,
    loadingDetail,
    error,
    lastUpdated,
    refresh,
    exportCsv,
    exportShipmentCsv,
    exportMasterTrackingWorkbook,
  };
}
