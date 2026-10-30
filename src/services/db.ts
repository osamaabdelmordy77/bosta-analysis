import { UploadedFile, ShipmentRecord } from '../types';

const DB_NAME = 'LogisticsAnalyticsDB';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

export function initDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Files store
      if (!db.objectStoreNames.contains('files')) {
        const fileStore = db.createObjectStore('files', { keyPath: 'id' });
        fileStore.createIndex('name', 'name', { unique: false });
        fileStore.createIndex('detectedDate', 'detectedDate', { unique: false });
        fileStore.createIndex('uploadedAt', 'uploadedAt', { unique: false });
      }

      // Shipments store
      if (!db.objectStoreNames.contains('shipments')) {
        const shipmentStore = db.createObjectStore('shipments', { keyPath: 'id' });
        shipmentStore.createIndex('fileId', 'fileId', { unique: false });
        shipmentStore.createIndex('shipmentDate', 'shipmentDate', { unique: false });
        shipmentStore.createIndex('tracking', 'tracking', { unique: false });
      }

      // Settings store
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

export async function getStoredFiles(): Promise<UploadedFile[]> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readonly');
    const store = tx.objectStore('files');
    const req = store.getAll();
    req.onsuccess = () => {
      const files = req.result as UploadedFile[];
      // sort by uploadedAt descending
      files.sort((a, b) => b.uploadedAt - a.uploadedAt);
      resolve(files);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getAllStoredShipments(): Promise<ShipmentRecord[]> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('shipments', 'readonly');
    const store = tx.objectStore('shipments');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as ShipmentRecord[]);
    req.onerror = () => reject(req.error);
  });
}

export async function saveFileWithShipments(
  file: UploadedFile,
  records: ShipmentRecord[]
): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['files', 'shipments'], 'readwrite');
    const fileStore = tx.objectStore('files');
    const shipmentStore = tx.objectStore('shipments');

    // First, remove existing records for this file if it's being re-uploaded/replaced
    const index = shipmentStore.index('fileId');
    const req = index.openCursor(IDBKeyRange.only(file.id));

    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        // All prior records for file removed, now add updated file & records
        fileStore.put(file);
        for (const record of records) {
          shipmentStore.put(record);
        }
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteStoredFile(fileId: string): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['files', 'shipments'], 'readwrite');
    const fileStore = tx.objectStore('files');
    const shipmentStore = tx.objectStore('shipments');

    fileStore.delete(fileId);

    const index = shipmentStore.index('fileId');
    const req = index.openCursor(IDBKeyRange.only(fileId));

    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function updateStoredFileDate(fileId: string, newDate: string): Promise<void> {
  const db = await initDB();
  const [y, m, d] = newDate.split('-');
  const dateMs = Date.UTC(+y, +m - 1, +d);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['files', 'shipments'], 'readwrite');
    const fileStore = tx.objectStore('files');
    const shipmentStore = tx.objectStore('shipments');

    const fileReq = fileStore.get(fileId);
    fileReq.onsuccess = () => {
      const file = fileReq.result as UploadedFile | undefined;
      if (file) {
        file.detectedDate = newDate;
        file.manualDate = true;
        fileStore.put(file);
      }
    };

    const index = shipmentStore.index('fileId');
    const curReq = index.openCursor(IDBKeyRange.only(fileId));
    curReq.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        const record = cursor.value as ShipmentRecord;
        record.shipmentDate = newDate;
        record.dateMs = dateMs;
        cursor.update(record);
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllStoredData(): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['files', 'shipments', 'settings'], 'readwrite');
    tx.objectStore('files').clear();
    tx.objectStore('shipments').clear();
    tx.objectStore('settings').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveSetting<T>(key: string, value: T): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getSetting<T>(key: string): Promise<T | null> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readonly');
    const req = tx.objectStore('settings').get(key);
    req.onsuccess = () => resolve(req.result ? (req.result.value as T) : null);
    req.onerror = () => reject(req.error);
  });
}
