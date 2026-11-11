import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, AlertOctagon, Building2, Clock3, Copy, Download, ExternalLink,
  KeyRound, LoaderCircle, PackageX, RefreshCw, Search, ShieldCheck, Timer, TriangleAlert,
} from 'lucide-react';
import {
  ApiError, getBostaConnection, getBostaHistoryCount,
  getBostaHistoryDetailsBatch, getBostaHistoryPage, getBostaHubs, getBostaDeliveryDetails,
  lookupBostaHistoryDeliveries,
} from '../services/api';
import type { BostaHubOption, BostaLiveDelivery } from '../services/api';
import {
  ALEX_SORTING_FACILITY_ID, ALEX_SORTING_FACILITY_NAME, buildRemovedSealItems, buildSealLogRows,
  EXAMPLE_TRACKING_NUMBERS, hasDeliveryAuditLog, analyzeTimeDeliveries,
} from '../utils/transferHistory';
import type { RemovedSealItem, SealLogRow, TimeAnalyzedItem } from '../utils/transferHistory';

type TransferHistoryTab = 'Time Analysis' | 'Removed Seals' | 'Seal Logs';
type ScopeState = {
  deliveries: BostaLiveDelivery[];
  isLoading: boolean;
  loadingDetail: string;
  error: string;
  lastUpdated: number | null;
  loadedKey: string;
};

const EMPTY_SCOPE: ScopeState = { deliveries: [], isLoading: false, loadingDetail: '', error: '', lastUpdated: null, loadedKey: '' };
const PAGE_LIMIT = 100;
const MAX_PAGES = 1000;
const DETAILS_PER_REQUEST = 100;
const DETAILS_REQUESTS_AT_ONCE = 10;

function deliveryKey(delivery: BostaLiveDelivery): string {
  return String(delivery.trackingNumber || delivery._id || '').trim();
}

function uniqueDeliveries(deliveries: BostaLiveDelivery[]): BostaLiveDelivery[] {
  const unique = new Map<string, BostaLiveDelivery>();
  deliveries.forEach((delivery, index) => {
    const key = deliveryKey(delivery) || `row-${index}`;
    if (!unique.has(key)) unique.set(key, delivery);
  });
  return Array.from(unique.values());
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const timer = window.setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    const abort = () => { window.clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function fetchPageWithRetry(
  organizationSlug: string,
  hubId: string,
  stateCodes: string[],
  page: number,
  signal: AbortSignal,
): Promise<BostaLiveDelivery[]> {
  try {
    return await getBostaHistoryPage(organizationSlug, hubId, stateCodes, page, PAGE_LIMIT, signal);
  } catch (error) {
    if (signal.aborted || error instanceof ApiError && error.status === 400) throw error;
    await delay(600, signal);
    return getBostaHistoryPage(organizationSlug, hubId, stateCodes, page, PAGE_LIMIT, signal);
  }
}

async function fetchHistoryScope(
  organizationSlug: string,
  hubId: string,
  stateCodes: string[],
  concurrency: number,
  signal: AbortSignal,
  onProgress: (detail: string) => void,
): Promise<BostaLiveDelivery[]> {
  const totalCount = await getBostaHistoryCount(organizationSlug, hubId, stateCodes, signal);
  const totalPages = Math.min(MAX_PAGES, Math.max(1, Math.ceil(totalCount / PAGE_LIMIT)));
  let deliveries: BostaLiveDelivery[] = [];
  let lastPageRows: BostaLiveDelivery[] = [];
  let completedPages = 0;

  if (totalCount === 0) {
    onProgress('Count endpoint returned zero; checking search pages directly…');
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      lastPageRows = await fetchPageWithRetry(organizationSlug, hubId, stateCodes, page, signal);
      if (!lastPageRows.length) break;
      deliveries = uniqueDeliveries([...deliveries, ...lastPageRows]);
      completedPages = page;
      onProgress(`Fetching shipments · page ${completedPages.toLocaleString()} · ${deliveries.length.toLocaleString()} loaded`);
      if (lastPageRows.length < PAGE_LIMIT) break;
    }
    return deliveries;
  }

  onProgress(`Fetching ${totalCount.toLocaleString()} shipments across ${totalPages.toLocaleString()} pages…`);
  lastPageRows = await fetchPageWithRetry(organizationSlug, hubId, stateCodes, 1, signal);
  deliveries = uniqueDeliveries(lastPageRows);
  completedPages = 1;
  onProgress(`Fetched page 1/${totalPages.toLocaleString()} · ${deliveries.length.toLocaleString()} shipments`);

  for (let first = 2; first <= totalPages; first += concurrency) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const pageNumbers = Array.from({ length: Math.min(concurrency, totalPages - first + 1) }, (_, offset) => first + offset);
    const batches = await Promise.all(pageNumbers.map((page) => fetchPageWithRetry(organizationSlug, hubId, stateCodes, page, signal)));
    lastPageRows = batches[batches.length - 1] || [];
    deliveries = uniqueDeliveries([...deliveries, ...batches.flat()]);
    completedPages += pageNumbers.length;
    onProgress(`Fetched page ${completedPages.toLocaleString()}/${totalPages.toLocaleString()} · ${deliveries.length.toLocaleString()} shipments`);
  }

  let nextPage = totalPages + 1;
  while (lastPageRows.length === PAGE_LIMIT && nextPage <= MAX_PAGES) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    lastPageRows = await fetchPageWithRetry(organizationSlug, hubId, stateCodes, nextPage, signal);
    deliveries = uniqueDeliveries([...deliveries, ...lastPageRows]);
    onProgress(`Checking additional pages · ${deliveries.length.toLocaleString()} shipments`);
    nextPage += 1;
  }
  return deliveries;
}

function chunks<T>(rows: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, (index + 1) * size));
}

function mergeDeliveryDetails(base: BostaLiveDelivery, detail: BostaLiveDelivery): BostaLiveDelivery {
  const merged = { ...base, ...detail } as BostaLiveDelivery & Record<string, unknown>;
  const historyKeys = [
    'stateHistory', 'history', 'states', 'timeline', 'events', 'logs', 'trackingHistory',
    'deliveryHistory', 'trackingEvents', 'stateLogs', 'auditLogs', 'sealHistory', 'sealEvents', 'activities', 'activityLog',
  ];
  historyKeys.forEach((key) => {
    const incoming = detail[key];
    const existing = base[key];
    if ((!Array.isArray(incoming) || incoming.length === 0) && Array.isArray(existing) && existing.length) merged[key] = existing;
  });
  if ((!detail.log || detail.log.length === 0) && base.log?.length) merged.log = base.log;
  return merged;
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: unknown[][]): void {
  const content = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function dateTimeInCairo(date: Date | null): string {
  return date ? date.toLocaleString('en-GB', { timeZone: 'Africa/Cairo' }) : '—';
}

function dateInCairo(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function timeInCairo(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

function assignedHubOf(delivery: BostaLiveDelivery): { id: string; name: string } {
  const assignedHub = delivery.assignedHub as Record<string, unknown> | undefined;
  return { id: String(assignedHub?._id || ''), name: String(assignedHub?.name || delivery.assignedHubName || delivery.destinationHub?.name || delivery.hub?.name || 'Unspecified (Unassigned)') };
}

function categoryLabel(category: TimeAnalyzedItem['timeInfo']['delayCategory']): string {
  if (category === 'gt3') return 'Critical · over 3h';
  if (category === 'gt2') return 'Late · over 2h';
  if (category === 'gt1') return 'Late · over 1h';
  return 'Within 1h';
}

function categoryClass(category: TimeAnalyzedItem['timeInfo']['delayCategory']): string {
  return `time-delay-pill ${category}`;
}

export const TransferHistorySection: React.FC<{ organizationSlug: string; tab: TransferHistoryTab }> = ({ organizationSlug, tab }) => {
  const [connection, setConnection] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [connectionError, setConnectionError] = useState('');
  const [hubs, setHubs] = useState<BostaHubOption[]>([]);
  const [selectedHubId, setSelectedHubId] = useState(ALEX_SORTING_FACILITY_ID);
  const [timeScope, setTimeScope] = useState<ScopeState>(EMPTY_SCOPE);
  const [removedScope, setRemovedScope] = useState<ScopeState>(EMPTY_SCOPE);
  const [timeRefresh, setTimeRefresh] = useState(0);
  const [removedRefresh, setRemovedRefresh] = useState(0);
  const [sealRows, setSealRows] = useState<SealLogRow[]>([]);
  const [sealLogError, setSealLogError] = useState('');
  const [sealLogLoading, setSealLogLoading] = useState(false);
  const [sealLogDetail, setSealLogDetail] = useState('');
  const [sealLogUpdatedAt, setSealLogUpdatedAt] = useState<number | null>(null);
  const [sealProcessedKey, setSealProcessedKey] = useState('');
  const timeCache = useRef(new Map<string, BostaLiveDelivery[]>());
  const removedCache = useRef(new Map<string, BostaLiveDelivery[]>());
  const [delayFilter, setDelayFilter] = useState<'ALL' | 'gt1' | 'gt2' | 'gt3'>('ALL');
  const [assignedHubFilter, setAssignedHubFilter] = useState('ALL');
  const [timeSearch, setTimeSearch] = useState('');
  const [removedSearch, setRemovedSearch] = useState('');
  const [sealHubFilter, setSealHubFilter] = useState('ALL');
  const [sealBusinessSearch, setSealBusinessSearch] = useState('');
  const [sealDateFrom, setSealDateFrom] = useState('');
  const [sealDateTo, setSealDateTo] = useState('');
  const [sealTimeFrom, setSealTimeFrom] = useState('');
  const [sealTimeTo, setSealTimeTo] = useState('');
  const [sealRemovalFilter, setSealRemovalFilter] = useState<'ALL' | 'REMOVED'>('ALL');
  const timeScopeKey = `${organizationSlug}|${selectedHubId}|24&5`;
  const removedScopeKey = `${organizationSlug}|${ALEX_SORTING_FACILITY_ID}|24&5,24`;
  const wantsTimeScope = tab === 'Time Analysis' || tab === 'Seal Logs';

  useEffect(() => {
    let active = true;
    setConnection('checking');
    setConnectionError('');
    setTimeScope(EMPTY_SCOPE);
    setRemovedScope(EMPTY_SCOPE);
    setSealRows([]);
    setSealProcessedKey('');
    timeCache.current.clear();
    removedCache.current.clear();
    getBostaConnection(organizationSlug)
      .then(async (connected) => {
        if (!active) return;
        setConnection(connected ? 'connected' : 'disconnected');
        if (!connected) return;
        const options = await getBostaHubs(organizationSlug).catch(() => []);
        if (!active) return;
        setHubs(options);
        setSelectedHubId(options.find((hub) => hub.id === ALEX_SORTING_FACILITY_ID)?.id || options[0]?.id || ALEX_SORTING_FACILITY_ID);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setConnection('disconnected');
        setConnectionError(error instanceof Error ? error.message : 'Could not check the Bosta connection.');
      });
    return () => { active = false; };
  }, [organizationSlug]);

  useEffect(() => {
    if (connection !== 'connected' || !wantsTimeScope || !selectedHubId || timeScope.loadedKey === timeScopeKey) return;
    const controller = new AbortController();
    const cached = timeRefresh === 0 ? timeCache.current.get(timeScopeKey) : undefined;
    if (cached) {
      setTimeScope({ deliveries: cached, isLoading: false, loadingDetail: '', error: '', lastUpdated: Date.now(), loadedKey: timeScopeKey });
      return () => controller.abort();
    }
    setTimeScope((current) => ({ ...current, isLoading: true, loadingDetail: 'Preparing Time Analysis shipment search…', error: '' }));
    fetchHistoryScope(organizationSlug, selectedHubId, ['24&5'], 12, controller.signal, (loadingDetail) => {
      setTimeScope((current) => ({ ...current, loadingDetail }));
    }).then((deliveries) => {
      if (controller.signal.aborted) return;
      const unique = uniqueDeliveries(deliveries);
      timeCache.current.set(timeScopeKey, unique);
      setTimeScope({ deliveries: unique, isLoading: false, loadingDetail: '', error: '', lastUpdated: Date.now(), loadedKey: timeScopeKey });
    }).catch((error: unknown) => {
      if (controller.signal.aborted || (error as Error)?.name === 'AbortError') return;
      setTimeScope((current) => ({ ...current, isLoading: false, loadingDetail: '', error: error instanceof Error ? error.message : 'Could not load Ready to Dispatch shipments.' }));
    });
    return () => controller.abort();
  }, [connection, organizationSlug, selectedHubId, timeRefresh, timeScope.loadedKey, timeScopeKey, wantsTimeScope]);

  useEffect(() => {
    if (connection !== 'connected' || tab !== 'Removed Seals' || removedScope.loadedKey === removedScopeKey) return;
    const controller = new AbortController();
    const cached = removedRefresh === 0 ? removedCache.current.get(removedScopeKey) : undefined;
    if (cached) {
      setRemovedScope({ deliveries: cached, isLoading: false, loadingDetail: '', error: '', lastUpdated: Date.now(), loadedKey: removedScopeKey });
      return () => controller.abort();
    }
    setRemovedScope((current) => ({ ...current, isLoading: true, loadingDetail: 'Looking up prior seal history samples…', error: '' }));
    void (async () => {
      let examples: BostaLiveDelivery[] = [];
      let exampleLookupError = '';
      try {
        const candidates = await lookupBostaHistoryDeliveries(organizationSlug, ALEX_SORTING_FACILITY_ID, EXAMPLE_TRACKING_NUMBERS, controller.signal);
        const rowsWithId = candidates.filter((row) => row._id);
        const details = await getBostaHistoryDetailsBatch(organizationSlug, rowsWithId.map((row) => row._id), controller.signal);
        const detailById = new Map<string, BostaLiveDelivery>(details.map((detail) => [detail._id, detail] as const));
        const missing = rowsWithId.filter((row) => !detailById.has(row._id));
        const fallbacks = await Promise.all(missing.map(async (row) => {
          if (controller.signal.aborted) return null;
          try { return await getBostaDeliveryDetails(organizationSlug, row._id); } catch { return null; }
        }));
        fallbacks.forEach((detail) => { if (detail) detailById.set(detail._id, detail); });
        examples = rowsWithId.flatMap((scanRow) => {
          const detail = detailById.get(scanRow._id);
          const rawRecord = scanRow as Record<string, unknown>;
          const nested = rawRecord.delivery || rawRecord.shipment || rawRecord.data;
          const raw = { ...(nested && typeof nested === 'object' ? nested as Record<string, unknown> : {}), ...rawRecord } as BostaLiveDelivery;
          return detail || raw ? [{ ...raw, ...detail, _id: detail?._id || scanRow._id }] as BostaLiveDelivery[] : [];
        });
      } catch (error) {
        exampleLookupError = error instanceof Error ? error.message : 'Tracking-number lookup failed.';
      }
      if (controller.signal.aborted) return;

      let baseDeliveries: BostaLiveDelivery[] = [];
      let searchError = '';
      try {
        baseDeliveries = await fetchHistoryScope(organizationSlug, ALEX_SORTING_FACILITY_ID, ['24&5', '24'], 6, controller.signal, (loadingDetail) => {
          setRemovedScope((current) => ({ ...current, loadingDetail }));
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        searchError = error instanceof Error ? error.message : 'Alex Sorting Facility shipment search failed.';
      }
      if (controller.signal.aborted) return;

      const verifiedKeys = new Set(examples.filter(hasDeliveryAuditLog).map(deliveryKey));
      const rowsNeedingDetails = baseDeliveries.filter((delivery) => delivery._id && !hasDeliveryAuditLog(delivery) && !verifiedKeys.has(deliveryKey(delivery)));
      const hydratedBase = new Map<string, BostaLiveDelivery>();
      const waveSize = DETAILS_PER_REQUEST * DETAILS_REQUESTS_AT_ONCE;
      for (let index = 0; index < rowsNeedingDetails.length; index += waveSize) {
        if (controller.signal.aborted) return;
        const wave = rowsNeedingDetails.slice(index, index + waveSize);
        setRemovedScope((current) => ({
          ...current,
          loadingDetail: `Loading audit history ${Math.min(index + wave.length, rowsNeedingDetails.length).toLocaleString()}/${rowsNeedingDetails.length.toLocaleString()} shipments · ${DETAILS_PER_REQUEST} per request`,
        }));
        const batches = chunks(wave, DETAILS_PER_REQUEST);
        const detailBatches = await Promise.all(batches.map(async (batch) => {
          try { return await getBostaHistoryDetailsBatch(organizationSlug, batch.map((row) => row._id), controller.signal); } catch { return []; }
        }));
        const detailById = new Map<string, BostaLiveDelivery>(detailBatches.flat().map((detail) => [detail._id, detail] as const));
        wave.forEach((base) => {
          const detail = detailById.get(base._id);
          hydratedBase.set(deliveryKey(base), detail ? mergeDeliveryDetails(base, detail) : base);
        });
      }

      const hydratedKeys = new Set(hydratedBase.keys());
      const untouched = baseDeliveries.filter((delivery) => !hydratedKeys.has(deliveryKey(delivery)));
      const mergedByTracking = new Map<string, BostaLiveDelivery>();
      [...untouched, ...hydratedBase.values(), ...examples].forEach((delivery) => {
        const key = deliveryKey(delivery);
        if (!key) return;
        const previous = mergedByTracking.get(key);
        mergedByTracking.set(key, previous ? mergeDeliveryDetails(previous, delivery) : delivery);
      });
      const finalRows = Array.from(mergedByTracking.values());
      removedCache.current.set(removedScopeKey, finalRows);
      setRemovedScope({
        deliveries: finalRows, isLoading: false, loadingDetail: '',
        error: baseDeliveries.length === 0 && examples.length === 0 && searchError && exampleLookupError
          ? `${searchError} Tracking lookup: ${exampleLookupError}` : '',
        lastUpdated: Date.now(), loadedKey: removedScopeKey,
      });
    })().catch((error: unknown) => {
      if (controller.signal.aborted || (error as Error)?.name === 'AbortError') return;
      setRemovedScope((current) => ({ ...current, isLoading: false, loadingDetail: '', error: error instanceof Error ? error.message : 'Could not load Alex Sorting Facility shipment history.' }));
    });
    return () => controller.abort();
  }, [connection, organizationSlug, removedRefresh, removedScope.loadedKey, removedScopeKey, tab]);

  useEffect(() => {
    if (connection !== 'connected' || tab !== 'Seal Logs' || timeScope.isLoading || timeScope.loadedKey !== timeScopeKey || sealProcessedKey === timeScope.loadedKey) return;
    const controller = new AbortController();
    const sourceDeliveries = timeScope.deliveries;
    const rowsNeedingDetails = sourceDeliveries.filter((delivery) => delivery._id && !hasDeliveryAuditLog(delivery));
    setSealLogLoading(true);
    setSealLogDetail('');
    setSealLogError(timeScope.error);
    void (async () => {
      try {
        const detailedById = new Map<string, BostaLiveDelivery>();
        const waveSize = DETAILS_PER_REQUEST * DETAILS_REQUESTS_AT_ONCE;
        for (let index = 0; index < rowsNeedingDetails.length; index += waveSize) {
          if (controller.signal.aborted) return;
          const wave = rowsNeedingDetails.slice(index, index + waveSize);
          setSealLogDetail(`Loading audit logs ${Math.min(index + wave.length, rowsNeedingDetails.length).toLocaleString()}/${rowsNeedingDetails.length.toLocaleString()} shipments · ${DETAILS_PER_REQUEST} per request · ${DETAILS_REQUESTS_AT_ONCE} requests at once`);
          const batches = chunks(wave, DETAILS_PER_REQUEST);
          const detailBatches = await Promise.all(batches.map(async (batch) => {
            try { return await getBostaHistoryDetailsBatch(organizationSlug, batch.map((row) => row._id), controller.signal); } catch { return []; }
          }));
          detailBatches.flat().forEach((detail) => detailedById.set(detail._id, detail));
        }
        if (controller.signal.aborted) return;
        const hydrated = sourceDeliveries.map((delivery) => {
          const detail = detailedById.get(delivery._id);
          return detail ? mergeDeliveryDetails(delivery, detail) : delivery;
        });
        setSealRows(buildSealLogRows(hydrated));
        setSealLogUpdatedAt(Date.now());
        setSealProcessedKey(timeScope.loadedKey);
        setSealLogError(rowsNeedingDetails.length > 0 && detailedById.size === 0
          ? 'Ready to Dispatch shipments loaded, but no audit logs were returned by the details API.' : timeScope.error);
      } catch (error) {
        if (!controller.signal.aborted) setSealLogError(error instanceof Error ? error.message : 'Failed to load seal audit logs.');
      } finally {
        if (!controller.signal.aborted) { setSealLogLoading(false); setSealLogDetail(''); }
      }
    })();
    return () => controller.abort();
  }, [connection, organizationSlug, sealProcessedKey, tab, timeScope.deliveries, timeScope.error, timeScope.isLoading, timeScope.loadedKey, timeScopeKey]);

  const refreshTime = () => {
    timeCache.current.delete(timeScopeKey);
    setTimeScope((current) => ({ ...current, loadedKey: current.loadedKey === timeScopeKey ? '' : current.loadedKey }));
    setSealProcessedKey('');
    setTimeRefresh((value) => value + 1);
  };
  const refreshRemoved = () => {
    removedCache.current.delete(removedScopeKey);
    setRemovedScope((current) => ({ ...current, loadedKey: current.loadedKey === removedScopeKey ? '' : current.loadedKey }));
    setRemovedRefresh((value) => value + 1);
  };

  const analysis = useMemo(() => analyzeTimeDeliveries(timeScope.loadedKey === timeScopeKey ? timeScope.deliveries : [], selectedHubId, hubs.find((hub) => hub.id === selectedHubId)?.name || ALEX_SORTING_FACILITY_NAME), [hubs, selectedHubId, timeScope.deliveries, timeScope.loadedKey, timeScopeKey]);
  const filteredTimeRows = useMemo(() => analysis.rows.filter((row) => {
    if (assignedHubFilter !== 'ALL' && row.assignedHub !== assignedHubFilter) return false;
    if (delayFilter === 'gt1' && row.timeInfo.diffMinutes < 60) return false;
    if (delayFilter === 'gt2' && row.timeInfo.diffMinutes < 120) return false;
    if (delayFilter === 'gt3' && row.timeInfo.diffMinutes < 180) return false;
    const query = timeSearch.trim().toLowerCase();
    return !query || row.trackingNumber.toLowerCase().includes(query) || row.assignedHub.toLowerCase().includes(query);
  }), [analysis.rows, assignedHubFilter, delayFilter, timeSearch]);
  const groupedTimeRows = useMemo(() => {
    const grouped = new Map<string, TimeAnalyzedItem[]>();
    filteredTimeRows.forEach((row) => grouped.set(row.assignedHub, [...(grouped.get(row.assignedHub) || []), row]));
    return Array.from(grouped.entries()).map(([assignedHub, rows]) => ({
      assignedHub, count: rows.length,
      averageMinutes: Math.round(rows.reduce((sum, row) => sum + row.timeInfo.diffMinutes, 0) / rows.length), rows,
    })).sort((a, b) => b.count - a.count);
  }, [filteredTimeRows]);
  const removedSeals: RemovedSealItem[] = useMemo(() => buildRemovedSealItems(removedScope.deliveries), [removedScope.deliveries]);
  const filteredRemoved = useMemo(() => {
    const query = removedSearch.trim().toLowerCase();
    return !query ? removedSeals : removedSeals.filter((row) => row.trackingNumber.toLowerCase().includes(query));
  }, [removedSearch, removedSeals]);

  const sealHubs = useMemo(() => Array.from(new Map(sealRows.map((seal) => [seal.assignedHubId, seal.assignedHubName])).entries())
    .map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)), [sealRows]);
  const filteredSealRows = useMemo(() => {
    const business = sealBusinessSearch.trim().toLowerCase();
    return sealRows.filter((seal) => {
      if (sealHubFilter !== 'ALL' && seal.assignedHubId !== sealHubFilter) return false;
      if (sealRemovalFilter === 'REMOVED' && !seal.hasRemoval) return false;
      if (business && !seal.businessNames.some((name) => name.toLowerCase().includes(business))) return false;
      const at = seal.firstShipmentAt;
      if ((sealDateFrom || sealDateTo || sealTimeFrom || sealTimeTo) && !at) return false;
      if (at) {
        const date = dateInCairo(at);
        const time = timeInCairo(at);
        if (sealDateFrom && date < sealDateFrom) return false;
        if (sealDateTo && date > sealDateTo) return false;
        if (sealTimeFrom && time < sealTimeFrom) return false;
        if (sealTimeTo && time > sealTimeTo) return false;
      }
      return true;
    });
  }, [sealBusinessSearch, sealDateFrom, sealDateTo, sealHubFilter, sealRemovalFilter, sealRows, sealTimeFrom, sealTimeTo]);

  const exportTimeAnalysis = () => downloadCsv(`time-analysis-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['Tracking Number', 'Assigned Hub', 'Received At', 'Ready to Dispatch At', 'Processing Minutes', 'Processing Time', 'Delay Category'],
    ...analysis.rows.map((row) => [row.trackingNumber, row.assignedHub, row.timeInfo.receivedAt?.toISOString() || '', row.timeInfo.readyAt?.toISOString() || '', row.timeInfo.diffMinutes, row.timeInfo.formattedDiff, categoryLabel(row.timeInfo.delayCategory)]),
  ]);
  const exportRemovedSeals = () => downloadCsv(`removed-seals-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['Tracking Number', 'Delivery ID', 'Old Seal', 'New Seal', 'Ready at Alex', 'Removed at Alex', 'Removed By', 'Business', 'Assigned Hub', 'Current State', 'Current Seal', 'Removal Reason', 'Ready Audit Event JSON', 'Removal Audit Event JSON', 'Delivery Record JSON'],
    ...filteredRemoved.map((item) => [item.trackingNumber, item.delivery._id, item.sealNumber, item.newSealNumber, item.readyAt.toISOString(), item.removedAt.toISOString(), item.removedBy, item.delivery.sender?.name || '', item.delivery.assignedHub?.name || item.delivery.assignedHubName || '', item.delivery.state?.value || '', (item.delivery as Record<string, unknown>).sealNumber || '', item.removalReason, JSON.stringify(item.readyAudit), JSON.stringify(item.removalAudit), JSON.stringify(item.delivery)]),
  ]);
  const exportSealLogs = () => downloadCsv(`seal-logs-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['Seal', 'Assigned Hub', 'Assigned Hub ID', 'Businesses', 'Shipment Count', 'First Shipment Added', 'Opened At', 'Closed At', 'Status', 'Has Removal', 'Tracking Number', 'Old Seal', 'New Seal', 'Removed At', 'Reassigned At', 'Removed By', 'Removal Reason', 'Removal Audit Event JSON'],
    ...filteredSealRows.flatMap((seal) => {
      const base = [seal.sealNumber, seal.assignedHubName, seal.assignedHubId, seal.businessNames.join(' | '), seal.shipmentCount, seal.firstShipmentAt?.toISOString() || '', seal.openedAt?.toISOString() || '', seal.closedAt?.toISOString() || '', seal.status, seal.hasRemoval ? 'Yes' : 'No'];
      return seal.removalTransitions.length ? seal.removalTransitions.map((transition) => [
        ...base, transition.trackingNumber, transition.oldSealNumber, transition.newSealNumber,
        transition.removedAt.toISOString(), transition.reassignedAt?.toISOString() || '', transition.removedBy, transition.reason, JSON.stringify(transition.auditEvent),
      ]) : [[...base, '', '', '', '', '', '', '', '']];
    }),
  ]);

  if (connection === 'checking') return <section className="miss-panel transfer-history-loading" role="status"><LoaderCircle className="animate-spin" size={18} /> Checking Bosta connection…</section>;
  if (connection === 'disconnected') return <section className="miss-panel transfer-connect-panel">
    <KeyRound size={22} />
    <div><h2>Connect your Bosta account</h2><p>Enter or reconnect the shared token from the fixed header. The token is validated by the secure organization session.</p></div>
    {(connectionError || timeScope.error) && <div className="workspace-notice" role="alert">{connectionError || timeScope.error}</div>}
  </section>;

  const pageTitle = tab === 'Time Analysis' ? 'Time analysis and delays' : tab === 'Removed Seals' ? 'Removed seals · Alex Sorting Facility' : 'Seal logs';
  const pageDescription = tab === 'Time Analysis'
    ? 'Time from receipt at the selected hub to Ready to Dispatch, grouped by assigned hub.'
    : tab === 'Removed Seals'
      ? 'Shipment audit history for Ready to Dispatch and remove-from-seal events recorded at Alex Sorting Facility.'
      : 'Seal assignment, removal, and close events from the same Ready to Dispatch source used by Time Analysis.';
  const refresh = tab === 'Removed Seals' ? refreshRemoved : refreshTime;
  const loading = tab === 'Removed Seals' ? removedScope.isLoading : tab === 'Seal Logs' ? timeScope.isLoading || sealLogLoading : timeScope.isLoading;
  const loadingDetail = tab === 'Removed Seals' ? removedScope.loadingDetail : tab === 'Seal Logs' ? sealLogDetail || timeScope.loadingDetail : timeScope.loadingDetail;
  const updatedAt = tab === 'Removed Seals' ? removedScope.lastUpdated : tab === 'Seal Logs' ? sealLogUpdatedAt || timeScope.lastUpdated : timeScope.lastUpdated;
  const error = tab === 'Removed Seals' ? removedScope.error : tab === 'Seal Logs' ? sealLogError || timeScope.error : timeScope.error;

  return <div className="transfer-history">
    <section className="miss-panel transfer-history-heading">
      <div className="transfer-history-heading-copy">
        <span className="source-kind">Bosta Admin live API · session token</span>
        <h2>{pageTitle}</h2>
        <p>{pageDescription}</p>
        {updatedAt && <small>Updated {new Date(updatedAt).toLocaleTimeString('en-GB', { timeZone: 'Africa/Cairo' })} · Cairo time</small>}
      </div>
      <div className="transfer-history-actions">
        {tab !== 'Removed Seals' && <label>Search hub<select value={selectedHubId} onChange={(event) => {
          setSelectedHubId(event.target.value);
          setAssignedHubFilter('ALL');
          setSealRows([]);
          setSealProcessedKey('');
        }}>
          {hubs.length ? hubs.map((hub) => <option key={hub.id} value={hub.id}>{hub.name}</option>) : <option value={ALEX_SORTING_FACILITY_ID}>{ALEX_SORTING_FACILITY_NAME}</option>}
        </select></label>}
        <button type="button" className="btn sm" onClick={refresh} disabled={loading}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh</button>
      </div>
    </section>

    {loading && <div className="workspace-notice is-info transfer-history-progress" role="status"><LoaderCircle size={16} className="animate-spin" /> {loadingDetail || 'Loading shipment history…'}</div>}
    {error && <div className="workspace-notice" role="alert"><AlertCircle size={16} /> {error}</div>}

    {tab === 'Time Analysis' && <>
      <div className="miss-summary">
        {[
          { title: 'Total analyzed shipments', value: analysis.rows.length.toLocaleString(), note: 'Receipt and processing times found', icon: Timer, tone: 'blue' },
          { title: 'Delay · over 1 hour', value: analysis.countGt1.toLocaleString(), note: 'At least 60 minutes', icon: Clock3, tone: 'amber' },
          { title: 'Delay · over 2 hours', value: analysis.countGt2.toLocaleString(), note: 'At least 120 minutes', icon: TriangleAlert, tone: 'orange' },
          { title: 'Critical · over 3 hours', value: analysis.countGt3.toLocaleString(), note: 'At least 180 minutes', icon: AlertOctagon, tone: 'rose' },
        ].map((card) => { const Icon = card.icon; return <div className={`miss-summary-card transfer-kpi ${card.tone}`} key={card.title}><Icon size={19} /><span>{card.title}</span><strong>{card.value}</strong><small>{card.note}</small></div>; })}
      </div>

      {analysis.hubSummaries.length > 0 && <section className="miss-panel transfer-hub-summary">
        <div className="transfer-history-section-title"><div><Building2 size={17} /><h3>SLA performance by assigned hub</h3></div><button type="button" className="btn sm" onClick={exportTimeAnalysis}><Download size={15} /> Export full analysis CSV</button></div>
        <div className="transfer-hub-grid">
          {analysis.hubSummaries.map((hub) => <button type="button" key={hub.hubName} onClick={() => setAssignedHubFilter(assignedHubFilter === hub.hubName ? 'ALL' : hub.hubName)} className={`transfer-hub-card${assignedHubFilter === hub.hubName ? ' is-active' : ''}`}>
            <span>{hub.hubName}</span><strong>{hub.averageMinutes} min</strong><small>{hub.count.toLocaleString()} shipments · {hub.overOneHour.toLocaleString()} over 1h</small>
          </button>)}
        </div>
      </section>}

      <section className="miss-panel transfer-time-controls">
        <div className="transfer-history-section-title"><div><Search size={16} /><h3>Filter time analysis</h3><span>{filteredTimeRows.length.toLocaleString()} / {analysis.rows.length.toLocaleString()}</span></div><button type="button" className="btn sm" onClick={() => { setTimeSearch(''); setDelayFilter('ALL'); setAssignedHubFilter('ALL'); }}>Clear filters</button></div>
        <div className="transfer-time-filter-row">
          <label className="miss-search"><Search size={15} /><input value={timeSearch} onChange={(event) => setTimeSearch(event.target.value)} placeholder="Search tracking number or assigned hub" /></label>
          {(['ALL', 'gt1', 'gt2', 'gt3'] as const).map((value) => <button type="button" key={value} onClick={() => setDelayFilter(value)} className={`time-filter-chip ${delayFilter === value ? `is-active ${value.toLowerCase()}` : ''}`}>
            {value === 'ALL' ? 'All delays' : value === 'gt1' ? `Over 1h · ${analysis.countGt1.toLocaleString()}` : value === 'gt2' ? `Over 2h · ${analysis.countGt2.toLocaleString()}` : `Over 3h · ${analysis.countGt3.toLocaleString()}`}
          </button>)}
          {assignedHubFilter !== 'ALL' && <span className="transfer-selected-hub">Hub: <strong>{assignedHubFilter}</strong><button type="button" onClick={() => setAssignedHubFilter('ALL')}>Clear</button></span>}
        </div>
      </section>

      {groupedTimeRows.length === 0 ? <section className="miss-panel transfer-empty">{timeScope.isLoading || timeScope.loadedKey !== timeScopeKey && !timeScope.error ? 'Loading shipment history for the selected hub…' : timeScope.error ? 'Shipment history could not be loaded for this hub.' : timeScope.deliveries.length ? 'No shipments match the selected filters for Time Analysis.' : 'No shipments with receipt and Ready to Dispatch timestamps were returned for this hub.'}</section> : groupedTimeRows.map((group) => <section className="miss-panel miss-table-panel transfer-table-panel" key={group.assignedHub}>
        <div className="transfer-table-title"><div><Building2 size={16} /><h3>{group.assignedHub}</h3><span>{group.count.toLocaleString()} shipments</span></div><small>Average processing time: <strong>{group.averageMinutes} minutes · {Math.floor(group.averageMinutes / 60)}h {group.averageMinutes % 60}m</strong></small></div>
        <div className="responsive-table-wrap"><table><thead><tr><th>#</th><th>Tracking number</th><th>Received</th><th>Ready</th><th>Processing time</th><th>Category</th></tr></thead><tbody>
          {group.rows.map((row, index) => <tr key={`${row.trackingNumber}-${row.timeInfo.readyAt?.toISOString()}`}>
            <td>{index + 1}</td><td><div className="transfer-tracking-cell"><a href={`https://beta-admin.bosta.co/deliveries/${encodeURIComponent(row.trackingNumber)}/details`} target="_blank" rel="noopener noreferrer">{row.trackingNumber}</a><button type="button" title="Copy tracking number" onClick={() => void navigator.clipboard?.writeText(row.trackingNumber)}><Copy size={13} /></button><a href={`https://beta-admin.bosta.co/deliveries/${encodeURIComponent(row.trackingNumber)}/details`} target="_blank" rel="noopener noreferrer" title="Open in Bosta Admin"><ExternalLink size={13} /></a></div></td>
            <td>{dateTimeInCairo(row.timeInfo.receivedAt)}</td><td>{dateTimeInCairo(row.timeInfo.readyAt)}</td><td><strong>{row.timeInfo.formattedDiff}</strong></td><td><span className={categoryClass(row.timeInfo.delayCategory)}>{categoryLabel(row.timeInfo.delayCategory)}</span></td>
          </tr>)}
        </tbody></table></div>
      </section>)}
    </>}

    {tab === 'Removed Seals' && <section className="miss-panel miss-table-panel transfer-table-panel">
      <div className="transfer-table-title"><div><PackageX size={17} /><h3>Removed seals · Alex Sorting Facility</h3><span>{filteredRemoved.length.toLocaleString()} matches · {removedScope.deliveries.length.toLocaleString()} shipments scanned</span></div>
        <div className="transfer-table-actions"><label className="miss-search"><Search size={15} /><input value={removedSearch} onChange={(event) => setRemovedSearch(event.target.value)} placeholder="Search tracking number" /></label><button type="button" className="btn sm" onClick={exportRemovedSeals} disabled={!filteredRemoved.length}><Download size={15} /> Export CSV</button></div>
      </div>
      <p className="transfer-history-note">Includes shipments with a Ready to Dispatch event followed by a remove-from-seal event, both recorded at Alex Sorting Facility. Search includes the historical tracking-number lookups and the current shipment search.</p>
      <div className="responsive-table-wrap"><table><thead><tr><th>Tracking number</th><th>Old seal</th><th>New seal</th><th>Ready to Dispatch at Alex</th><th>Removed at Alex</th><th>Removed by</th><th>Removal reason</th></tr></thead><tbody>
        {filteredRemoved.map((item) => <tr key={`${item.trackingNumber}-${item.removedAt.toISOString()}`}>
          <td><a className="transfer-track-link" href={`https://beta-admin.bosta.co/deliveries/${encodeURIComponent(item.trackingNumber)}/details`} target="_blank" rel="noopener noreferrer">{item.trackingNumber}</a></td><td className="mono">{item.sealNumber}</td><td className="mono">{item.newSealNumber}</td><td>{dateTimeInCairo(item.readyAt)}</td><td>{dateTimeInCairo(item.removedAt)}</td><td>{item.removedBy}</td><td>{item.removalReason}</td>
        </tr>)}
        {!loading && filteredRemoved.length === 0 && <tr><td colSpan={7} className="transfer-empty">{removedScope.deliveries.length === 0 && !error ? 'Open this tab or refresh to scan shipment history.' : removedSearch ? 'No matching tracking numbers.' : 'No matching removal history was found in the loaded API records.'}</td></tr>}
      </tbody></table></div>
      <div className="transfer-table-footer"><span>Removal reason is shown only when it exists in the Bosta audit log.</span>{removedScope.lastUpdated && <span>Updated {new Date(removedScope.lastUpdated).toLocaleTimeString('en-GB', { timeZone: 'Africa/Cairo' })} · Cairo time</span>}</div>
    </section>}

    {tab === 'Seal Logs' && <section className="miss-panel miss-table-panel transfer-table-panel">
      <div className="transfer-table-title"><div><ShieldCheck size={17} /><h3>Seal logs</h3><span>{filteredSealRows.length.toLocaleString()} seals · {sealRows.length.toLocaleString()} loaded</span></div><button type="button" className="btn sm" onClick={exportSealLogs} disabled={!filteredSealRows.length}><Download size={15} /> Export CSV</button></div>
      <p className="transfer-history-note">Uses the same Ready to Dispatch shipment source as Time Analysis and groups shipment audit events by seal and assigned hub.</p>
      <div className="transfer-seal-filters">
        <label>Assigned hub<select value={sealHubFilter} onChange={(event) => setSealHubFilter(event.target.value)}><option value="ALL">All hubs</option>{sealHubs.map((hub) => <option key={hub.id} value={hub.id}>{hub.name}</option>)}</select></label>
        <label>Business<input value={sealBusinessSearch} onChange={(event) => setSealBusinessSearch(event.target.value)} placeholder="Search business" /></label>
        <label>Date from<input type="date" value={sealDateFrom} onChange={(event) => setSealDateFrom(event.target.value)} /></label>
        <label>Date to<input type="date" value={sealDateTo} onChange={(event) => setSealDateTo(event.target.value)} /></label>
        <label>Time from<input type="time" value={sealTimeFrom} onChange={(event) => setSealTimeFrom(event.target.value)} /></label>
        <label>Time to<input type="time" value={sealTimeTo} onChange={(event) => setSealTimeTo(event.target.value)} /></label>
        <label>Seal removal<select value={sealRemovalFilter} onChange={(event) => setSealRemovalFilter(event.target.value as 'ALL' | 'REMOVED')}><option value="ALL">All seals</option><option value="REMOVED">Has removed shipment</option></select></label>
      </div>
      <div className="responsive-table-wrap"><table><thead><tr><th>Seal</th><th>Assigned hub</th><th>Business</th><th>Shipments</th><th>First shipment added</th><th>Opened</th><th>Closed</th><th>Status</th><th>Old → new seal (tracking / removal time)</th></tr></thead><tbody>
        {filteredSealRows.map((seal) => <tr key={seal.id}>
          <td className="mono transfer-seal-number">{seal.sealNumber}</td><td>{seal.assignedHubName}</td><td>{seal.businessNames.join(', ') || 'Not returned by API'}</td><td className="numeric">{seal.shipmentCount || '—'}</td><td>{dateTimeInCairo(seal.firstShipmentAt)}</td><td>{dateTimeInCairo(seal.openedAt)}</td><td>{dateTimeInCairo(seal.closedAt) === '—' ? 'Not closed / not recorded' : dateTimeInCairo(seal.closedAt)}</td><td>{seal.status}</td><td>{seal.removalTransitions.length ? seal.removalTransitions.map((transition) => <div className="transfer-removal-transition" key={`${transition.trackingNumber}-${transition.removedAt.toISOString()}`}>{transition.oldSealNumber} → {transition.newSealNumber} · {transition.trackingNumber} · {dateTimeInCairo(transition.removedAt)}</div>) : '—'}</td>
        </tr>)}
        {!loading && filteredSealRows.length === 0 && <tr><td colSpan={9} className="transfer-empty">No seals match the selected filters.</td></tr>}
      </tbody></table></div>
      <div className="transfer-table-footer">First shipment and open times use the first seal assignment event. A close time appears only when the audit log contains a seal-close event. {sealLogUpdatedAt && `Updated ${new Date(sealLogUpdatedAt).toLocaleTimeString('en-GB', { timeZone: 'Africa/Cairo' })} · Cairo time`}</div>
    </section>}
  </div>;
};
