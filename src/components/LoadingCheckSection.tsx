import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Bell, BellOff, Check, CircleStop, Download, KeyRound,
  RefreshCw, X,
} from 'lucide-react';
import {
  ApiError, BostaHubOption, getBostaConnection, getBostaDispatchSealsPage, getBostaHubs,
  getBostaHistoryDetailsBatch, lookupBostaHistoryDeliveries,
} from '../services/api';
import {
  columnIndex, columnName, enrichLoadingCheckRows, findSystemSealRows, formulaValue,
  getShipmentHubName, getShipmentTrackingNumber, isDispatchedSealState,
  LOADING_CHECK_BLOCK_WIDTH, normalizeSealKey, normalizeSystemSeals, parseSystemSeal,
} from '../utils/loadingCheck';
import type {
  LoadingCheckEnrichmentUpdate, LoadingCheckSeal,
} from '../utils/loadingCheck';
import { useMasterSealDispatches } from '../hooks/useMasterSealDispatches';

const DB_NAME = 'bosta_dispatch_monitor_local';
const STORE_NAME = 'state';
const BOSTA_PAGE_SIZE = 500;
const SEALS_PAGE_SIZE = 100;
const PAIR_COUNT = 15;
const BLOCK_WIDTH = LOADING_CHECK_BLOCK_WIDTH;
const INITIAL_ROW_COUNT = 40;
const POLL_INTERVAL = 30_000;
const RETRY_INTERVAL = 10_000;
const MAX_SYNC_ATTEMPTS = 5;
const OFFLINE_COOLDOWN = 5 * 60_000;
const SUPPORTED_SOURCE_HUBS = ['alexsortingfacility', 'cairosortingfacility'];

type ConnectionState = 'checking' | 'connected' | 'disconnected' | 'error';
type MessageState = { type: 'ok' | 'warn' | 'error'; text: string } | null;
type SheetSnapshot = {
  headers: string[];
  rows: string[][];
  seals?: LoadingCheckSeal[];
  snapshotAt?: string;
  legacyData?: unknown;
};
type WorkerTask =
  | { type: 'normalize'; value: unknown }
  | { type: 'enrich'; rows: string[][]; seals: LoadingCheckSeal[] };
type WorkerReply = { id: number; result?: unknown; error?: string };
type CellPosition = { row: number; col: number };
type SelectionRange = { anchor: CellPosition; focus: CellPosition };

function buildHeaders(): string[] {
  return Array.from({ length: PAIR_COUNT }, (_, index) => index === PAIR_COUNT - 1
    ? ['Seal Number', 'Assigned Hub', `Car Number ${index + 1}`, 'Master Seal']
    : ['Seal Number', 'Assigned Hub', `Car Number ${index + 1}`, 'Master Seal', '']).flat();
}

const INITIAL_HEADERS = buildHeaders();
const DUPLICATE_HEADERS = Array.from({ length: PAIR_COUNT }, (_, index) => index === PAIR_COUNT - 1
  ? ['Seal Number', 'Assigned Hub', `Car Number ${index + 1}`, 'Master Seal', 'Assign Hub']
  : ['Seal Number', 'Assigned Hub', `Car Number ${index + 1}`, 'Master Seal', 'Assign Hub', '']).flat();
const OLD_HEADERS = Array.from({ length: PAIR_COUNT }, (_, index) => index === PAIR_COUNT - 1
  ? ['Seal Number', `Car Number ${index + 1}`, 'Master Seal', 'Assign Hub']
  : ['Seal Number', `Car Number ${index + 1}`, 'Master Seal', 'Assign Hub', '']).flat();
const OLD_REVERSED_HEADERS = Array.from({ length: PAIR_COUNT }, (_, index) => index === PAIR_COUNT - 1
  ? [`Car Number ${index + 1}`, 'Master Seal', 'Seal Number', 'Assign Hub']
  : [`Car Number ${index + 1}`, 'Master Seal', 'Seal Number', 'Assign Hub', '']).flat();
const OLD_SIMPLE_HEADERS = Array.from({ length: PAIR_COUNT }, (_, index) => index === PAIR_COUNT - 1
  ? ['Seal Number', `Car Number ${index + 1}`]
  : ['Seal Number', `Car Number ${index + 1}`, '']).flat();
const LEGACY_HEADERS = Array.from({ length: PAIR_COUNT }, (_, index) => index === PAIR_COUNT - 1
  ? ['Seal Number', 'Car Number']
  : ['Seal Number', 'Car Number', '']).flat();

function blankRows(count = INITIAL_ROW_COUNT): string[][] {
  return Array.from({ length: count }, () => Array(INITIAL_HEADERS.length).fill(''));
}

function sourceHubName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function supportedSourceHubKey(value: string): string {
  const normalized = sourceHubName(value);
  return SUPPORTED_SOURCE_HUBS.find((key) => normalized.includes(key)) || '';
}

function hubLabel(value: string | undefined, hubs: BostaHubOption[]): string {
  const candidate = String(value || '').trim();
  if (!candidate) return '';
  const found = hubs.find((hub) => hub.id === candidate);
  if (found) return found.name;
  return /^[a-f\d]{24}$/i.test(candidate) ? '' : candidate;
}

function resolveKnownSealHubs(seals: LoadingCheckSeal[], hubs: BostaHubOption[]): LoadingCheckSeal[] {
  return seals.map((seal) => ({
    ...seal,
    assignedHub: hubLabel(seal.assignedHub, hubs) || hubLabel(seal.destinationHubId, hubs),
  }));
}

async function resolveShipmentHubFallbacks(
  seals: LoadingCheckSeal[],
  hubs: BostaHubOption[],
  organizationSlug: string,
  signal: AbortSignal,
): Promise<{ seals: LoadingCheckSeal[]; failedLookups: number }> {
  const resolved = resolveKnownSealHubs(seals, hubs);
  const detailsById = new Map<string, string>();
  const lookupGroups = new Map<string, Set<string>>();
  const deliveryIds = Array.from(new Set(resolved.flatMap((seal) =>
    seal.assignedHub ? [] : seal.shipmentIds || [],
  )));

  let failedLookups = 0;
  const idBatches = Array.from({ length: Math.ceil(deliveryIds.length / 100) }, (_, index) => deliveryIds.slice(index * 100, index * 100 + 100));
  for (let index = 0; index < idBatches.length; index += 4) {
    await Promise.all(idBatches.slice(index, index + 4).map(async (ids) => {
      try {
        const deliveries = await getBostaHistoryDetailsBatch(organizationSlug, ids, signal);
        deliveries.forEach((delivery) => {
          const raw = delivery as Record<string, unknown>;
          const id = String(raw._id ?? raw.id ?? '');
          const hub = hubLabel(getShipmentHubName(raw), hubs)
            || hubLabel(String(raw.destinationHubId ?? raw.destinationWarehouseId ?? ''), hubs);
          if (id && hub) detailsById.set(id, hub);
        });
      } catch {
        if (!signal.aborted) failedLookups += 1;
      }
    }));
  }

  resolved.forEach((seal) => {
    if (seal.assignedHub || (seal.shipmentIds || []).some((id) => detailsById.has(id)) || !seal.destinationHubId) return;
    const trackingNumbers = seal.shipmentTrackingNumbers || [];
    if (!trackingNumbers.length) return;
    const numbers = lookupGroups.get(seal.destinationHubId) || new Set<string>();
    trackingNumbers.forEach((number) => numbers.add(number));
    lookupGroups.set(seal.destinationHubId, numbers);
  });

  const tasks = Array.from(lookupGroups, ([hubId, numbers]) => {
    const uniqueNumbers = Array.from(numbers);
    return Array.from({ length: Math.ceil(uniqueNumbers.length / 30) }, (_, index) => ({
      hubId,
      trackingNumbers: uniqueNumbers.slice(index * 30, index * 30 + 30),
    }));
  }).flat();
  const hubsByTracking = new Map<string, string>();
  for (let index = 0; index < tasks.length; index += 4) {
    await Promise.all(tasks.slice(index, index + 4).map(async ({ hubId, trackingNumbers }) => {
      try {
        const deliveries = await lookupBostaHistoryDeliveries(organizationSlug, hubId, trackingNumbers, signal);
        deliveries.forEach((delivery) => {
          const raw = delivery as Record<string, unknown>;
          const tracking = getShipmentTrackingNumber(raw);
          const hub = hubLabel(getShipmentHubName(raw), hubs)
            || hubLabel(String(raw.destinationHubId ?? raw.destinationWarehouseId ?? ''), hubs);
          if (tracking && hub) hubsByTracking.set(normalizeSealKey(tracking), hub);
        });
      } catch {
        if (!signal.aborted) failedLookups += 1;
      }
    }));
  }

  return {
    seals: resolved.map((seal) => {
      if (seal.assignedHub) return seal;
      const assignedHub = (seal.shipmentIds || []).map((id) => detailsById.get(id) || '').find(Boolean)
        || (seal.shipmentTrackingNumbers || [])
        .map((tracking) => hubsByTracking.get(normalizeSealKey(tracking)) || '')
        .find(Boolean) || '';
      return assignedHub ? { ...seal, assignedHub } : seal;
    }),
    failedLookups,
  };
}

function fitRows(rows: unknown[], width: number): string[][] {
  return rows.map((value) => {
    const row = Array.isArray(value) ? value.map((cell) => String(cell ?? '')) : [];
    return [...row, ...Array(Math.max(0, width - row.length)).fill('')].slice(0, width);
  });
}

function migrateSnapshot(snapshot: SheetSnapshot): { rows: string[][]; legacyData: unknown } {
  const headerKey = JSON.stringify(snapshot.headers);
  if (headerKey === JSON.stringify(INITIAL_HEADERS)) return { rows: fitRows(snapshot.rows, INITIAL_HEADERS.length), legacyData: snapshot.legacyData || null };

  if (headerKey === JSON.stringify(DUPLICATE_HEADERS)) {
    const rows = snapshot.rows.map((source) => {
      const row = Array(INITIAL_HEADERS.length).fill('');
      for (let block = 0; block < PAIR_COUNT; block += 1) {
        const oldStart = block * 6;
        const nextStart = block * BLOCK_WIDTH;
        row[nextStart] = source[oldStart] ?? '';
        row[nextStart + 1] = source[oldStart + 1] || source[oldStart + 4] || '';
        row[nextStart + 2] = source[oldStart + 2] ?? '';
        row[nextStart + 3] = source[oldStart + 3] ?? '';
      }
      return row;
    });
    return { rows, legacyData: snapshot.legacyData || null };
  }

  if (headerKey === JSON.stringify(OLD_HEADERS)) {
    const rows = snapshot.rows.map((source) => {
      const row = Array(INITIAL_HEADERS.length).fill('');
      for (let block = 0; block < PAIR_COUNT; block += 1) {
        const oldStart = block * 5;
        const nextStart = block * BLOCK_WIDTH;
        row[nextStart] = source[oldStart] ?? '';
        row[nextStart + 1] = source[oldStart + 3] ?? '';
        row[nextStart + 2] = source[oldStart + 1] ?? '';
        row[nextStart + 3] = source[oldStart + 2] ?? '';
      }
      return row;
    });
    return { rows, legacyData: snapshot.legacyData || null };
  }

  if (headerKey === JSON.stringify(OLD_REVERSED_HEADERS)) {
    const rows = snapshot.rows.map((source) => {
      const row = Array(INITIAL_HEADERS.length).fill('');
      for (let block = 0; block < PAIR_COUNT; block += 1) {
        const oldStart = block * 5;
        const nextStart = block * BLOCK_WIDTH;
        row[nextStart] = source[oldStart + 2] ?? '';
        row[nextStart + 1] = source[oldStart + 3] ?? '';
        row[nextStart + 2] = source[oldStart] ?? '';
        row[nextStart + 3] = source[oldStart + 1] ?? '';
      }
      return row;
    });
    return { rows, legacyData: snapshot.legacyData || null };
  }

  if (headerKey === JSON.stringify(OLD_SIMPLE_HEADERS) || headerKey === JSON.stringify(LEGACY_HEADERS)) {
    const rows = snapshot.rows.map((source) => {
      const row = Array(INITIAL_HEADERS.length).fill('');
      for (let block = 0; block < PAIR_COUNT; block += 1) {
        const oldStart = block * 3;
        const nextStart = block * BLOCK_WIDTH;
        row[nextStart] = source[oldStart] ?? '';
        row[nextStart + 2] = source[oldStart + 1] ?? '';
      }
      return row;
    });
    return { rows, legacyData: snapshot.legacyData || null };
  }

  const sealIndex = snapshot.headers.findIndex((header) => /seal/i.test(header));
  const carIndex = snapshot.headers.findIndex((header) => /car|vehicle/i.test(header));
  const entries = snapshot.rows.filter((row) => row.some((value) => String(value ?? '').trim())).map((row) => ({
    seal: sealIndex >= 0 ? row[sealIndex] ?? '' : '',
    car: carIndex >= 0 ? row[carIndex] ?? '' : '',
  })).filter((entry) => String(entry.seal).trim() || String(entry.car).trim());
  const rows = blankRows(Math.max(INITIAL_ROW_COUNT, Math.ceil(entries.length / PAIR_COUNT)));
  entries.forEach((entry, index) => {
    const rowIndex = Math.floor(index / PAIR_COUNT);
    const start = (index % PAIR_COUNT) * BLOCK_WIDTH;
    rows[rowIndex][start] = String(entry.seal ?? '');
    rows[rowIndex][start + 2] = String(entry.car ?? '');
  });
  return { rows, legacyData: snapshot.legacyData || snapshot };
}

function isSpacerColumn(column: number): boolean {
  return column < INITIAL_HEADERS.length && column % BLOCK_WIDTH === BLOCK_WIDTH - 1;
}

function isSealColumn(column: number): boolean {
  return column < INITIAL_HEADERS.length && column % BLOCK_WIDTH === 0;
}

function csvValue(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function openLocalDatabase(): Promise<IDBDatabase | null> {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open local spreadsheet storage.'));
  });
}

function SpreadsheetGrid({
  headers, rows, tableRef, onInput, onFocus, onClick, onKeyDown, onCopy, onPaste,
}: {
  headers: string[];
  rows: string[][];
  tableRef: React.RefObject<HTMLTableElement | null>;
  onInput: (event: React.FormEvent<HTMLTableElement>) => void;
  onFocus: (event: React.FocusEvent<HTMLTableElement>) => void;
  onClick: (event: React.MouseEvent<HTMLTableElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTableElement>) => void;
  onCopy: (event: React.ClipboardEvent<HTMLTableElement>) => void;
  onPaste: (event: React.ClipboardEvent<HTMLTableElement>) => void;
}) {
  return <table ref={tableRef} className="loading-check-grid" aria-label="Dispatch spreadsheet" onInput={onInput} onFocusCapture={onFocus} onClick={onClick} onKeyDown={onKeyDown} onCopy={onCopy} onPaste={onPaste}>
    <thead><tr><th className="lc-row-head">#</th>{headers.map((header, column) => <th key={column} className={`${isSpacerColumn(column) ? 'lc-spacer' : ''}${isSealColumn(column) ? ' lc-seal-head' : ''}${column % BLOCK_WIDTH === 2 ? ' lc-car-head' : ''}${column % BLOCK_WIDTH === 3 ? ' lc-master-seal-head' : ''}`}>{header}</th>)}</tr></thead>
    <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}><th className="lc-row-head">{rowIndex + 1}</th>{headers.map((_header, column) => {
      const raw = row[column] ?? '';
      const spacer = isSpacerColumn(column);
      return <td
        key={column}
        contentEditable={!spacer}
        suppressContentEditableWarning
        spellCheck={false}
        data-row={rowIndex}
        data-col={column}
        aria-label={`${columnName(column)}${rowIndex + 1}`}
        className={`${spacer ? 'lc-spacer' : ''}${isSealColumn(column) ? ' lc-seal-cell' : ''}${column % BLOCK_WIDTH === 2 ? ' lc-car-cell' : ''}${column % BLOCK_WIDTH === 3 ? ' lc-master-seal-cell' : ''}`}
      >{spacer ? '' : formulaValue(String(raw), rows)}</td>;
    })}</tr>)}</tbody>
  </table>;
}

const MemoSpreadsheetGrid = React.memo(SpreadsheetGrid);

export const LoadingCheckSection: React.FC<{ organizationSlug: string }> = ({ organizationSlug }) => {
  const {
    date: manifestDate,
    dispatches: manifestDispatches,
    isLoading: isManifestDispatchLoading,
    error: manifestDispatchError,
    refresh: refreshManifestDispatches,
  } = useMasterSealDispatches({ includeDetails: false });
  const [connection, setConnection] = useState<ConnectionState>('checking');
  const [connectionError, setConnectionError] = useState('');
  const [hubs, setHubs] = useState<BostaHubOption[]>([]);
  const [sourceHubId, setSourceHubId] = useState('');
  const [destinationHubId, setDestinationHubId] = useState('');
  const [rows, setRows] = useState<string[][]>(() => blankRows());
  const [seals, setSeals] = useState<LoadingCheckSeal[]>([]);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const [snapshotAt, setSnapshotAt] = useState('');
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'connected' | 'retrying' | 'error'>('idle');
  const [syncDetail, setSyncDetail] = useState('Connect with the shared token in the fixed header to load system seals.');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [message, setMessage] = useState<MessageState>(null);
  const [alertText, setAlertText] = useState('');
  const [page, setPage] = useState(1);
  const [recordCount, setRecordCount] = useState(0);
  const [storageStatus, setStorageStatus] = useState('Loading spreadsheet…');
  const [storageReady, setStorageReady] = useState(false);
  const [formulaText, setFormulaText] = useState('');
  const [cellName, setCellName] = useState('A1');
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const rowsRef = useRef(rows);
  const sealsRef = useRef(seals);
  const sealsByNumberRef = useRef(new Map<string, LoadingCheckSeal>());
  const dispatchedMasterSealsRef = useRef(new Set<string>());
  const manifestDispatchLoadingRef = useRef(isManifestDispatchLoading);
  manifestDispatchLoadingRef.current = isManifestDispatchLoading;
  const hasSnapshotRef = useRef(false);
  const snapshotAtRef = useRef('');
  const legacyDataRef = useRef<unknown>(null);
  const databaseRef = useRef<IDBDatabase | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const gridRef = useRef<HTMLTableElement | null>(null);
  const selectedRef = useRef<CellPosition>({ row: 0, col: 0 });
  const selectionRef = useRef<SelectionRange>({ anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } });
  const preserveSelectionRef = useRef(false);
  const alertKeyRef = useRef('');
  const audioRef = useRef<AudioContext | null>(null);
  const alarmTimerRef = useRef<number | null>(null);
  const soundEnabledRef = useRef(false);
  const mountedRef = useRef(true);
  const workerRef = useRef<Worker | null>(null);
  const workerRequestsRef = useRef(new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>());
  const workerRequestIdRef = useRef(0);
  const sourceHubOptions = useMemo(() => hubs.filter((hub) => supportedSourceHubKey(hub.name)), [hubs]);
  const sealPageCount = Math.max(1, Math.ceil(seals.length / SEALS_PAGE_SIZE));
  const shownSeals = seals.slice((page - 1) * SEALS_PAGE_SIZE, page * SEALS_PAGE_SIZE);

  useEffect(() => {
    if (connection !== 'connected') return;
    const timer = window.setInterval(() => {
      if (!manifestDispatchLoadingRef.current) refreshManifestDispatches();
    }, POLL_INTERVAL);
    return () => window.clearInterval(timer);
  }, [connection, refreshManifestDispatches]);

  useEffect(() => {
    if (typeof Worker === 'undefined') return;
    const worker = new Worker(new URL('../workers/loadingCheck.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const pending = workerRequestsRef.current.get(event.data.id);
      if (!pending) return;
      workerRequestsRef.current.delete(event.data.id);
      if (event.data.error) pending.reject(new Error(event.data.error));
      else pending.resolve(event.data.result);
    };
    worker.onerror = () => {
      workerRequestsRef.current.forEach(({ reject }) => reject(new Error('Background spreadsheet processing stopped.')));
      workerRequestsRef.current.clear();
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
    return () => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      workerRequestsRef.current.forEach(({ reject }) => reject(new Error('Background spreadsheet processing was stopped.')));
      workerRequestsRef.current.clear();
    };
  }, []);

  const processInBackground = useCallback((task: WorkerTask): Promise<unknown> => {
    const worker = workerRef.current;
    if (!worker) {
      return Promise.resolve(task.type === 'normalize'
        ? normalizeSystemSeals(task.value)
        : enrichLoadingCheckRows(task.rows, task.seals));
    }
    const id = ++workerRequestIdRef.current;
    return new Promise((resolve, reject) => {
      workerRequestsRef.current.set(id, { resolve, reject });
      worker.postMessage({ ...task, id });
    });
  }, []);

  const saveLocalState = useCallback(async () => {
    const snapshot: SheetSnapshot = {
      headers: [...INITIAL_HEADERS],
      rows: rowsRef.current.map((row) => [...row]),
      seals: sealsRef.current.map((seal) => ({
        number: seal.number,
        type: seal.type,
        packages: seal.packages,
        state: seal.state,
        source: seal.source,
        destination: seal.destination,
        assignedHub: seal.assignedHub,
        updated: seal.updated,
      })),
      snapshotAt: snapshotAtRef.current,
      legacyData: legacyDataRef.current,
    };
    const writeFallback = () => {
      try { localStorage.setItem(`${DB_NAME}:sheet`, JSON.stringify(snapshot)); }
      catch (error) { throw new Error(`Browser storage write failed: ${error instanceof Error ? error.message : String(error)}`); }
    };
    saveQueueRef.current = saveQueueRef.current.catch(() => undefined).then(async () => {
      const database = databaseRef.current;
      if (!database) { writeFallback(); return; }
      try {
        await new Promise<void>((resolve, reject) => {
          let transaction: IDBTransaction;
          try { transaction = database.transaction(STORE_NAME, 'readwrite', { durability: 'strict' }); }
          catch { transaction = database.transaction(STORE_NAME, 'readwrite'); }
          transaction.objectStore(STORE_NAME).put(snapshot, 'sheet');
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error || new Error('IndexedDB write failed.'));
          transaction.onabort = () => reject(transaction.error || new Error('IndexedDB write aborted.'));
        });
      } catch {
        databaseRef.current = null;
        writeFallback();
      }
    });
    await saveQueueRef.current;
  }, []);

  const persistNow = useCallback(() => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    void saveLocalState().then(() => {
      setStorageStatus(`Saved locally · ${new Date().toLocaleTimeString()}`);
    }).catch((error: unknown) => {
      setStorageStatus('Local save failed');
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not save the spreadsheet locally.' });
    });
  }, [saveLocalState]);

  const persistSoon = useCallback(() => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(persistNow, 120);
  }, [persistNow]);

  const updateRows = useCallback((nextRows: string[][]) => {
    rowsRef.current = nextRows;
    setRows(nextRows);
    setRecordCount(nextRows.filter((row) => row.some((value) => String(value || '').trim())).length);
  }, []);

  useEffect(() => {
    let active = true;
    mountedRef.current = true;
    void (async () => {
      try {
        let saved: SheetSnapshot | null = null;
        try {
          databaseRef.current = await openLocalDatabase();
          if (databaseRef.current) {
            saved = await new Promise<SheetSnapshot | null>((resolve, reject) => {
              const request = databaseRef.current!.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get('sheet');
              request.onsuccess = () => resolve((request.result as SheetSnapshot | undefined) || null);
              request.onerror = () => reject(request.error || new Error('Could not read the local spreadsheet.'));
            });
          }
        } catch {
          databaseRef.current = null;
        }
        if (!saved) {
          try { saved = JSON.parse(localStorage.getItem(`${DB_NAME}:sheet`) || 'null') as SheetSnapshot | null; }
          catch { saved = null; }
        }
        if (!active) return;
        if (saved && Array.isArray(saved.headers) && Array.isArray(saved.rows)) {
          const migrated = migrateSnapshot(saved);
          rowsRef.current = migrated.rows;
          setRows(migrated.rows);
          legacyDataRef.current = migrated.legacyData;
          const cachedSeals = Array.isArray(saved.seals)
            ? saved.seals.map(parseSystemSeal).filter((seal): seal is LoadingCheckSeal => Boolean(seal))
            : [];
          sealsRef.current = cachedSeals;
          sealsByNumberRef.current = new Map(cachedSeals.map((seal) => [normalizeSealKey(seal.number), seal]));
          setSeals(cachedSeals);
          hasSnapshotRef.current = Boolean(saved.snapshotAt && !Number.isNaN(Date.parse(saved.snapshotAt)));
          setHasSnapshot(hasSnapshotRef.current);
          snapshotAtRef.current = saved.snapshotAt || '';
          setSnapshotAt(snapshotAtRef.current);
          setRecordCount(migrated.rows.filter((row) => row.some((value) => String(value || '').trim())).length);
        }
        setStorageStatus(databaseRef.current ? 'Local storage ready · IndexedDB' : 'Local storage ready · browser fallback');
        if (navigator.storage?.persist) void navigator.storage.persist().catch(() => false);
      } catch (error) {
        setStorageStatus('Could not initialize local storage');
        setMessage({ type: 'warn', text: error instanceof Error ? error.message : 'Could not load the local spreadsheet.' });
      } finally {
        if (active) setStorageReady(true);
      }
    })();
    return () => {
      active = false;
      mountedRef.current = false;
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        void saveLocalState();
      }
    };
  }, [saveLocalState]);

  useEffect(() => {
    let active = true;
    setConnection('checking');
    setConnectionError('');
    void getBostaConnection(organizationSlug).then(async (connected) => {
      if (!active) return;
      if (!connected) { setConnection('disconnected'); return; }
      const options = await getBostaHubs(organizationSlug);
      if (!active) return;
      setHubs(options);
      const source = options.find((hub) => supportedSourceHubKey(hub.name) === 'alexsortingfacility')
        || options.find((hub) => supportedSourceHubKey(hub.name) === 'cairosortingfacility');
      if (!source) {
        setConnection('error');
        setConnectionError('Alex Sorting Facility and Cairo Sorting Facility were not found in the hubs returned by Bosta.');
        return;
      }
      setSourceHubId(source.id);
      setConnection('connected');
    }).catch((error: unknown) => {
      if (!active) return;
      setConnection(error instanceof ApiError && error.status === 409 ? 'disconnected' : 'error');
      setConnectionError(error instanceof Error ? error.message : 'Could not check the Bosta connection.');
    });
    return () => { active = false; };
  }, [organizationSlug]);

  const updateSelection = useCallback((focus: CellPosition, extend = false) => {
    const rowBound = Math.max(0, Math.min(rowsRef.current.length - 1, focus.row));
    const colBound = Math.max(0, Math.min(INITIAL_HEADERS.length - 1, focus.col));
    const bounded = { row: rowBound, col: colBound };
    const previous = selectionRef.current;
    const anchor = extend ? previous.anchor : bounded;
    selectionRef.current = { anchor, focus: bounded };
    selectedRef.current = bounded;
    setCellName(`${columnName(bounded.col)}${bounded.row + 1}`);
    setFormulaText(rowsRef.current[bounded.row]?.[bounded.col] ?? '');
    const table = gridRef.current;
    if (!table) return;
    table.querySelectorAll('td.lc-range-selected, td.lc-active-cell').forEach((cell) => cell.classList.remove('lc-range-selected', 'lc-active-cell'));
    const minRow = Math.min(anchor.row, bounded.row);
    const maxRow = Math.max(anchor.row, bounded.row);
    const minCol = Math.min(anchor.col, bounded.col);
    const maxCol = Math.max(anchor.col, bounded.col);
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        if (isSpacerColumn(col)) continue;
        table.querySelector(`td[data-row="${row}"][data-col="${col}"]`)?.classList.add('lc-range-selected');
      }
    }
    table.querySelector(`td[data-row="${bounded.row}"][data-col="${bounded.col}"]`)?.classList.add('lc-active-cell');
  }, []);

  const stopAlarm = useCallback(() => {
    if (alarmTimerRef.current !== null) window.clearInterval(alarmTimerRef.current);
    alarmTimerRef.current = null;
  }, []);

  const playTone = useCallback((frequency: number, duration = 0.24, volume = 0.72) => {
    const audio = audioRef.current;
    if (!audio || audio.state !== 'running') throw new Error('Enable alarm sound from this page first.');
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const now = audio.currentTime;
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(now);
    oscillator.stop(now + duration + 0.01);
  }, []);

  const startAlarm = useCallback(() => {
    if (!soundEnabledRef.current || alarmTimerRef.current !== null || !alertKeyRef.current) return;
    const audio = audioRef.current;
    if (!audio) return;
    void audio.resume().then(() => {
      if (!alertKeyRef.current || alarmTimerRef.current !== null) return;
      const beep = () => {
        if (!audioRef.current || !alertKeyRef.current) { stopAlarm(); return; }
        try { playTone(Date.now() % 520 < 260 ? 1100 : 880); }
        catch { stopAlarm(); }
      };
      beep();
      alarmTimerRef.current = window.setInterval(beep, 500);
    }).catch(() => setMessage({ type: 'error', text: 'Alarm audio is blocked by the browser. Allow sound and enable the alarm again.' }));
  }, [playTone, stopAlarm]);

  const validateMasterSealBlock = useCallback((rowIndex: number, sealColumn: number) => {
    const blockStart = Math.floor(sealColumn / BLOCK_WIDTH) * BLOCK_WIDTH;
    const masterColumn = blockStart + 3;
    const masterNumber = normalizeSealKey(rowsRef.current[rowIndex]?.[masterColumn] || '');
    const dispatched = Boolean(masterNumber && dispatchedMasterSealsRef.current.has(masterNumber));
    const sealNumber = normalizeSealKey(rowsRef.current[rowIndex]?.[blockStart] || '');
    const currentSeal = sealNumber ? sealsByNumberRef.current.get(sealNumber) : undefined;
    const currentSealDispatched = Boolean(currentSeal && isDispatchedSealState(currentSeal.state));
    const sealCell = gridRef.current?.querySelector<HTMLTableCellElement>(`td[data-row="${rowIndex}"][data-col="${blockStart}"]`);
    sealCell?.classList.toggle('lc-invalid', Boolean(sealNumber && hasSnapshotRef.current && !currentSeal && !dispatched));

    for (let column = blockStart; column < blockStart + 4; column += 1) {
      const cell = gridRef.current?.querySelector<HTMLTableCellElement>(`td[data-row="${rowIndex}"][data-col="${column}"]`);
      cell?.classList.toggle('lc-dispatched', dispatched || (column === blockStart + 2 && currentSealDispatched));
      if (column === masterColumn && cell) {
        cell.classList.toggle('lc-master-dispatched', dispatched);
        cell.title = dispatched ? '✓ Dispatched in mainfest' : '';
      }
    }
  }, []);

  const validateAllMasterSealBlocks = useCallback(() => {
    rowsRef.current.forEach((row, rowIndex) => {
      for (let column = 0; column < INITIAL_HEADERS.length; column += BLOCK_WIDTH) {
        validateMasterSealBlock(rowIndex, column);
      }
    });
  }, [validateMasterSealBlock]);

  const validateSealCell = useCallback((rowIndex: number, column: number, value: string, announce = false) => {
    if (!isSealColumn(column)) return;
    const normalized = normalizeSealKey(value);
    const found = normalized ? sealsByNumberRef.current.get(normalized) : undefined;
    const cell = gridRef.current?.querySelector<HTMLTableCellElement>(`td[data-row="${rowIndex}"][data-col="${column}"]`);
    const valid = !normalized || !hasSnapshotRef.current || Boolean(found);
    cell?.classList.toggle('lc-invalid', !valid);
    validateMasterSealBlock(rowIndex, column);
    if (!normalized || valid) {
      if (!normalized || alertKeyRef.current.startsWith(`${rowIndex}:`)) {
        alertKeyRef.current = '';
        setAlertText('');
        stopAlarm();
      }
      return;
    }
    const alertKey = `${rowIndex}:${normalized}`;
    if (alertKeyRef.current !== alertKey) {
      alertKeyRef.current = alertKey;
      setAlertText(`Seal “${value}” was not found in the live Bosta system. Hold the bag for inspection.`);
      setMessage({ type: 'error', text: `Seal not found: ${value}. Inspect it before moving the bag.` });
      if (soundEnabledRef.current) startAlarm();
      else if (announce) setMessage({ type: 'warn', text: `Seal not found: ${value}. Enable alarm sound if you want an audible alert.` });
    }
  }, [startAlarm, stopAlarm, validateMasterSealBlock]);

  const handleCellInput = useCallback((rowIndex: number, column: number, value: string) => {
    const currentRows = rowsRef.current;
    const row = currentRows[rowIndex];
    if (!row || isSpacerColumn(column)) return;
    const wasFilled = row.some((item) => String(item || '').trim());
    row[column] = value;
    if (isSealColumn(column)) {
      const seal = sealsByNumberRef.current.get(normalizeSealKey(value));
      const assignedColumn = column + 1;
      const assignedHub = seal?.assignedHub || '';
      if (row[assignedColumn] !== assignedHub) {
        row[assignedColumn] = assignedHub;
        const assignedCell = gridRef.current?.querySelector<HTMLTableCellElement>(`td[data-row="${rowIndex}"][data-col="${assignedColumn}"]`);
        if (assignedCell) assignedCell.textContent = assignedHub;
      }
      validateSealCell(rowIndex, column, value, true);
    } else if (column % BLOCK_WIDTH === 3) {
      validateMasterSealBlock(rowIndex, column);
    }
    if (selectedRef.current.row === rowIndex && selectedRef.current.col === column) setFormulaText(value);
    const isFilled = row.some((item) => String(item || '').trim());
    if (wasFilled !== isFilled) setRecordCount(currentRows.filter((item) => item.some((entry) => String(entry || '').trim())).length);
    persistSoon();
  }, [persistSoon, validateMasterSealBlock, validateSealCell]);

  const validateAllSeals = useCallback((announce = false) => {
    rowsRef.current.forEach((row, rowIndex) => {
      for (let column = 0; column < INITIAL_HEADERS.length; column += BLOCK_WIDTH) {
        const value = row[column] || '';
        if (value) validateSealCell(rowIndex, column, value, announce);
      }
    });
  }, [validateSealCell]);

  useEffect(() => {
    dispatchedMasterSealsRef.current = new Set(manifestDispatches.map((dispatch) => normalizeSealKey(dispatch.sealNumber)).filter(Boolean));
    validateAllMasterSealBlocks();
  }, [manifestDispatches, validateAllMasterSealBlocks]);

  const enrichExistingSheet = useCallback(async (nextSeals: LoadingCheckSeal[]) => {
    if (!rowsRef.current.some((row) => row.some((value, column) => isSealColumn(column) && normalizeSealKey(value)))) return;
    try {
      const updates = await processInBackground({ type: 'enrich', rows: rowsRef.current, seals: nextSeals }) as LoadingCheckEnrichmentUpdate[];
      if (!mountedRef.current) return;
      let changed = false;
      updates.forEach((update) => {
        const currentRow = rowsRef.current[update.row];
        if (!currentRow || normalizeSealKey(currentRow[update.sealColumn]) !== update.sealKey) return;
        const assignedColumn = update.sealColumn + 1;
        if (currentRow[assignedColumn] === update.assignedHub) return;
        currentRow[assignedColumn] = update.assignedHub;
        changed = true;
        const assignedCell = gridRef.current?.querySelector<HTMLTableCellElement>(`td[data-row="${update.row}"][data-col="${assignedColumn}"]`);
        if (assignedCell) assignedCell.textContent = update.assignedHub;
      });
      if (changed) persistSoon();
    } catch (error) {
      if (mountedRef.current) setMessage({ type: 'warn', text: error instanceof Error ? error.message : 'Assigned Hub updates could not be applied in the background.' });
    }
  }, [persistSoon, processInBackground]);

  useEffect(() => {
    if (connection !== 'connected' || !storageReady || !sourceHubId) return;
    let active = true;
    let timer: number | null = null;
    let attempts = 0;
    const controller = new AbortController();
    const schedule = (delay: number) => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => { void sync(); }, delay);
    };
    const sync = async () => {
      setSyncState('syncing');
      setSyncDetail('Loading system seals from Bosta…');
      try {
        const unique = new Map<string, LoadingCheckSeal>();
        let pageNumber = 1;
        while (pageNumber <= 1000) {
          const result = await getBostaDispatchSealsPage(organizationSlug, sourceHubId, pageNumber, destinationHubId, controller.signal);
          if (!active || controller.signal.aborted) return;
          const rawCount = findSystemSealRows(result).length;
          const pageSeals = await processInBackground({ type: 'normalize', value: result }) as LoadingCheckSeal[];
          if (!active || controller.signal.aborted) return;
          pageSeals.forEach((seal) => unique.set(normalizeSealKey(seal.number), seal));
          setSyncDetail(`Page ${pageNumber} · ${unique.size.toLocaleString()} system seals loaded`);
          if (rawCount < BOSTA_PAGE_SIZE) break;
          if (pageNumber === 1000) throw new Error('Seal search exceeded the safety limit of 1,000 pages.');
          pageNumber += 1;
        }
        if (!active || controller.signal.aborted) return;
        const initialSeals = resolveKnownSealHubs(Array.from(unique.values()), hubs);
        sealsRef.current = initialSeals;
        sealsByNumberRef.current = new Map(initialSeals.map((seal) => [normalizeSealKey(seal.number), seal]));
        setSeals(initialSeals);
        hasSnapshotRef.current = true;
        setHasSnapshot(true);
        snapshotAtRef.current = new Date().toISOString();
        setSnapshotAt(snapshotAtRef.current);
        setPage((current) => Math.min(current, Math.max(1, Math.ceil(initialSeals.length / SEALS_PAGE_SIZE))));
        void enrichExistingSheet(initialSeals);

        const needsShipmentLookup = initialSeals.some((seal) => !seal.assignedHub
          && (seal.shipmentIds?.length || (seal.destinationHubId && seal.shipmentTrackingNumbers?.length)));
        if (needsShipmentLookup) setSyncDetail('Checking a shipment from seals with no hub assignment…');
        const fallback = await resolveShipmentHubFallbacks(initialSeals, hubs, organizationSlug, controller.signal);
        if (!active || controller.signal.aborted) return;
        const nextSeals = fallback.seals;
        const unresolvedHubCount = nextSeals.filter((seal) => !seal.assignedHub).length;
        sealsRef.current = nextSeals;
        sealsByNumberRef.current = new Map(nextSeals.map((seal) => [normalizeSealKey(seal.number), seal]));
        setSeals(nextSeals);
        void enrichExistingSheet(nextSeals);
        attempts = 0;
        setSyncState('connected');
        setUpdatedAt(Date.now());
        setSyncDetail(`Last sync ${new Date().toLocaleTimeString()} · ${nextSeals.length.toLocaleString()} system seals · refresh every 30 seconds`);
        setMessage(fallback.failedLookups || unresolvedHubCount
          ? {
              type: 'warn',
              text: fallback.failedLookups
                ? `Sync complete: ${nextSeals.length.toLocaleString()} system seals loaded. Some shipment hub lookups failed and will retry on the next sync.`
                : `${unresolvedHubCount.toLocaleString()} seals have no destination in the seal record or related shipment response. These cells will remain empty until Bosta returns a hub.`,
            }
          : { type: 'ok', text: `Sync complete: ${nextSeals.length.toLocaleString()} system seals loaded. Dispatch actions are read-only.` });
        validateAllSeals();
        persistSoon();
        schedule(POLL_INTERVAL);
      } catch (error) {
        if (!active || controller.signal.aborted || (error as Error)?.name === 'AbortError') return;
        attempts += 1;
        setSyncState(attempts >= MAX_SYNC_ATTEMPTS ? 'error' : 'retrying');
        if (attempts < MAX_SYNC_ATTEMPTS) {
          setSyncDetail(`Sync failed · retry ${attempts + 1}/${MAX_SYNC_ATTEMPTS} in 10 seconds`);
          setMessage({ type: 'warn', text: `Could not refresh system seals. The last saved snapshot is still available. ${error instanceof Error ? error.message : ''}` });
          schedule(RETRY_INTERVAL);
        } else {
          setSyncDetail('Offline · will retry in 5 minutes');
          setMessage({ type: 'error', text: `Could not reconnect to Bosta after ${MAX_SYNC_ATTEMPTS} attempts. The previous seal snapshot and spreadsheet are preserved.` });
          attempts = 0;
          schedule(OFFLINE_COOLDOWN);
        }
      }
    };
    void sync();
    return () => {
      active = false;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [connection, destinationHubId, enrichExistingSheet, hubs, organizationSlug, persistSoon, processInBackground, refreshVersion, sourceHubId, storageReady, validateAllSeals]);

  useEffect(() => {
    validateAllSeals();
    validateAllMasterSealBlocks();
  }, [rows, validateAllMasterSealBlocks, validateAllSeals]);

  useEffect(() => () => {
    stopAlarm();
    if (audioRef.current) void audioRef.current.close().catch(() => undefined);
  }, [stopAlarm]);

  const getCell = (target: EventTarget | null): HTMLTableCellElement | null => {
    if (!(target instanceof HTMLElement)) return null;
    const cell = target.closest<HTMLTableCellElement>('td[contenteditable="true"]');
    return cell && gridRef.current?.contains(cell) ? cell : null;
  };

  const handleGridInput = useCallback((event: React.FormEvent<HTMLTableElement>) => {
    const cell = getCell(event.target);
    if (!cell) return;
    const row = Number(cell.dataset.row);
    const column = Number(cell.dataset.col);
    handleCellInput(row, column, cell.innerText.replace(/\u00a0/g, ' '));
  }, [handleCellInput]);

  const handleGridFocus = useCallback((event: React.FocusEvent<HTMLTableElement>) => {
    const cell = getCell(event.target);
    if (!cell) return;
    const row = Number(cell.dataset.row);
    const column = Number(cell.dataset.col);
    selectedRef.current = { row, col: column };
    if (!preserveSelectionRef.current) updateSelection({ row, col: column });
    preserveSelectionRef.current = false;
    setCellName(`${columnName(column)}${row + 1}`);
    setFormulaText(rowsRef.current[row]?.[column] ?? '');
  }, [updateSelection]);

  const handleGridClick = useCallback((event: React.MouseEvent<HTMLTableElement>) => {
    const cell = getCell(event.target);
    if (!cell) return;
    updateSelection({ row: Number(cell.dataset.row), col: Number(cell.dataset.col) });
  }, [updateSelection]);

  const focusCell = useCallback((row: number, column: number) => {
    const boundedRow = Math.max(0, Math.min(rowsRef.current.length - 1, row));
    let boundedColumn = Math.max(0, Math.min(INITIAL_HEADERS.length - 1, column));
    if (isSpacerColumn(boundedColumn)) boundedColumn = Math.min(INITIAL_HEADERS.length - 1, boundedColumn + 1);
    preserveSelectionRef.current = true;
    gridRef.current?.querySelector<HTMLTableCellElement>(`td[data-row="${boundedRow}"][data-col="${boundedColumn}"][contenteditable="true"]`)?.focus();
    preserveSelectionRef.current = false;
  }, []);

  const moveFocus = useCallback((row: number, column: number, extend = false) => {
    updateSelection({ row, col: column }, extend);
    focusCell(selectedRef.current.row, selectedRef.current.col);
  }, [focusCell, updateSelection]);

  const handleGridKeyDown = useCallback((event: React.KeyboardEvent<HTMLTableElement>) => {
    const cell = getCell(event.target);
    if (!cell) return;
    const row = Number(cell.dataset.row);
    const column = Number(cell.dataset.col);
    const direction = event.key.startsWith('Arrow') ? event.key.slice(5).toLowerCase() : '';
    if (direction) {
      if (event.shiftKey && event.ctrlKey) {
        event.preventDefault();
        let lastColumn = INITIAL_HEADERS.length - 1;
        while (lastColumn > 0 && isSpacerColumn(lastColumn)) lastColumn -= 1;
        const edge = direction === 'up' ? 0 : direction === 'down' ? rowsRef.current.length - 1 : direction === 'left' ? 0 : lastColumn;
        moveFocus(direction === 'up' || direction === 'down' ? edge : row, direction === 'left' || direction === 'right' ? edge : column, true);
      } else if (event.shiftKey) {
        event.preventDefault();
        let nextRow = row;
        let nextColumn = column;
        if (direction === 'up') nextRow -= 1;
        else if (direction === 'down') nextRow += 1;
        else {
          nextColumn += direction === 'left' ? -1 : 1;
          while (nextColumn >= 0 && nextColumn < INITIAL_HEADERS.length && isSpacerColumn(nextColumn)) nextColumn += direction === 'left' ? -1 : 1;
        }
        if (nextRow >= 0 && nextRow < rowsRef.current.length && nextColumn >= 0 && nextColumn < INITIAL_HEADERS.length) moveFocus(nextRow, nextColumn, true);
      } else if (!event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        let nextRow = row;
        let nextColumn = column;
        if (direction === 'up') nextRow -= 1;
        else if (direction === 'down') nextRow += 1;
        else {
          nextColumn += direction === 'left' ? -1 : 1;
          while (nextColumn >= 0 && nextColumn < INITIAL_HEADERS.length && isSpacerColumn(nextColumn)) nextColumn += direction === 'left' ? -1 : 1;
        }
        if (nextRow >= 0 && nextRow < rowsRef.current.length && nextColumn >= 0 && nextColumn < INITIAL_HEADERS.length) moveFocus(nextRow, nextColumn);
      }
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      persistNow();
      let nextRow = row + 1;
      if (nextRow >= rowsRef.current.length) {
        const nextRows = [...rowsRef.current, Array(INITIAL_HEADERS.length).fill('')];
        rowsRef.current = nextRows;
        setRows(nextRows);
        persistSoon();
        nextRow = nextRows.length - 1;
      }
      focusCell(nextRow, column);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      persistNow();
      let nextRow = row;
      let nextColumn = column + (event.shiftKey ? -1 : 1);
      while (nextColumn < 0 || nextColumn >= INITIAL_HEADERS.length || isSpacerColumn(nextColumn)) {
        if (nextColumn < 0) { nextRow -= 1; nextColumn = INITIAL_HEADERS.length - 1; }
        else if (nextColumn >= INITIAL_HEADERS.length) { nextRow += 1; nextColumn = 0; }
        if (nextRow < 0) { nextRow = 0; nextColumn = 0; break; }
        if (nextRow >= rowsRef.current.length) {
          const nextRows = [...rowsRef.current, Array(INITIAL_HEADERS.length).fill('')];
          rowsRef.current = nextRows;
          setRows(nextRows);
          persistSoon();
          nextRow = nextRows.length - 1;
        }
      }
      focusCell(nextRow, nextColumn);
    }
  }, [focusCell, moveFocus, persistNow, persistSoon]);

  const handleGridCopy = useCallback((event: React.ClipboardEvent<HTMLTableElement>) => {
    const { anchor, focus } = selectionRef.current;
    const minRow = Math.min(anchor.row, focus.row);
    const maxRow = Math.max(anchor.row, focus.row);
    const minColumn = Math.min(anchor.col, focus.col);
    const maxColumn = Math.max(anchor.col, focus.col);
    const text = [];
    for (let row = minRow; row <= maxRow; row += 1) {
      const values = [];
      for (let column = minColumn; column <= maxColumn; column += 1) values.push(isSpacerColumn(column) ? '' : String(rowsRef.current[row]?.[column] ?? ''));
      text.push(values.join('\t'));
    }
    event.preventDefault();
    event.clipboardData.setData('text/plain', text.join('\r\n'));
  }, []);

  const handleGridPaste = useCallback((event: React.ClipboardEvent<HTMLTableElement>) => {
    const cell = getCell(event.target);
    const text = event.clipboardData.getData('text/plain');
    if (!cell || (!text.includes('\t') && !text.includes('\n'))) return;
    event.preventDefault();
    const startRow = Number(cell.dataset.row);
    const startColumn = Number(cell.dataset.col);
    const matrix = text.replace(/\r/g, '').split('\n').filter((line, index, all) => line || index < all.length - 1).map((line) => line.split('\t'));
    const nextRows = rowsRef.current.map((row) => [...row]);
    while (nextRows.length < startRow + matrix.length) nextRows.push(Array(INITIAL_HEADERS.length).fill(''));
    matrix.forEach((line, rowOffset) => line.forEach((value, columnOffset) => {
      const column = startColumn + columnOffset;
      if (column < INITIAL_HEADERS.length && !isSpacerColumn(column)) nextRows[startRow + rowOffset][column] = value;
    }));
    updateRows(nextRows);
    persistNow();
    window.requestAnimationFrame(() => {
      validateAllSeals(true);
      validateAllMasterSealBlocks();
      void enrichExistingSheet(sealsRef.current);
      focusCell(startRow, startColumn);
    });
  }, [enrichExistingSheet, focusCell, persistNow, updateRows, validateAllMasterSealBlocks, validateAllSeals]);

  const updateFormula = useCallback((value: string) => {
    setFormulaText(value);
    const { row, col } = selectedRef.current;
    if (!rowsRef.current[row]) return;
    rowsRef.current[row][col] = value;
    const cell = gridRef.current?.querySelector<HTMLTableCellElement>(`td[data-row="${row}"][data-col="${col}"]`);
    if (cell) cell.textContent = formulaValue(value, rowsRef.current);
    if (isSealColumn(col)) {
      const seal = sealsByNumberRef.current.get(normalizeSealKey(value));
      const assignedColumn = col + 1;
      rowsRef.current[row][assignedColumn] = seal?.assignedHub || '';
      const assignedCell = gridRef.current?.querySelector<HTMLTableCellElement>(`td[data-row="${row}"][data-col="${assignedColumn}"]`);
      if (assignedCell) assignedCell.textContent = rowsRef.current[row][assignedColumn];
      validateSealCell(row, col, value, true);
    } else if (col % BLOCK_WIDTH === 3) {
      validateMasterSealBlock(row, col);
    }
    persistSoon();
  }, [persistSoon, validateMasterSealBlock, validateSealCell]);

  const goToCell = useCallback((event: React.FormEvent) => {
    event.preventDefault();
    const match = cellName.trim().match(/^([A-Z]+)(\d+)$/i);
    if (!match) return;
    const row = Number(match[2]) - 1;
    const column = columnIndex(match[1]);
    if (row >= 0 && row < rowsRef.current.length && column >= 0 && column < INITIAL_HEADERS.length && !isSpacerColumn(column)) focusCell(row, column);
  }, [cellName, focusCell]);

  const addRow = useCallback(() => {
    const nextRows = [...rowsRef.current, Array(INITIAL_HEADERS.length).fill('')];
    updateRows(nextRows);
    persistSoon();
    window.requestAnimationFrame(() => focusCell(nextRows.length - 1, 0));
  }, [focusCell, persistSoon, updateRows]);

  const exportCsv = useCallback(() => {
    const csv = [INITIAL_HEADERS, ...rowsRef.current].map((row) => row.map(csvValue).join(',')).join('\r\n');
    const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'dispatch-monitor.csv';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const clearSheet = useCallback(() => {
    if (!window.confirm('Clear all locally saved spreadsheet data? This cannot be undone.')) return;
    const nextRows = blankRows();
    legacyDataRef.current = null;
    alertKeyRef.current = '';
    setAlertText('');
    stopAlarm();
    updateRows(nextRows);
    persistNow();
  }, [persistNow, stopAlarm, updateRows]);

  const enableSound = useCallback(async () => {
    try {
      const AudioContextConstructor = window.AudioContext;
      if (!AudioContextConstructor) throw new Error('This browser does not support alarm audio.');
      audioRef.current = audioRef.current || new AudioContextConstructor();
      await audioRef.current.resume();
      playTone(1100, 0.4, 0.8);
      soundEnabledRef.current = true;
      setSoundEnabled(true);
      setMessage({ type: 'ok', text: 'Alarm sound is enabled. A test tone has played.' });
      if (alertKeyRef.current) startAlarm();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not enable alarm audio.' });
    }
  }, [playTone, startAlarm]);

  const stopInvalidAlarm = useCallback(() => {
    alertKeyRef.current = '';
    setAlertText('');
    stopAlarm();
  }, [stopAlarm]);

  const manualRefresh = () => setRefreshVersion((value) => value + 1);
  const localConnectionCopy = connection === 'checking'
    ? 'Checking the Bosta connection…'
    : connection === 'error'
      ? connectionError || 'The Bosta connection could not be checked.'
      : syncDetail;

  return <div className="loading-check-section">
    <section className="loading-check-hero">
      <div><span className="loading-check-eyebrow"><KeyRound size={13} /> BOSTA LIVE · READ ONLY</span><h2>Dispatch &amp; Seal Monitor</h2><p>Validate seal numbers against the live seal list. Your spreadsheet stays local and saves as you type.</p></div>
      <div className={`loading-check-sync-badge ${syncState === 'connected' ? 'is-connected' : syncState === 'error' ? 'is-error' : syncState === 'syncing' || syncState === 'retrying' ? 'is-working' : ''}`} role="status"><span />{syncState === 'syncing' ? 'Syncing' : syncState === 'connected' ? 'Live sync' : syncState === 'retrying' ? 'Retrying' : syncState === 'error' ? 'Offline' : 'Not connected'}</div>
    </section>

    <section className="loading-check-setup miss-panel">
      <label className="loading-check-source"><span>Source hub</span><select value={sourceHubId} onChange={(event) => { setSourceHubId(event.target.value); setDestinationHubId(''); setPage(1); }} disabled={connection !== 'connected'}>{sourceHubOptions.map((hub) => <option key={hub.id} value={hub.id}>{hub.name}</option>)}{sourceHubOptions.length === 0 && <option value="">{connection === 'connected' ? 'No supported source hub' : 'Connect token to load hubs'}</option>}</select></label>
      <label className="loading-check-destination"><span>Destination hub</span><select value={destinationHubId} onChange={(event) => { setDestinationHubId(event.target.value); setPage(1); }} disabled={connection !== 'connected'}><option value="">All destinations</option>{hubs.map((hub) => <option key={hub.id} value={hub.id}>{hub.name}</option>)}</select></label>
      <button type="button" className="btn sm" onClick={manualRefresh} disabled={connection !== 'connected' || syncState === 'syncing'}><RefreshCw size={15} /> Refresh</button>
      <p>Use the shared Bosta token field in the fixed header. System seal lookups refresh every 30 seconds; spreadsheet edits are saved locally.</p>
    </section>

    {connection === 'disconnected' && <div className="workspace-notice is-info" role="status">Connect with the shared Bosta token in the fixed header to load seals.</div>}
    {connection === 'error' && <div className="workspace-notice" role="alert">{connectionError || 'Bosta connection unavailable. Check the token in the fixed header.'}</div>}
    {message && <div className={`loading-check-message is-${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}><span>{message.type === 'error' ? <AlertTriangle size={16} /> : <Check size={16} />}</span><p>{message.text}</p><button type="button" onClick={() => setMessage(null)} aria-label="Dismiss message"><X size={15} /></button></div>}

    {alertText && <section className="loading-check-alert" role="alert"><strong><AlertTriangle size={17} /> {alertText}</strong><button type="button" className="btn sm" onClick={stopInvalidAlarm}><CircleStop size={15} /> Stop alert</button></section>}

    <section className="miss-panel loading-check-seals-panel">
      <div className="loading-check-panel-head"><div><div className="loading-check-panel-title"><h3>System seals</h3><span className="loading-check-count">{seals.length.toLocaleString()}</span></div><p>{localConnectionCopy}</p></div><div className="loading-check-sync-meta"><span>{updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString()}` : hasSnapshot && snapshotAt ? `Saved snapshot ${new Date(snapshotAt).toLocaleString()}` : 'Waiting for first sync'}</span><span className={syncState === 'connected' ? 'is-live' : ''}><i /> {syncState === 'connected' ? 'Connected' : syncState === 'syncing' ? 'Syncing…' : syncState === 'retrying' ? 'Retry scheduled' : 'Offline'}</span></div></div>
      <div className="loading-check-seals-scroll"><table><thead><tr>{['Seal number', 'Type', 'Status', 'Packages', 'Source hub', 'Destination hub', 'Assigned hub', 'Updated'].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>
        {shownSeals.length ? shownSeals.map((seal) => <tr key={seal.number}><td className="lc-mono">{seal.number}</td><td>{seal.type || '—'}</td><td>{seal.state || 'Unknown'}</td><td>{seal.packages || '—'}</td><td>{seal.source || '—'}</td><td>{seal.destination || '—'}</td><td>{seal.assignedHub || 'Not returned by API'}</td><td>{seal.updated && !Number.isNaN(Date.parse(seal.updated)) ? new Date(seal.updated).toLocaleString() : seal.updated || '—'}</td></tr>) : <tr><td colSpan={8} className="loading-check-empty">{hasSnapshot ? 'No system seals were returned for this filter.' : connection === 'connected' ? 'Loading system seals…' : 'Connect to load system seals.'}</td></tr>}
      </tbody></table></div>
      <div className="loading-check-seal-pagination"><span>{seals.length ? `Page ${page} of ${sealPageCount}` : 'Page 0 of 0'}</span><div><button type="button" className="btn sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><button type="button" className="btn sm" disabled={page >= sealPageCount || !seals.length} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
    </section>

    <section className="miss-panel loading-check-sheet-panel">
      <div className="loading-check-panel-head"><div><div className="loading-check-panel-title"><h3>Dispatch spreadsheet</h3><span className="loading-check-count">{recordCount.toLocaleString()} rows</span></div><p>Enter a seal number to validate it and fill its Assigned Hub from the latest local seal snapshot.</p><p className="loading-check-manifest-status" aria-live="polite">Master Seal dispatch check from mainfest · {manifestDate} Cairo time · {isManifestDispatchLoading ? 'Checking…' : manifestDispatchError ? 'Unavailable' : `${manifestDispatches.length.toLocaleString()} Master Seals loaded`}</p></div><div className="loading-check-sheet-tools"><button type="button" className="btn sm" onClick={addRow}>+ Add row</button><button type="button" className="btn sm" onClick={exportCsv}><Download size={15} /> Export CSV</button><button type="button" className="btn sm danger" onClick={clearSheet}>Clear sheet</button></div></div>
      <form className="loading-check-formula" onSubmit={goToCell}><input aria-label="Cell name" className="loading-check-namebox" value={cellName} onChange={(event) => setCellName(event.target.value.toUpperCase())} /><button type="submit" className="loading-check-goto" title="Go to cell">↵</button><span>ƒx</span><input aria-label="Formula bar" value={formulaText} onChange={(event) => updateFormula(event.target.value)} /></form>
      <div className="loading-check-grid-scroll"><MemoSpreadsheetGrid headers={INITIAL_HEADERS} rows={rows} tableRef={gridRef} onInput={handleGridInput} onFocus={handleGridFocus} onClick={handleGridClick} onKeyDown={handleGridKeyDown} onCopy={handleGridCopy} onPaste={handleGridPaste} /></div>
      <div className="loading-check-sheet-foot"><span>Changes save locally as you type. Arrows move · Shift + Arrows select · Ctrl + C copies the selected range.</span><span>{storageStatus} · {hasSnapshot ? `${seals.length.toLocaleString()} seals cached` : 'No seal snapshot yet'}</span></div>
      <div className="loading-check-sound-tools"><span>{hasSnapshot ? 'Seal validation uses the last successful sync.' : 'Seal validation starts after the first successful sync.'}</span><div><button type="button" className={`btn sm${soundEnabled ? ' is-on' : ''}`} onClick={() => void enableSound()}>{soundEnabled ? <Bell size={15} /> : <BellOff size={15} />}{soundEnabled ? 'Alarm sound on · test' : 'Enable alarm sound'}</button></div></div>
    </section>
  </div>;
};
