import { UploadedFile, ShipmentRecord } from '../types';
import {
  completeLegacyFileMigration,
  LegacyFileMetadata,
  saveOrganizationSetting,
  startLegacyFileMigration,
  uploadLegacyRecords,
} from './api';

const LEGACY_DATABASE_NAME = 'LogisticsAnalyticsDB';
const LEGACY_BATCH_SIZE = 500;
let migrationPromise: Promise<LegacyMigrationResult> | null = null;

export interface LegacyMigrationResult {
  found: boolean;
  files: number;
  records: number;
  warnings?: string[];
}

interface LegacySnapshot {
  database: IDBDatabase;
  files: UploadedFile[];
  settings: Array<{ key: string; value: unknown }>;
  shipmentCount: number;
}

interface LegacyRecordPage {
  records: ShipmentRecord[];
  lastKey: IDBValidKey | null;
}

async function readLegacyDatabase(): Promise<LegacySnapshot | null> {
  const factory = indexedDB as IDBFactory & {
    databases?: () => Promise<Array<{ name?: string }>>;
  };

  if (factory.databases) {
    const databases = await factory.databases();
    if (!databases.some((database) => database.name === LEGACY_DATABASE_NAME)) return null;
  }

  const database = await new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DATABASE_NAME);
    let wasMissing = false;

    request.onupgradeneeded = (event) => {
      if ((event as IDBVersionChangeEvent).oldVersion === 0) {
        wasMissing = true;
        request.transaction?.abort();
      }
    };
    request.onerror = () => {
      if (wasMissing) resolve(null);
      else reject(request.error || new Error('Could not read the legacy browser database.'));
    };
    request.onsuccess = () => resolve(wasMissing ? (request.result.close(), null) : request.result);
  });
  if (!database) return null;

  const requiredStores = ['files', 'shipments', 'settings'];
  if (requiredStores.some((store) => !database.objectStoreNames.contains(store))) {
    database.close();
    throw new Error('The old browser database is missing a required store; it was kept unchanged.');
  }

  try {
    return await new Promise<LegacySnapshot>((resolve, reject) => {
      const transaction = database.transaction(requiredStores, 'readonly');
      const filesRequest = transaction.objectStore('files').getAll();
      const settingsRequest = transaction.objectStore('settings').getAll();
      const shipmentCountRequest = transaction.objectStore('shipments').count();

      transaction.oncomplete = () => resolve({
        database,
        files: filesRequest.result as UploadedFile[],
        settings: settingsRequest.result as Array<{ key: string; value: unknown }>,
        shipmentCount: shipmentCountRequest.result,
      });
      transaction.onerror = () => reject(transaction.error || new Error('Could not read legacy file metadata.'));
      transaction.onabort = () => reject(transaction.error || new Error('Could not read legacy file metadata.'));
    });
  } catch (error) {
    database.close();
    throw error;
  }
}

function countLegacyFileRecords(database: IDBDatabase, fileId: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('shipments', 'readonly');
    const request = transaction.objectStore('shipments').index('fileId').count(IDBKeyRange.only(fileId));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(`Could not count old rows for ${fileId}.`));
    transaction.onerror = () => reject(transaction.error || new Error(`Could not count old rows for ${fileId}.`));
  });
}

function readLegacyRecordsPage(
  database: IDBDatabase,
  fileId: string,
  afterKey: IDBValidKey | null,
): Promise<LegacyRecordPage> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('shipments', 'readonly');
    const index = transaction.objectStore('shipments').index('fileId');
    const request = index.openCursor(IDBKeyRange.only(fileId));
    const records: ShipmentRecord[] = [];
    let lastKey: IDBValidKey | null = null;
    let afterPositioned = afterKey === null;

    request.onsuccess = () => {
      const cursor = request.result as IDBCursorWithValue | null;
      if (!cursor) return;

      if (!afterPositioned && afterKey !== null) {
        const comparison = indexedDB.cmp(cursor.primaryKey, afterKey);
        if (comparison <= 0) {
          if (comparison === 0) cursor.continue();
          else if (typeof cursor.continuePrimaryKey === 'function') cursor.continuePrimaryKey(fileId, afterKey);
          else cursor.continue();
          return;
        }
        afterPositioned = true;
      }

      records.push(cursor.value as ShipmentRecord);
      lastKey = cursor.primaryKey;
      if (records.length < LEGACY_BATCH_SIZE) cursor.continue();
    };

    request.onerror = () => reject(request.error || new Error(`Could not read old rows for ${fileId}.`));
    transaction.oncomplete = () => resolve({ records, lastKey });
    transaction.onerror = () => reject(transaction.error || new Error(`Could not read old rows for ${fileId}.`));
    transaction.onabort = () => reject(transaction.error || new Error(`Could not read old rows for ${fileId}.`));
  });
}

async function deleteLegacyDatabase(database: IDBDatabase): Promise<void> {
  database.close();
  const factory = indexedDB as IDBFactory & {
    databases?: () => Promise<Array<{ name?: string }>>;
  };
  if (factory.databases) {
    const databases = await factory.databases();
    if (!databases.some((entry) => entry.name === LEGACY_DATABASE_NAME)) return;
  }

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LEGACY_DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('The old browser database could not be deleted.'));
    request.onblocked = () => reject(new Error('Close any older dashboard tabs before removing the old browser database.'));
  });
}

async function performLegacyMigration(
  organizationSlug: string,
  onProgress?: (message: string) => void,
): Promise<LegacyMigrationResult> {
  const snapshot = await readLegacyDatabase();
  if (!snapshot) return { found: false, files: 0, records: 0 };

  try {
    for (const setting of snapshot.settings) {
      if (setting.key === 'hubBasis' || setting.key === 'columnOverrides') {
        await saveOrganizationSetting(organizationSlug, setting.key, setting.value);
      }
    }

    const fileIds = new Set(snapshot.files.map((file) => file.id));
    const warnings: string[] = [];
    let recordsMigrated = 0;
    let filesMigrated = 0;

    for (const file of snapshot.files) {
      const actualCount = await countLegacyFileRecords(snapshot.database, file.id);
      if (actualCount !== file.recordCount) {
        warnings.push(`${file.name}: metadata listed ${file.recordCount} rows; ${actualCount} rows were found and migrated.`);
      }

      onProgress?.(`Migrating old file ${filesMigrated + 1} of ${snapshot.files.length}: ${file.name}`);
      const metadata: LegacyFileMetadata = {
        id: file.id,
        name: file.name,
        size: file.size,
        detectedDate: file.detectedDate,
        manualDate: file.manualDate,
        recordCount: actualCount,
        duplicateCount: file.duplicateCount,
        uploadedAt: file.uploadedAt,
        sheetsCount: file.sheetsCount,
      };
      const migration = await startLegacyFileMigration(organizationSlug, metadata);

      if (!migration.complete) {
        let afterKey: IDBValidKey | null = null;
        let chunkIndex = 0;
        let recordsRead = 0;
        while (recordsRead < actualCount) {
          const page = await readLegacyRecordsPage(snapshot.database, file.id, afterKey);
          if (page.records.length === 0 || page.lastKey === null) {
            throw new Error(`Legacy row scan stopped early for ${file.name}; the browser database was kept intact.`);
          }
          await uploadLegacyRecords(organizationSlug, migration.id, chunkIndex, page.records);
          afterKey = page.lastKey;
          recordsRead += page.records.length;
          chunkIndex++;
        }
      }

      const verifiedCount = await completeLegacyFileMigration(organizationSlug, migration.id);
      if (verifiedCount !== actualCount) {
        throw new Error(`MySQL verification failed for ${file.name}; the old browser database was kept intact.`);
      }
      recordsMigrated += verifiedCount;
      filesMigrated++;
    }

    if (recordsMigrated !== snapshot.shipmentCount) {
      const unassigned = snapshot.shipmentCount - recordsMigrated;
      throw new Error(`Found ${unassigned} old shipment rows without matching file metadata. MySQL copies were retained, and IndexedDB was kept intact.`);
    }

    onProgress?.('All old rows are verified in MySQL. Removing the browser database…');
    await deleteLegacyDatabase(snapshot.database);
    return { found: true, files: filesMigrated, records: recordsMigrated, warnings };
  } catch (error) {
    snapshot.database.close();
    throw error;
  }
}

export function migrateAndRemoveLegacyIndexedDb(
  organizationSlug: string,
  onProgress?: (message: string) => void,
): Promise<LegacyMigrationResult> {
  if (!migrationPromise) {
    migrationPromise = performLegacyMigration(organizationSlug, onProgress).finally(() => {
      migrationPromise = null;
    });
  }
  return migrationPromise;
}
