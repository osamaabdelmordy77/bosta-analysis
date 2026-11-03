/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  UploadedFile,
  ShipmentRecord,
  FilterState,
  ColumnMapping,
} from './types';
import { setupChartJS } from './utils/chartSetup';
import { processExcelFile } from './services/excelService';
import { BackendConnectionStatus, checkBackendConnection } from './services/backend';
import {
  archiveAllImports,
  archiveImport,
  AuthUser,
  ApiError,
  getAllShipments,
  getCurrentUser,
  getImportFiles,
  getOrganizationSettings,
  getOrganizations,
  login,
  logout,
  OrganizationOption,
  publishWorkbookImport,
  saveOrganizationSetting,
  startWorkbookImport,
  updateImportDate,
  uploadWorkbookRows,
} from './services/api';
import { migrateAndRemoveLegacyIndexedDb } from './services/legacyIndexedDbMigration';
import { filterShipments, computeAggregations } from './utils/analytics';

// Components
import { Header } from './components/Header';
import { FilterBar } from './components/FilterBar';
import { KPICards } from './components/KPICards';
import { MainGridPanels } from './components/MainGridPanels';
import { TimeAnalyticsSection } from './components/TimeAnalyticsSection';
import { HubSection } from './components/HubSection';
import { BusinessSection } from './components/BusinessSection';
import { GeographySection } from './components/GeographySection';
import { ShipmentExplorerSection } from './components/ShipmentExplorerSection';
import { ProfileSection } from './components/ProfileSection';
import { UploadModal, PendingFile } from './components/UploadModal';
import { FileManagerModal } from './components/FileManagerModal';
import { DuplicateExplainerModal } from './components/DuplicateExplainerModal';
import { LoginPanel } from './components/LoginPanel';

import { Upload, FileSpreadsheet, AlertTriangle, Loader2 } from 'lucide-react';

// Initialize ChartJS plugins & defaults
setupChartJS();

const DEFAULT_FILTERS: FilterState = {
  hub: new Set(),
  biz: new Set(),
  st: new Set(),
  pt: new Set(),
  pc: new Set(),
  dc: new Set(),
  year: 'all',
  month: 'all',
  specificDate: 'all',
  dateFrom: '',
  dateTo: '',
};

export default function App() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [shipments, setShipments] = useState<ShipmentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [backendStatus, setBackendStatus] = useState<BackendConnectionStatus | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
  const [activeOrganization, setActiveOrganization] = useState<OrganizationOption | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [migrationMessage, setMigrationMessage] = useState<string | null>(null);

  // Modals state
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isFileManagerOpen, setIsFileManagerOpen] = useState(false);
  const [isDuplicateInfoOpen, setIsDuplicateInfoOpen] = useState(false);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);

  // Filters state
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

  // Column mapping & hub basis settings
  const [hubBasis, setHubBasis] = useState<string>('Assigned Hub');
  const [columnOverrides, setColumnOverrides] = useState<Partial<ColumnMapping>>({});
  const [allHeaders, setAllHeaders] = useState<string[]>([]);
  const [hubLabels, setHubLabels] = useState<string[]>([]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const controller = new AbortController();
    setBackendStatus('checking');
    checkBackendConnection(controller.signal)
      .then(() => setBackendStatus('connected'))
      .catch(() => {
        if (!controller.signal.aborted) setBackendStatus('unavailable');
      });

    return () => controller.abort();
  }, []);

  // Restore the authenticated server session.
  useEffect(() => {
    let active = true;
    async function restoreSession() {
      try {
        const user = await getCurrentUser();
        const orgs = await getOrganizations();
        if (!active) return;
        setCurrentUser(user);
        setOrganizations(orgs);
        setActiveOrganization(orgs[0] || null);
      } catch (err) {
        if (active) {
          setCurrentUser(null);
          setOrganizations([]);
          setActiveOrganization(null);
          if (!(err instanceof ApiError && err.status === 401)) {
            setLoadError('Could not connect to the Laravel API. Confirm the backend is running, then reload this page.');
          }
        }
      } finally {
        if (active) {
          setAuthChecked(true);
          setIsLoading(false);
        }
      }
    }
    restoreSession();
    return () => { active = false; };
  }, []);

  const reloadOrganizationData = useCallback(async (organizationSlug: string) => {
    const [importData, serverShipments, settings] = await Promise.all([
      getImportFiles(organizationSlug),
      getAllShipments(organizationSlug),
      getOrganizationSettings(organizationSlug),
    ]);
    setFiles(importData.files);
    setShipments(serverShipments);
    setAllHeaders(importData.headers);
    setHubLabels(importData.hubLabels);
    setHubBasis(settings.hubBasis || importData.hubLabels.find((label) => /assigned/i.test(label)) || importData.hubLabels[0] || 'Assigned Hub');
    setColumnOverrides((settings.columnOverrides || {}) as Partial<ColumnMapping>);
  }, []);

  // Import legacy browser records to MySQL and delete the old database only after count verification.
  useEffect(() => {
    if (!activeOrganization) return;
    let active = true;
    async function loadServerData() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const migration = await migrateAndRemoveLegacyIndexedDb(activeOrganization!.slug, (message) => {
          if (active) setMigrationMessage(message);
        });
        if (!active) return;
        setMigrationMessage(migration.found
          ? [
              `Moved ${migration.records.toLocaleString()} legacy shipment summaries from ${migration.files.toLocaleString()} old browser files into MySQL.`,
              ...(migration.warnings || []),
            ].join(' ')
          : null);
        await reloadOrganizationData(activeOrganization!.slug);
      } catch (err) {
        if (active) setLoadError(err instanceof Error ? err.message : 'Could not load MySQL data.');
      } finally {
        if (active) setIsLoading(false);
      }
    }
    loadServerData();
    return () => { active = false; };
  }, [activeOrganization, reloadOrganizationData]);

  const handleLogin = async (email: string, password: string) => {
    setAuthSubmitting(true);
    setAuthError(null);
    setLoadError(null);
    try {
      const user = await login(email, password);
      const orgs = await getOrganizations();
      setCurrentUser(user);
      setOrganizations(orgs);
      setActiveOrganization(orgs[0] || null);
      if (orgs.length === 0) setAuthError('This account has no active organization membership.');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try { await logout(); } catch { /* Clear the local view even if the session has already expired. */ }
    setCurrentUser(null);
    setOrganizations([]);
    setActiveOrganization(null);
    setFiles([]);
    setShipments([]);
    setFilters(DEFAULT_FILTERS);
    setAuthError(null);
    setLoadError(null);
  };

  // Update hub basis setting
  const handleHubBasisChange = useCallback(async (newBasis: string) => {
    setHubBasis(newBasis);
    if (activeOrganization) await saveOrganizationSetting(activeOrganization.slug, 'hubBasis', newBasis);
  }, [activeOrganization]);

  // Column override change
  const handleColumnOverrideChange = useCallback(
    (role: keyof ColumnMapping, colName: string) => {
      setColumnOverrides((prev) => ({
        ...prev,
        [role]: colName,
      }));
    },
    []
  );

  const handleApplyMapping = useCallback(async () => {
    if (!activeOrganization) return;
    await saveOrganizationSetting(activeOrganization.slug, 'columnOverrides', columnOverrides);
    alert('Column mappings updated. New files will use these settings.');
  }, [activeOrganization, columnOverrides]);

  // Process and ingest uploaded files
  const handleProcessFiles = async (pending: PendingFile[]) => {
    if (!activeOrganization) throw new Error('Select an organization before importing workbooks.');
    const processingErrors: string[] = [];
    for (const p of pending) {
      try {
        const parsed = await processExcelFile({
          file: p.file,
          fileId: p.name,
          shipmentDate: p.detectedDate,
          overrides: columnOverrides as Record<string, string>,
        });
        const started = await startWorkbookImport(
          activeOrganization.slug,
          p.file,
          p.detectedDate,
          p.isManualDate,
          parsed,
          columnOverrides as Record<string, string>,
        );

        if (!started.alreadyImported) {
          for (const sheet of parsed.sourceSheets) {
            const sheetId = started.sheetIds[sheet.index];
            if (!sheetId) throw new Error(`The server did not register worksheet ${sheet.name}.`);
            let chunkIndex = 0;
            while (sheet.rows.length > 0) {
              const rows = sheet.rows.splice(0, 200);
              await uploadWorkbookRows(
                activeOrganization.slug,
                started.fileId,
                started.runId,
                sheetId,
                chunkIndex,
                rows,
                columnOverrides as Record<string, string>,
              );
              chunkIndex++;
            }
          }
          await publishWorkbookImport(activeOrganization.slug, started.fileId, started.runId);
        }
      } catch (err) {
        console.error(`Failed importing file ${p.name}:`, err);
        processingErrors.push(`${p.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (processingErrors.length > 0) {
      await reloadOrganizationData(activeOrganization.slug);
      throw new Error(`Could not process the following files:\n${processingErrors.join('\n')}`);
    }

    await reloadOrganizationData(activeOrganization.slug);
  };

  // Delete a specific file
  const handleDeleteFile = async (fileId: string) => {
    if (!activeOrganization || !confirm('Archive this file from the active dashboard? Its MySQL history will be preserved.')) return;
    await archiveImport(activeOrganization.slug, fileId);
    await reloadOrganizationData(activeOrganization.slug);
  };

  // Update a file's assigned date
  const handleUpdateFileDate = async (fileId: string, newDate: string) => {
    if (!activeOrganization) return;
    await updateImportDate(activeOrganization.slug, fileId, newDate);
    await reloadOrganizationData(activeOrganization.slug);
  };

  // Clear all stored data
  const handleClearAll = async () => {
    if (!activeOrganization || !confirm('Archive every upload from the active dashboard? Imported MySQL history will remain available for audit.')) {
      return;
    }
    await archiveAllImports(activeOrganization.slug);
    await reloadOrganizationData(activeOrganization.slug);
    setFilters(DEFAULT_FILTERS);
    setIsClearConfirmOpen(false);
  };

  // Universe of all known hubs
  const allKnownHubs = useMemo(() => {
    const s = new Set<string>();
    shipments.forEach((r) => {
      if (r.assignedHub) s.add(r.assignedHub);
      Object.values(r.hubs || {}).forEach((v) => {
        if (v) s.add(v);
      });
    });
    return Array.from(s).sort();
  }, [shipments]);

  // Baseline Aggregations (unfiltered dataset)
  const baseAgg = useMemo(() => {
    return computeAggregations(shipments, allKnownHubs, hubBasis);
  }, [shipments, allKnownHubs, hubBasis]);

  // Filtered Shipments
  const filteredShipments = useMemo(() => {
    return filterShipments(shipments, filters, hubBasis);
  }, [shipments, filters, hubBasis]);

  // Filtered Aggregations
  const currentAgg = useMemo(() => {
    return computeAggregations(filteredShipments, allKnownHubs, hubBasis);
  }, [filteredShipments, allKnownHubs, hubBasis]);

  // Filter options with live counts
  const availableOptions = useMemo(() => {
    const hubCounts = new Map<string, number>();
    const bizCounts = new Map<string, number>();
    const stCounts = new Map<string, number>();
    const ptCounts = new Map<string, number>();
    const pcCounts = new Map<string, number>();
    const dcCounts = new Map<string, number>();
    const yearSet = new Set<string>();
    const monthSet = new Set<string>();
    const dateSet = new Set<string>();

    for (let i = 0; i < shipments.length; i++) {
      const r = shipments[i];
      const hVal = (hubBasis && r.hubs[hubBasis]) || r.assignedHub;
      if (hVal) hubCounts.set(hVal, (hubCounts.get(hVal) || 0) + 1);
      if (r.business) bizCounts.set(r.business, (bizCounts.get(r.business) || 0) + 1);
      if (r.shipType) stCounts.set(r.shipType, (stCounts.get(r.shipType) || 0) + 1);
      if (r.packageType) ptCounts.set(r.packageType, (ptCounts.get(r.packageType) || 0) + 1);
      if (r.pickupCity) pcCounts.set(r.pickupCity, (pcCounts.get(r.pickupCity) || 0) + 1);
      if (r.dropCity) dcCounts.set(r.dropCity, (dcCounts.get(r.dropCity) || 0) + 1);

      if (r.shipmentDate) {
        dateSet.add(r.shipmentDate);
        monthSet.add(r.shipmentDate.slice(0, 7));
        yearSet.add(r.shipmentDate.slice(0, 4));
      }
    }

    return {
      hubs: Array.from(hubCounts.entries()).map(([name, count]) => ({ name, count })),
      businesses: Array.from(bizCounts.entries()).map(([name, count]) => ({ name, count })),
      shipTypes: Array.from(stCounts.entries()).map(([name, count]) => ({ name, count })),
      pkgTypes: Array.from(ptCounts.entries()).map(([name, count]) => ({ name, count })),
      pickupCities: Array.from(pcCounts.entries()).map(([name, count]) => ({ name, count })),
      dropCities: Array.from(dcCounts.entries()).map(([name, count]) => ({ name, count })),
      years: Array.from(yearSet).sort().reverse(),
      months: Array.from(monthSet).sort().reverse(),
      dates: Array.from(dateSet).sort().reverse(),
    };
  }, [shipments, hubBasis]);

  // Quick filter helpers from chart clicks
  const toggleSingleFilter = useCallback(
    (dim: 'hub' | 'biz' | 'st' | 'pt' | 'pc' | 'dc', value: string) => {
      setFilters((prev) => {
        const nextSet = new Set(prev[dim]);
        if (nextSet.size === 1 && nextSet.has(value)) {
          nextSet.clear();
        } else {
          nextSet.clear();
          nextSet.add(value);
        }
        return { ...prev, [dim]: nextSet };
      });
    },
    []
  );

  const filterByDate = useCallback((date: string) => {
    setFilters((prev) => ({
      ...prev,
      specificDate: prev.specificDate === date ? 'all' : date,
    }));
  }, []);

  const filterByMonth = useCallback((month: string) => {
    setFilters((prev) => ({
      ...prev,
      month: prev.month === month ? 'all' : month,
    }));
  }, []);

  const resetAllFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  const existingFilenames = useMemo(() => new Set(files.map((f) => f.name)), [files]);

  if (!authChecked || isLoading) {
    return (
      <div className="fixed inset-0 bg-[#050a18cc] grid place-items-center z-50">
        <div className="bg-[#111a33] border border-[#1d2a4d] p-6 rounded-xl flex items-center gap-3 text-slate-200">
          <Loader2 className="w-5 h-5 animate-spin text-sky-400" />
          <div>
            <span>Connecting to MySQL and loading workspace data…</span>
            {migrationMessage && <p className="mt-2 text-xs text-slate-400">{migrationMessage}</p>}
          </div>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginPanel error={authError || loadError} isLoading={authSubmitting} onLogin={handleLogin} />;
  }

  if (!activeOrganization) {
    return (
      <LoginPanel
        error="This account has no active organization membership. Ask an organization administrator to grant access."
        isLoading={false}
        onLogin={handleLogin}
      />
    );
  }

  return (
    <div className="wrap">
      {/* Header */}
      <Header
        files={files}
        totalShipments={shipments.length}
        filteredShipments={filteredShipments.length}
        backendStatus={backendStatus}
        currentUser={currentUser}
        organizations={organizations}
        activeOrganization={activeOrganization}
        onOrganizationChange={(slug) => setActiveOrganization(organizations.find((org) => org.slug === slug) || null)}
        onLogout={handleLogout}
        onOpenUpload={() => setIsUploadOpen(true)}
        onOpenFileManager={() => setIsFileManagerOpen(true)}
        onOpenDuplicateInfo={() => setIsDuplicateInfoOpen(true)}
        onClearAll={() => setIsClearConfirmOpen(true)}
      />

      {(loadError || migrationMessage) && (
        <div className={`mx-auto mt-3 max-w-7xl rounded-lg border px-4 py-3 text-sm ${loadError ? 'border-rose-500/40 bg-rose-500/10 text-rose-200' : 'border-sky-500/40 bg-sky-500/10 text-sky-100'}`} role={loadError ? 'alert' : 'status'}>
          {loadError || migrationMessage}
        </div>
      )}

      {/* When no files are uploaded, show the welcoming Drop zone */}
      {files.length === 0 ? (
        <div className="drop">
          <FileSpreadsheet className="w-16 h-16 text-sky-400 mx-auto mb-4 opacity-90" />
          <h2>Upload your daily shipment Excel files</h2>
          <p>
            Drag &amp; drop one daily report, multiple daily files, or an entire month&apos;s data at once (
            <b>.xlsx</b> or <b>.xls</b>). Dates are automatically extracted from filenames (e.g.{' '}
            <code>Shipment_2026-07-01.xlsx</code>). All files are processed via Web Workers and stored securely
            in this organization&apos;s MySQL database, including the original workbook and its source rows.
          </p>
          <button
            type="button"
            className="btn pri"
            onClick={() => setIsUploadOpen(true)}
          >
            <Upload className="w-4 h-4" />
            <span>Choose Excel Files to Upload</span>
          </button>
        </div>
      ) : (
        <main>
          {/* Legend and Active Filter Note */}
          <div className="legend">
            <span>
              <i style={{ background: 'var(--pink)' }} />
              Below average
            </span>
            <span>
              <i style={{ background: 'var(--light)' }} />
              Above average
            </span>
            <span>
              <i className="tick" />
              Average / full-dataset marker
            </span>

            <span className="ml-auto text-xs font-semibold text-slate-300">
              {filteredShipments.length.toLocaleString()} of {shipments.length.toLocaleString()} shipments
              {filteredShipments.length < shipments.length && ' (Filters applied)'}
            </span>
          </div>

          {/* Global Filter Bar */}
          <FilterBar
            filters={filters}
            onFilterChange={setFilters}
            onClearFilters={resetAllFilters}
            availableOptions={availableOptions}
          />

          {/* Empty filtered warning */}
          {filteredShipments.length === 0 && (
            <div className="warn flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span>
                  No shipments match the selected filters. Click &quot;Clear all filters&quot; to restore view.
                </span>
              </div>
              <button
                type="button"
                className="btn sm"
                onClick={resetAllFilters}
              >
                Clear all filters
              </button>
            </div>
          )}

          {/* 10 KPI Cards */}
          <KPICards current={currentAgg} base={baseAgg} />

          {/* 3 Main Grid Panels */}
          <MainGridPanels
            data={currentAgg}
            onFilterHub={(name) => toggleSingleFilter('hub', name)}
            onFilterBiz={(name) => toggleSingleFilter('biz', name)}
            onFilterShipType={(st) => toggleSingleFilter('st', st)}
            onFilterPkgType={(pt) => toggleSingleFilter('pt', pt)}
          />

          {/* Time Analytics Section (New requirement) */}
          <TimeAnalyticsSection
            data={currentAgg}
            onFilterDate={filterByDate}
            onFilterMonth={filterByMonth}
          />

          {/* Hub Performance Section */}
          <HubSection
            data={currentAgg}
            hubBasis={hubBasis}
            onFilterHub={(name) => toggleSingleFilter('hub', name)}
          />

          {/* Business Analysis Section */}
          <BusinessSection
            data={currentAgg}
            onFilterBiz={(name) => toggleSingleFilter('biz', name)}
          />

          {/* Geography, Packages & Items Section */}
          <GeographySection
            data={currentAgg}
            onFilterPickupCity={(c) => toggleSingleFilter('pc', c)}
            onFilterDropCity={(c) => toggleSingleFilter('dc', c)}
            onFilterShipType={(st) => toggleSingleFilter('st', st)}
          />

          {/* Full Shipment Explorer Section */}
          <ShipmentExplorerSection shipments={filteredShipments} />

          {/* Data Profile, Mapping & Methodology */}
          <ProfileSection
            files={files}
            totalShipments={shipments.length}
            totalDuplicatesRemoved={files.reduce((s, f) => s + f.duplicateCount, 0)}
            allHeaders={allHeaders}
            hubLabels={hubLabels}
            hubBasis={hubBasis}
            onHubBasisChange={handleHubBasisChange}
            columnOverrides={columnOverrides}
            onColumnOverrideChange={handleColumnOverrideChange}
            onApplyMapping={handleApplyMapping}
          />
        </main>
      )}

      {/* Multi-File Upload Modal */}
      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onProcessFiles={handleProcessFiles}
        existingFilenames={existingFilenames}
      />

      {/* File Manager Modal */}
      <FileManagerModal
        isOpen={isFileManagerOpen}
        onClose={() => setIsFileManagerOpen(false)}
        files={files}
        onDeleteFile={handleDeleteFile}
        onUpdateFileDate={handleUpdateFileDate}
        onClearAll={() => {
          setIsFileManagerOpen(false);
          setIsClearConfirmOpen(true);
        }}
      />

      {/* Duplicate Handling Explainer Modal */}
      <DuplicateExplainerModal
        isOpen={isDuplicateInfoOpen}
        onClose={() => setIsDuplicateInfoOpen(false)}
      />

      {/* Clear Confirmation Modal */}
      {isClearConfirmOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '440px' }}>
            <div className="modal-header">
              <h3 className="text-red-400">Clear All Stored Data?</h3>
              <button
                type="button"
                className="text-slate-400 hover:text-white"
                onClick={() => setIsClearConfirmOpen(false)}
              >
                &times;
              </button>
            </div>
            <div className="modal-body text-xs text-slate-300">
              <p>
                This archives every uploaded report from the active dashboard. Original workbooks, imported rows,
                and audit history remain preserved in MySQL.
              </p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn sm"
                onClick={() => setIsClearConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn sm danger"
                onClick={handleClearAll}
              >
                Yes, Clear Everything
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
