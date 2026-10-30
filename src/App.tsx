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
import {
  getStoredFiles,
  getAllStoredShipments,
  saveFileWithShipments,
  deleteStoredFile,
  updateStoredFileDate,
  clearAllStoredData,
  saveSetting,
  getSetting,
} from './services/db';
import { processExcelFile } from './services/excelService';
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

  // Initial load from IndexedDB
  useEffect(() => {
    async function loadData() {
      try {
        const storedFiles = await getStoredFiles();
        const storedShipments = await getAllStoredShipments();
        const savedHubBasis = await getSetting<string>('hubBasis');
        const savedOverrides = await getSetting<Partial<ColumnMapping>>('columnOverrides');

        setFiles(storedFiles);
        setShipments(storedShipments);

        if (savedHubBasis) setHubBasis(savedHubBasis);
        if (savedOverrides) setColumnOverrides(savedOverrides);

        // Collect all distinct hub labels and headers
        const hubsSet = new Set<string>();
        storedShipments.forEach((s) => {
          Object.keys(s.hubs || {}).forEach((k) => hubsSet.add(k));
        });
        const hList = Array.from(hubsSet);
        setHubLabels(hList);
        if (!savedHubBasis && hList.length > 0) {
          const pref = hList.find((l) => /assigned/i.test(l)) || hList[0];
          setHubBasis(pref);
        }
      } catch (err) {
        console.error('Failed to load from IndexedDB:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  // Update hub basis setting
  const handleHubBasisChange = useCallback(async (newBasis: string) => {
    setHubBasis(newBasis);
    await saveSetting('hubBasis', newBasis);
  }, []);

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
    await saveSetting('columnOverrides', columnOverrides);
    alert('Column mappings updated. New files will use these settings.');
  }, [columnOverrides]);

  // Process and ingest uploaded files
  const handleProcessFiles = async (pending: PendingFile[]) => {
    const updatedFiles = [...files];
    let allNewRecords: ShipmentRecord[] = [];
    const newHubsSet = new Set(hubLabels);
    const newHeadersSet = new Set(allHeaders);

    for (const p of pending) {
      try {
        const parsed = await processExcelFile({
          file: p.file,
          fileId: p.name, // Use filename as primary key to automatically prevent duplicate file re-ingestions
          shipmentDate: p.detectedDate,
          overrides: columnOverrides as Record<string, string>,
        });

        const fileMeta: UploadedFile = {
          id: p.name,
          name: p.name,
          size: p.file.size,
          detectedDate: p.detectedDate,
          manualDate: p.isManualDate,
          recordCount: parsed.records.length,
          duplicateCount: parsed.stats.duplicatesRemoved,
          uploadedAt: Date.now(),
          sheetsCount: parsed.stats.sheetsCount,
        };

        // Save file & records to IndexedDB
        await saveFileWithShipments(fileMeta, parsed.records);

        // Update local arrays
        const existingIdx = updatedFiles.findIndex((f) => f.name === p.name);
        if (existingIdx >= 0) {
          updatedFiles[existingIdx] = fileMeta;
        } else {
          updatedFiles.unshift(fileMeta);
        }

        allNewRecords = [
          ...allNewRecords.filter((r) => r.fileName !== p.name),
          ...parsed.records,
        ];

        parsed.hubLabels.forEach((l) => newHubsSet.add(l));
        parsed.allHeaders.forEach((h) => newHeadersSet.add(h));
      } catch (err) {
        console.error(`Failed parsing file ${p.name}:`, err);
        alert(`Could not process ${p.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Reload all records from IndexedDB to guarantee pristine state
    const refreshedShipments = await getAllStoredShipments();
    setFiles(updatedFiles);
    setShipments(refreshedShipments);

    const hList = Array.from(newHubsSet);
    setHubLabels(hList);
    setAllHeaders(Array.from(newHeadersSet));

    if (!hubBasis && hList.length > 0) {
      const pref = hList.find((l) => /assigned/i.test(l)) || hList[0];
      setHubBasis(pref);
    }
  };

  // Delete a specific file
  const handleDeleteFile = async (fileId: string) => {
    if (!confirm('Are you sure you want to remove this file and all its records?')) return;
    await deleteStoredFile(fileId);
    const refreshedFiles = await getStoredFiles();
    const refreshedShipments = await getAllStoredShipments();
    setFiles(refreshedFiles);
    setShipments(refreshedShipments);
  };

  // Update a file's assigned date
  const handleUpdateFileDate = async (fileId: string, newDate: string) => {
    await updateStoredFileDate(fileId, newDate);
    const refreshedFiles = await getStoredFiles();
    const refreshedShipments = await getAllStoredShipments();
    setFiles(refreshedFiles);
    setShipments(refreshedShipments);
  };

  // Clear all stored data
  const handleClearAll = async () => {
    if (!confirm('Are you sure you want to clear ALL uploaded data? This action cannot be undone.')) {
      return;
    }
    await clearAllStoredData();
    setFiles([]);
    setShipments([]);
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

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-[#050a18cc] grid place-items-center z-50">
        <div className="bg-[#111a33] border border-[#1d2a4d] p-6 rounded-xl flex items-center gap-3 text-slate-200">
          <Loader2 className="w-5 h-5 animate-spin text-sky-400" />
          <span>Restoring local logistics data from IndexedDB…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      {/* Header */}
      <Header
        files={files}
        totalShipments={shipments.length}
        filteredShipments={filteredShipments.length}
        onOpenUpload={() => setIsUploadOpen(true)}
        onOpenFileManager={() => setIsFileManagerOpen(true)}
        onOpenDuplicateInfo={() => setIsDuplicateInfoOpen(true)}
        onClearAll={() => setIsClearConfirmOpen(true)}
      />

      {/* When no files are uploaded, show the welcoming Drop zone */}
      {files.length === 0 ? (
        <div className="drop">
          <FileSpreadsheet className="w-16 h-16 text-sky-400 mx-auto mb-4 opacity-90" />
          <h2>Upload your daily shipment Excel files</h2>
          <p>
            Drag &amp; drop one daily report, multiple daily files, or an entire month&apos;s data at once (
            <b>.xlsx</b> or <b>.xls</b>). Dates are automatically extracted from filenames (e.g.{' '}
            <code>Shipment_2026-07-01.xlsx</code>). All files are processed via Web Workers and stored securely
            in your browser&apos;s IndexedDB — no company data is ever sent to external servers.
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
                This will delete all uploaded daily Excel reports and clear your browser&apos;s IndexedDB
                database. You will need to re-upload your Excel workbooks to analyze them again.
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
