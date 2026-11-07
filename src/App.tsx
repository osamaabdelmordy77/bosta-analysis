/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  UploadedFile,
  ShipmentRecord,
  FilterState,
  ColumnMapping,
} from './types';
import { BackendConnectionStatus, checkBackendConnection } from './services/backend';
import {
  archiveAllImports,
  archiveImport,
  AccessPermission,
  AccessRole,
  AuthUser,
  ApiError,
  getAccessCatalog,
  getImportJobs,
  getAllShipments,
  getCurrentUser,
  getImportFiles,
  getOrganizationMembers,
  OrganizationMember,
  getOrganizationSettings,
  getOrganizations,
  login,
  logout,
  ImportJob,
  OrganizationOption,
  retryImportRun,
  saveOrganizationSetting,
  uploadWorkbookFile,
  updateImportDate,
} from './services/api';
import { migrateAndRemoveLegacyIndexedDb } from './services/legacyIndexedDbMigration';
import { filterShipments, computeAggregations } from './utils/analytics';

// Components
import { Header } from './components/Header';
import { PageFilterPanel } from './components/PageFilterPanel';
import { KPICards } from './components/KPICards';
import { AnalyticsCardsSection } from './components/AnalyticsCardsSection';
import { ShipmentExplorerSection } from './components/ShipmentExplorerSection';
import { ReceiveSheetsSection } from './components/ReceiveSheetsSection';
import { ProfileSection } from './components/ProfileSection';
import { UploadModal, PendingFile } from './components/UploadModal';
import { FileManagerModal } from './components/FileManagerModal';
import { DuplicateExplainerModal } from './components/DuplicateExplainerModal';
import { LoginPanel } from './components/LoginPanel';

import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Building2,
  FileSpreadsheet,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  ShieldCheck,
  Truck,
  Upload,
  Users,
  X,
} from 'lucide-react';

type WorkspacePage = 'Dashboard' | 'Receive' | 'Sort' | 'Transfer' | 'Loading' | 'Users' | 'Roles & Permissions';
type WorkspaceTab = 'Sheets' | 'Live';
type AccessLoadState = 'idle' | 'loading' | 'ready' | 'forbidden' | 'error';
type PageFilters = Record<WorkspacePage, Record<WorkspaceTab, FilterState>>;

function createDefaultFilters(): FilterState {
  return {
    hub: new Set(),
    biz: new Set(),
    st: new Set(),
    pt: new Set(),
    size: new Set(),
    pc: new Set(),
    dc: new Set(),
    fileIds: new Set(),
    lane: new Set(),
    year: 'all',
    month: 'all',
    specificDate: 'all',
    dateFrom: '',
    dateTo: '',
  };
}

function createPageFilters(): PageFilters {
  return {
    Dashboard: { Sheets: createDefaultFilters(), Live: createDefaultFilters() },
    Receive: { Sheets: createDefaultFilters(), Live: createDefaultFilters() },
    Sort: { Sheets: createDefaultFilters(), Live: createDefaultFilters() },
    Transfer: { Sheets: createDefaultFilters(), Live: createDefaultFilters() },
    Loading: { Sheets: createDefaultFilters(), Live: createDefaultFilters() },
    Users: { Sheets: createDefaultFilters(), Live: createDefaultFilters() },
    'Roles & Permissions': { Sheets: createDefaultFilters(), Live: createDefaultFilters() },
  };
}

function finishClientImportMeasurement(job: ImportJob): void {
  const key = `bosta-import-timing:${job.run_id}`;
  const raw = localStorage.getItem(key);
  if (!raw) return;
  localStorage.removeItem(key);
  try {
    const timing = JSON.parse(raw) as { correlation_id: string; started_at_ms: number; file_bytes: number; upload_elapsed_ms: number };
    const totalMs = Math.max(0, Date.now() - timing.started_at_ms);
    const publishedAt = job.completed_at ? new Date(job.completed_at).getTime() : Date.now();
    console.info('[import-end-to-end]', JSON.stringify({
      correlation_id: timing.correlation_id,
      run_id: job.run_id,
      file_bytes: timing.file_bytes,
      upload_elapsed_ms: +timing.upload_elapsed_ms.toFixed(3),
      result_load_and_render_ms: Math.max(0, Date.now() - publishedAt),
      total_ms: totalMs,
      counts: job.counts,
      worker_metrics: job.metrics || null,
    }));
  } catch {
    // A stale local timing entry does not affect import state or results.
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export default function App() {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [importJobs, setImportJobs] = useState<ImportJob[]>([]);
  const importJobsRef = useRef<ImportJob[]>([]);
  const [jobPollVersion, setJobPollVersion] = useState(0);
  const [importJobsAccessRestricted, setImportJobsAccessRestricted] = useState(false);
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
  const [activePage, setActivePage] = useState<WorkspacePage>('Receive');
  const [pageTabs, setPageTabs] = useState<Record<WorkspacePage, WorkspaceTab>>({
    Dashboard: 'Sheets',
    Receive: 'Sheets',
    Sort: 'Sheets',
    Transfer: 'Sheets',
    Loading: 'Sheets',
    Users: 'Live',
    'Roles & Permissions': 'Live',
  });
  const pageTabRefs = useRef<Record<WorkspaceTab, HTMLButtonElement | null>>({ Sheets: null, Live: null });
  const [accessFiltersByPage, setAccessFiltersByPage] = useState<Record<'Users' | 'Roles & Permissions', Record<string, string>>>({
    Users: { role: '', status: '' },
    'Roles & Permissions': { group: '', scope: '' },
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileSidebarRef = useRef<HTMLElement>(null);
  const pageHeadingRef = useRef<HTMLHeadingElement>(null);
  const [lastDataUpdated, setLastDataUpdated] = useState<number | null>(null);
  const [accessLoadState, setAccessLoadState] = useState<AccessLoadState>('idle');
  const [accessLoadError, setAccessLoadError] = useState<string | null>(null);
  const [accessUpdatedAt, setAccessUpdatedAt] = useState<number | null>(null);
  const [accessLoadOrganizationSlug, setAccessLoadOrganizationSlug] = useState<string | null>(null);
  const [accessLoadPage, setAccessLoadPage] = useState<'Users' | 'Roles & Permissions' | null>(null);
  const [accessRetryVersion, setAccessRetryVersion] = useState(0);
  const [accessDataOrganizationSlug, setAccessDataOrganizationSlug] = useState<string | null>(null);
  const [organizationMembers, setOrganizationMembers] = useState<OrganizationMember[]>([]);
  const [accessRoles, setAccessRoles] = useState<AccessRole[]>([]);
  const [accessPermissions, setAccessPermissions] = useState<AccessPermission[]>([]);

  // Modals state
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isFileManagerOpen, setIsFileManagerOpen] = useState(false);
  const [isDuplicateInfoOpen, setIsDuplicateInfoOpen] = useState(false);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);

  // Filters state
  const [filtersByPage, setFiltersByPage] = useState<PageFilters>(createPageFilters);
  const [searchByPage, setSearchByPage] = useState<Record<WorkspacePage, string>>({
    Dashboard: '',
    Receive: '',
    Sort: '',
    Transfer: '',
    Loading: '',
    Users: '',
    'Roles & Permissions': '',
  });
  const activeTab = pageTabs[activePage];
  const filters = filtersByPage[activePage][activeTab];
  const setFilters = useCallback<React.Dispatch<React.SetStateAction<FilterState>>>((next) => {
    setFiltersByPage((previous) => ({
      ...previous,
      [activePage]: {
        ...previous[activePage],
        [activeTab]: typeof next === 'function' ? next(previous[activePage][activeTab]) : next,
      },
    }));
  }, [activePage, activeTab]);

  useEffect(() => {
    setFiltersByPage(createPageFilters());
    setSearchByPage({ Dashboard: '', Receive: '', Sort: '', Transfer: '', Loading: '', Users: '', 'Roles & Permissions': '' });
    setAccessFiltersByPage({
      Users: { role: '', status: '' },
      'Roles & Permissions': { group: '', scope: '' },
    });
    setOrganizationMembers([]);
    setAccessRoles([]);
    setAccessPermissions([]);
    setAccessLoadState('idle');
    setAccessLoadError(null);
    setAccessUpdatedAt(null);
    setAccessLoadOrganizationSlug(null);
    setAccessLoadPage(null);
    setAccessDataOrganizationSlug(null);
  }, [activeOrganization?.slug]);

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
    const [importData, serverShipments, settings, jobsResult] = await Promise.all([
      getImportFiles(organizationSlug),
      getAllShipments(organizationSlug),
      getOrganizationSettings(organizationSlug),
      getImportJobs(organizationSlug).catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 403) return null;
        throw error;
      }),
    ]);
    const jobs = jobsResult || [];
    setImportJobsAccessRestricted(jobsResult === null);
    setFiles(importData.files);
    setShipments(serverShipments);
    setAllHeaders(importData.headers);
    setHubLabels(importData.hubLabels);
    setHubBasis(settings.hubBasis || importData.hubLabels.find((label) => /assigned/i.test(label)) || importData.hubLabels[0] || 'Assigned Hub');
    setColumnOverrides((settings.columnOverrides || {}) as Partial<ColumnMapping>);
    importJobsRef.current = jobs;
    setImportJobs(jobs);
    setLastDataUpdated(Date.now());
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

  useEffect(() => {
    if (!activeOrganization) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const jobs = await getImportJobs(activeOrganization.slug);
        if (!active) return;
        setImportJobsAccessRestricted(false);
        const previous = new Map(importJobsRef.current.map((job) => [job.run_id, job.state]));
        const completedNow = jobs.some((job) => job.state === 'completed'
          && ['queued', 'parsing', 'importing', 'finalizing'].includes(previous.get(job.run_id) || ''));
        const completedWithTiming = jobs.filter((job) => job.state === 'completed'
          && localStorage.getItem(`bosta-import-timing:${job.run_id}`) !== null);
        importJobsRef.current = jobs;
        setImportJobs(jobs);
        if (completedNow || completedWithTiming.length > 0) {
          await reloadOrganizationData(activeOrganization.slug);
          await nextFrame();
          for (const job of completedWithTiming) finishClientImportMeasurement(job);
        }
        const hasActiveJobs = jobs.some((job) => ['queued', 'parsing', 'importing', 'finalizing'].includes(job.state));
        timer = setTimeout(poll, hasActiveJobs ? 1800 : 10000);
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.status === 403) {
          setImportJobsAccessRestricted(true);
          return;
        }
        timer = setTimeout(poll, 10000);
      }
    };
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [activeOrganization, reloadOrganizationData, jobPollVersion]);

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
    importJobsRef.current = [];
    setImportJobs([]);
    setImportJobsAccessRestricted(false);
    setShipments([]);
    setLastDataUpdated(null);
    setOrganizationMembers([]);
    setAccessRoles([]);
    setAccessPermissions([]);
    setAccessLoadState('idle');
    setAccessLoadError(null);
    setAccessUpdatedAt(null);
    setAccessLoadOrganizationSlug(null);
    setAccessLoadPage(null);
    setAccessDataOrganizationSlug(null);
    setFiltersByPage(createPageFilters());
    setAccessFiltersByPage({
      Users: { role: '', status: '' },
      'Roles & Permissions': { group: '', scope: '' },
    });
    setSearchByPage({
      Dashboard: '',
      Receive: '',
      Sort: '',
      Transfer: '',
      Loading: '',
      Users: '',
      'Roles & Permissions': '',
    });
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
    [setFilters]
  );

  const handleApplyMapping = useCallback(async () => {
    if (!activeOrganization) return;
    await saveOrganizationSetting(activeOrganization.slug, 'columnOverrides', columnOverrides);
    alert('Column mappings updated. New files will use these settings.');
  }, [activeOrganization, columnOverrides]);

  // Process and ingest uploaded files
  const handleProcessFiles = async (
    pending: PendingFile[],
    onProgress: (id: string, loaded: number, total: number) => void,
  ) => {
    if (!activeOrganization) throw new Error('Select an organization before importing workbooks.');
    for (const p of pending) {
      const started = await uploadWorkbookFile(
        activeOrganization.slug,
        p.file,
        p.detectedDate,
        p.isManualDate,
        columnOverrides as Record<string, string>,
        (loaded, total) => onProgress(p.id, loaded, total),
      );
      localStorage.setItem(`bosta-import-timing:${started.runId}`, JSON.stringify({
        correlation_id: started.correlationId,
        started_at_ms: Date.now() - started.uploadElapsedMs,
        file_bytes: p.file.size,
        upload_elapsed_ms: started.uploadElapsedMs,
      }));
      if (started.alreadyImported) {
        await reloadOrganizationData(activeOrganization.slug);
        await nextFrame();
        const completedJob = importJobsRef.current.find((job) => job.run_id === started.runId);
        if (completedJob) finishClientImportMeasurement(completedJob);
      }
    }
    const jobs = await getImportJobs(activeOrganization.slug);
    importJobsRef.current = jobs;
    setImportJobs(jobs);
    setJobPollVersion((version) => version + 1);
  };

  const handleRetryImport = async (job: ImportJob) => {
    if (!activeOrganization) return;
    await retryImportRun(activeOrganization.slug, job.file_id, job.run_id);
    const jobs = await getImportJobs(activeOrganization.slug);
    importJobsRef.current = jobs;
    setImportJobs(jobs);
    setJobPollVersion((version) => version + 1);
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
    setFiltersByPage(createPageFilters());
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
    const useReceiveSheetFilters = activePage === 'Receive' && activeTab === 'Sheets';
    return filterShipments(shipments, useReceiveSheetFilters ? createDefaultFilters() : filters, hubBasis);
  }, [shipments, filters, hubBasis, activePage, activeTab]);

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
    const sizeCounts = new Map<string, number>();
    const routeCounts = new Map<string, number>();
    const fileCounts = new Map<string, number>();
    const yearSet = new Set<string>();
    const monthSet = new Set<string>();
    const dateSet = new Set<string>();

    for (let i = 0; i < shipments.length; i++) {
      const r = shipments[i];
      fileCounts.set(r.fileId, (fileCounts.get(r.fileId) || 0) + 1);
      const hVal = (hubBasis && r.hubs[hubBasis]) || r.assignedHub;
      if (hVal) hubCounts.set(hVal, (hubCounts.get(hVal) || 0) + 1);
      if (r.business) bizCounts.set(r.business, (bizCounts.get(r.business) || 0) + 1);
      if (r.shipType) stCounts.set(r.shipType, (stCounts.get(r.shipType) || 0) + 1);
      if (r.packageType) ptCounts.set(r.packageType, (ptCounts.get(r.packageType) || 0) + 1);
      if (r.packageSize) sizeCounts.set(r.packageSize, (sizeCounts.get(r.packageSize) || 0) + 1);
      if (r.pickupCity) pcCounts.set(r.pickupCity, (pcCounts.get(r.pickupCity) || 0) + 1);
      if (r.dropCity) dcCounts.set(r.dropCity, (dcCounts.get(r.dropCity) || 0) + 1);
      if (r.pickupCity && r.dropCity) {
        const route = `${r.pickupCity} → ${r.dropCity}`;
        routeCounts.set(route, (routeCounts.get(route) || 0) + 1);
      }

      if (r.shipmentDate) {
        dateSet.add(r.shipmentDate);
        monthSet.add(r.shipmentDate.slice(0, 7));
        yearSet.add(r.shipmentDate.slice(0, 4));
      }
    }
    files.forEach((file) => {
      if (file.detectedDate) dateSet.add(file.detectedDate);
    });

    return {
      hubs: Array.from(hubCounts.entries()).map(([name, count]) => ({ name, count })),
      businesses: Array.from(bizCounts.entries()).map(([name, count]) => ({ name, count })),
      shipTypes: Array.from(stCounts.entries()).map(([name, count]) => ({ name, count })),
      pkgTypes: Array.from(ptCounts.entries()).map(([name, count]) => ({ name, count })),
      size: Array.from(sizeCounts.entries()).map(([name, count]) => ({ name, count })),
      pickupCities: Array.from(pcCounts.entries()).map(([name, count]) => ({ name, count })),
      dropCities: Array.from(dcCounts.entries()).map(([name, count]) => ({ name, count })),
      lane: Array.from(routeCounts.entries()).map(([name, count]) => ({ name, count })),
      fileIds: files.map((file) => ({
        name: file.name,
        value: file.id,
        count: fileCounts.get(file.id) || 0,
      })),
      years: Array.from(yearSet).sort().reverse(),
      months: Array.from(monthSet).sort().reverse(),
      dates: Array.from(dateSet).sort().reverse().map((name) => ({ name })),
    };
  }, [shipments, files, hubBasis]);

  const resetAllFilters = useCallback(() => {
    setFilters(createDefaultFilters());
  }, [setFilters]);

  useEffect(() => {
    if (!activeOrganization || activeTab !== 'Live'
      || (activePage !== 'Users' && activePage !== 'Roles & Permissions')) return;

    const organizationSlug = activeOrganization.slug;
    let active = true;
    setAccessLoadOrganizationSlug(organizationSlug);
    setAccessLoadPage(activePage);
    setAccessLoadState('loading');
    setAccessLoadError(null);
    async function loadAccessData() {
      try {
        if (activePage === 'Users') {
          const members = await getOrganizationMembers(organizationSlug);
          if (active) setOrganizationMembers(members);
        } else {
          const catalog = await getAccessCatalog(organizationSlug);
          if (active) {
            setAccessRoles(catalog.roles);
            setAccessPermissions(catalog.permissions);
          }
        }
        if (active) {
          setAccessUpdatedAt(Date.now());
          setAccessDataOrganizationSlug(organizationSlug);
          setAccessLoadState('ready');
        }
      } catch (error) {
        if (!active) return;
        setAccessLoadState(error instanceof ApiError && error.status === 403 ? 'forbidden' : 'error');
        setAccessLoadError(error instanceof Error ? error.message : 'Could not load access information.');
      }
    }
    void loadAccessData();
    return () => { active = false; };
  }, [activeOrganization, activePage, activeTab, accessRetryVersion]);

  const setActiveTab = (tab: WorkspaceTab) => {
    setPageTabs((previous) => ({ ...previous, [activePage]: tab }));
  };

  const setActiveSearch = (value: string) => {
    setSearchByPage((previous) => ({ ...previous, [activePage]: value }));
  };

  const existingFilenames = useMemo(() => new Set(files.map((f) => f.name)), [files]);
  const visibleImportJobs = importJobs.filter((job) => {
    if (job.state !== 'completed') return true;
    return Date.now() - new Date(job.created_at).getTime() < 5 * 60 * 1000;
  }).slice(0, 6);
  const hasShipmentDimensionFilter = [filters.hub, filters.biz, filters.st, filters.pt, filters.size, filters.pc, filters.dc, filters.lane]
    .some((selection) => selection.size > 0);
  const matchingShipmentFileIds = new Set(filteredShipments.map((shipment) => shipment.fileId));
  const visibleFiles = [...files]
    .filter((file) => filters.fileIds.size === 0 || filters.fileIds.has(file.id))
    .filter((file) => filters.specificDate === 'all' || file.detectedDate === filters.specificDate)
    .filter((file) => !filters.dateFrom || file.detectedDate >= filters.dateFrom)
    .filter((file) => !filters.dateTo || file.detectedDate <= filters.dateTo)
    .filter((file) => !hasShipmentDimensionFilter || matchingShipmentFileIds.has(file.id))
    .sort((a, b) => b.uploadedAt - a.uploadedAt);
  const pageItems = [
    { label: 'Dashboard', icon: LayoutDashboard },
    { label: 'Receive', icon: Inbox },
    { label: 'Sort', icon: Activity },
    { label: 'Transfer', icon: ArrowLeftRight },
    { label: 'Loading', icon: Truck },
    { label: 'Users', icon: Users },
    { label: 'Roles & Permissions', icon: KeyRound },
  ] as const;
  const isOperationsPage = ['Dashboard', 'Receive', 'Sort', 'Transfer', 'Loading'].includes(activePage);
  const pageDescriptions: Record<WorkspacePage, string> = {
    Dashboard: 'Explore the complete shipment analytics workspace and imported report details.',
    Receive: 'Review imported shipment reports and verify intake quality.',
    Sort: 'Explore hub and business distribution from imported reports.',
    Transfer: 'Review shipment volume and geographic coverage in report data.',
    Loading: 'Inspect imported shipment records and report configuration.',
    Users: 'Review active organization memberships available to your account.',
    'Roles & Permissions': 'Review the fixed role and permission catalog for this organization.',
  };
  const activeSearch = searchByPage[activePage].trim().toLowerCase();
  const accessDataIsCurrent = accessDataOrganizationSlug === activeOrganization?.slug;
  const accessLoadIsCurrent = accessLoadOrganizationSlug === activeOrganization?.slug;
  const currentAccessLoadState = accessLoadIsCurrent && accessLoadPage === activePage
    ? accessLoadState
    : 'loading';
  const currentMembers = accessDataIsCurrent ? organizationMembers : [];
  const currentRoles = accessDataIsCurrent ? accessRoles : [];
  const currentPermissions = accessDataIsCurrent ? accessPermissions : [];
  const activeAccessFilters = activePage === 'Users' || activePage === 'Roles & Permissions'
    ? accessFiltersByPage[activePage]
    : {};
  const visibleMembers = currentMembers.filter((member) =>
    (!activeSearch || `${member.name} ${member.email}`.toLowerCase().includes(activeSearch))
    && (!activeAccessFilters.role || (activeAccessFilters.role === '__unassigned__' ? member.role === null : member.role?.name === activeAccessFilters.role))
    && (!activeAccessFilters.status || member.status === activeAccessFilters.status),
  );
  const visibleRoles = currentRoles.filter((role) =>
    (!activeSearch || `${role.name} ${role.slug} ${role.permissions.join(' ')}`.toLowerCase().includes(activeSearch))
    && (!activeAccessFilters.scope || role.scope === activeAccessFilters.scope)
    && (!activeAccessFilters.group || role.permissions.includes('*') || role.permissions.some((permission) => permission.startsWith(`${activeAccessFilters.group}.`))),
  );
  const visiblePermissions = currentPermissions.filter((permission) =>
    (!activeSearch || `${permission.name} ${permission.description}`.toLowerCase().includes(activeSearch))
    && (!activeAccessFilters.group || permission.name.startsWith(`${activeAccessFilters.group}.`)),
  );
  const accessFilterOptions = {
    roles: [
      ...Array.from(new Set(currentMembers.map((member) => member.role?.name).filter((value): value is string => Boolean(value)))).sort(),
      ...(currentMembers.some((member) => !member.role) ? ['__unassigned__'] : []),
    ],
    statuses: Array.from(new Set(currentMembers.map((member) => member.status).filter(Boolean))).sort(),
    groups: Array.from(new Set(currentPermissions.map((permission) => permission.name.split('.')[0]))).sort(),
    scopes: Array.from(new Set(currentRoles.map((role) => role.scope))).sort(),
  };
  const updateAccessFilter = (key: string, value: string) => {
    if (activePage !== 'Users' && activePage !== 'Roles & Permissions') return;
    setAccessFiltersByPage((previous) => ({
      ...previous,
      [activePage]: { ...previous[activePage], [key]: value },
    }));
  };
  const pageSource = activeTab === 'Sheets'
    ? isOperationsPage
      ? files.length > 0 ? 'Imported workbook snapshots · organization database' : 'Organization imports API · awaiting reports'
      : 'No sheet source connected'
    : activePage === 'Users' ? 'Organization memberships API · access-controlled snapshot'
      : activePage === 'Roles & Permissions' ? 'Organization role catalog API · access-controlled snapshot'
        : 'No live operations feed connected';
  const pageUpdatedAt = activeTab === 'Sheets' && isOperationsPage
    ? lastDataUpdated
    : activeTab === 'Live' && !isOperationsPage && accessLoadState === 'ready' && accessDataIsCurrent
      && accessLoadIsCurrent && accessLoadPage === activePage
      ? accessUpdatedAt
      : null;
  const formatUpdatedAt = (timestamp: number | null) => timestamp
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
    : 'Not available';

  const closeMobileNavigation = useCallback((returnFocus = true) => {
    setMobileNavOpen(false);
    if (returnFocus) {
      requestAnimationFrame(() => document.getElementById('mobile-navigation-trigger')?.focus());
    }
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const sidebar = mobileSidebarRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const getFocusable = () => Array.from(sidebar?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) || []).filter((element) => element.getClientRects().length > 0);
    const focusFrame = requestAnimationFrame(() => sidebar?.querySelector<HTMLElement>('.mobile-close')?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMobileNavigation();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = getFocusable();
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen, closeMobileNavigation]);

  if (!authChecked || isLoading) {
    return (
      <div className="workspace-loading" role="status" aria-live="polite">
        <div className="loading-card">
          <Loader2 className="h-5 w-5 animate-spin" />
          <div>
            <span>Connecting to MySQL and loading workspace data…</span>
            {migrationMessage && <p>{migrationMessage}</p>}
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
    <div className={`app-shell${sidebarCollapsed ? ' sidebar-is-collapsed' : ''}`}>
      <button
        type="button"
        className={`mobile-scrim${mobileNavOpen ? ' is-visible' : ''}`}
        aria-label="Close navigation"
        aria-hidden={!mobileNavOpen}
        onClick={() => closeMobileNavigation()}
        tabIndex={mobileNavOpen ? 0 : -1}
      />
      <aside
        ref={mobileSidebarRef}
        id="primary-navigation"
        className={`app-sidebar${mobileNavOpen ? ' mobile-open' : ''}`}
        aria-label="Primary navigation"
        role={mobileNavOpen ? 'dialog' : undefined}
        aria-modal={mobileNavOpen || undefined}
      >
        <div className="sidebar-brand">
          <div className="brand-mark" aria-hidden="true"><BoxMark /></div>
          <div className="sidebar-brand-copy"><strong>Bosta</strong><span>Operations</span></div>
          <button
            type="button"
            className="sidebar-collapse icon-button"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <button type="button" className="mobile-close icon-button" onClick={() => closeMobileNavigation()} aria-label="Close navigation">
            <X size={20} />
          </button>
        </div>
        <div className="sidebar-org" title={activeOrganization.name}>
          <Building2 size={16} aria-hidden="true" /><span>{activeOrganization.name}</span>
        </div>
        <div className="sidebar-caption">WORKSPACE</div>
        <nav className="sidebar-nav">
          {pageItems.map(({ label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              className={`nav-item${activePage === label ? ' is-active' : ''}`}
              aria-current={activePage === label ? 'page' : undefined}
              aria-label={sidebarCollapsed ? label : undefined}
              title={sidebarCollapsed ? label : undefined}
              onClick={() => {
                setActivePage(label);
                closeMobileNavigation(false);
                requestAnimationFrame(() => pageHeadingRef.current?.focus());
              }}
            >
              <Icon size={19} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="sidebar-avatar" aria-hidden="true">{currentUser.name.slice(0, 1).toUpperCase()}</span>
          <span className="sidebar-user-copy"><strong>{currentUser.name}</strong><small>{currentUser.email}</small></span>
        </div>
      </aside>

      <div className="shell-main">
        <Header
          pageTitle={activePage}
          files={files}
          totalShipments={shipments.length}
          filteredShipments={filteredShipments.length}
          backendStatus={backendStatus}
          currentUser={currentUser}
          organizations={organizations}
          activeOrganization={activeOrganization}
          onOrganizationChange={(slug) => {
            const organization = organizations.find((org) => org.slug === slug) || null;
            if (!organization || organization.slug === activeOrganization.slug) return;
            setFiles([]);
            setImportJobs([]);
            importJobsRef.current = [];
            setImportJobsAccessRestricted(false);
            setShipments([]);
            setAllHeaders([]);
            setHubLabels([]);
            setLastDataUpdated(null);
            setOrganizationMembers([]);
            setAccessRoles([]);
            setAccessPermissions([]);
            setAccessLoadState('idle');
            setAccessLoadError(null);
            setAccessUpdatedAt(null);
            setAccessLoadOrganizationSlug(null);
            setAccessLoadPage(null);
            setAccessDataOrganizationSlug(null);
            setActiveOrganization(organization);
          }}
          onLogout={handleLogout}
          onOpenUpload={() => setIsUploadOpen(true)}
          onOpenFileManager={() => setIsFileManagerOpen(true)}
          onOpenDuplicateInfo={() => setIsDuplicateInfoOpen(true)}
          onClearAll={() => setIsClearConfirmOpen(true)}
          onMenuClick={() => setMobileNavOpen(true)}
          menuExpanded={mobileNavOpen}
        />
        <main className="workspace-content">
          <section className="page-heading">
            <div className="page-heading-copy">
              <p className="page-eyebrow">{activeOrganization.name}</p>
              <h1 ref={pageHeadingRef} tabIndex={-1}>{activePage}</h1>
              <p className="page-description">{pageDescriptions[activePage]}</p>
              <div className="page-source-meta">
                <span><strong>Source</strong> {pageSource}</span>
                <span><strong>Last updated</strong> {formatUpdatedAt(pageUpdatedAt)}</span>
              </div>
            </div>
            {isOperationsPage ? (
              <button type="button" className="btn pri page-primary-action" onClick={() => setIsUploadOpen(true)}>
                <Upload size={16} /><span>{activePage === 'Receive' ? 'Upload reports' : 'Add source report'}</span>
              </button>
            ) : (
              <button type="button" className="btn page-primary-action" onClick={() => setActiveTab('Live')}>
                {activePage === 'Users' ? <Users size={16} /> : <ShieldCheck size={16} />}
                <span>{activePage === 'Users' ? 'View memberships' : 'Review catalog'}</span>
              </button>
            )}
          </section>

          <div className="page-tabs" role="tablist" aria-label={`${activePage} views`}>
            {(['Sheets', 'Live'] as const).map((tab) => (
              <button
                key={tab}
                id={`${activePage.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${tab.toLowerCase()}-tab`}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                tabIndex={activeTab === tab ? 0 : -1}
                aria-controls="page-tab-panel"
                className={`page-tab${activeTab === tab ? ' is-active' : ''}`}
                ref={(element) => { pageTabRefs.current[tab] = element; }}
                onClick={() => setActiveTab(tab)}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  const nextTab = event.key === 'Home' ? 'Sheets'
                    : event.key === 'End' ? 'Live'
                      : event.key === 'ArrowRight' ? activeTab === 'Sheets' ? 'Live' : 'Sheets'
                        : activeTab === 'Live' ? 'Sheets' : 'Live';
                  setActiveTab(nextTab);
                  pageTabRefs.current[nextTab]?.focus();
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {!(activePage === 'Receive' && activeTab === 'Sheets') && (
            <PageFilterPanel
              page={activePage}
              tab={activeTab}
              centerLabel={hubBasis}
              filters={filters}
              onFilterChange={setFilters}
              onClearFilters={resetAllFilters}
              availableOptions={availableOptions}
              accessOptions={accessFilterOptions}
              accessFilters={activeAccessFilters}
              onAccessFilterChange={updateAccessFilter}
              search={searchByPage[activePage]}
              onSearchChange={setActiveSearch}
              resultCount={
                isOperationsPage ? activeTab === 'Sheets' ? filteredShipments.length : 0
                  : activeTab === 'Sheets' ? 0
                    : activePage === 'Users' ? visibleMembers.length
                      : visibleRoles.length + visiblePermissions.length
              }
              totalCount={
                isOperationsPage ? activeTab === 'Sheets' ? shipments.length : 0
                  : activeTab === 'Sheets' ? 0
                    : activePage === 'Users' ? currentMembers.length
                      : currentRoles.length + currentPermissions.length
              }
            />
          )}

          <div
            id="page-tab-panel"
            className="page-tab-panel"
            role="tabpanel"
            aria-labelledby={`${activePage.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${activeTab.toLowerCase()}-tab`}
          >
      {isOperationsPage && activeTab === 'Sheets' && visibleImportJobs.length > 0 && (
        <section aria-label="Import status" className="import-status-list">
          {visibleImportJobs.map((job) => {
            const running = ['uploaded', 'queued', 'parsing', 'importing', 'finalizing'].includes(job.state);
            const hasTotal = job.total_rows !== null && job.total_rows > 0;
            const progress = hasTotal ? Math.min(100, Math.round((job.processed_rows / job.total_rows!) * 100)) : null;
            return (
              <div key={job.run_id} className={`import-status-card status-${job.state}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{job.name}</span>
                      <span className="job-state">{job.state}</span>
                    </div>
                    {job.state === 'failed' ? (
                      <p className="mb-0 mt-1 text-xs">{job.error || 'The workbook could not be processed.'}</p>
                    ) : (
                      <p className="job-detail">
                        {running
                          ? `${job.processed_rows.toLocaleString()} rows processed${hasTotal ? ` of ${job.total_rows!.toLocaleString()}` : ''}`
                          : `${job.counts.accepted.toLocaleString()} accepted · ${job.counts.duplicates.toLocaleString()} duplicates · ${job.counts.rejected.toLocaleString()} rejected`}
                      </p>
                    )}
                    {progress !== null && running && (
                      <div className="job-progress">
                        <div className="h-full bg-sky-400 transition-all" style={{ width: `${progress}%` }} />
                      </div>
                    )}
                  </div>
                  {job.state === 'failed' && (
                    <button type="button" className="btn sm" onClick={() => void handleRetryImport(job)}>
                      <RefreshCw className="h-3.5 w-3.5" /> Retry safely
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {isOperationsPage && activeTab === 'Sheets' && importJobsAccessRestricted && (
        <div className="workspace-notice is-info" role="status">
          Import job details are restricted for this account. Available report files and shipment data remain visible.
        </div>
      )}

      {migrationMessage && (
        <div className="workspace-notice is-info" role="status">
          {migrationMessage}
        </div>
      )}

      {loadError ? (
        <section className="source-empty-state">
          <div className="empty-icon"><AlertTriangle size={21} /></div>
          <span className="source-kind">Organization data unavailable</span>
          <h2>Could not load this workspace</h2>
          <p role="alert">{loadError}</p>
          <button
            type="button"
            className="btn pri"
            onClick={() => {
              setIsLoading(true);
              setLoadError(null);
              void reloadOrganizationData(activeOrganization.slug)
                .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : 'Could not load MySQL data.'))
                .finally(() => setIsLoading(false));
            }}
          >
            <RefreshCw size={16} /><span>Try again</span>
          </button>
        </section>
      ) : isOperationsPage && activeTab === 'Live' ? (
        <section className="source-empty-state">
          <div className="empty-icon"><RefreshCw size={21} /></div>
          <span className="source-kind">No live feed connected</span>
          <h2>Live operational data is not available</h2>
          <p>
            This workspace currently receives imported workbook snapshots. They describe their report dates and do not
            provide current shipment stages or a real-time operational feed.
          </p>
          <div className="source-note"><strong>Available source</strong><span>Use Sheets to review imported report data.</span></div>
        </section>
      ) : isOperationsPage && activeTab === 'Sheets' && ['Dashboard', 'Receive'].includes(activePage) && files.length === 0 ? (
        <div className="drop">
          <FileSpreadsheet className="w-16 h-16 text-sky-400 mx-auto mb-4 opacity-90" />
          <h2>Upload your daily shipment Excel files</h2>
          <p>
            Drag &amp; drop one daily report, multiple daily files, or an entire month&apos;s data at once (
            <b>.xlsx</b>, <b>.xls</b>, or <b>.csv</b>). Dates are automatically extracted from filenames (e.g.{' '}
            <code>Shipment_2026-07-01.xlsx</code>). Files are processed by a Laravel queue worker and stored securely
            in this organization&apos;s MySQL database, including the private original workbook and all source rows.
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
      ) : isOperationsPage && activeTab === 'Sheets' && ['Sort', 'Transfer', 'Loading'].includes(activePage) && files.length === 0 ? (
        <section className="empty-workspace">
          <div className="empty-icon"><FileSpreadsheet size={22} /></div>
          <h2>No shipment data yet</h2>
          <p>Upload a report to populate {activePage.toLowerCase()} insights for this organization.</p>
          <button type="button" className="btn pri" onClick={() => setIsUploadOpen(true)}>
            <Upload size={16} /><span>Upload reports</span>
          </button>
        </section>
      ) : isOperationsPage && activeTab === 'Sheets' ? (
        <div className="analytics-sections">
          {shipments.length === 0 ? (
            <section className="source-empty-state compact">
              <span className="source-kind">Imported report source</span>
              <h2>Reports are available, but contain no published shipment rows</h2>
              <p>Check the import result and report configuration below. No operational stage is inferred from the available fields.</p>
            </section>
          ) : (
            <>
          {filteredShipments.length > 0 ? (
            <>
          {activePage === 'Receive' ? (
            <ReceiveSheetsSection shipments={shipments} />
          ) : (
            <>
          <KPICards current={currentAgg} base={baseAgg} />
          <AnalyticsCardsSection
            shipments={shipments}
            filteredShipments={filteredShipments}
            filters={filters}
            hubBasis={hubBasis}
          />

          <ShipmentExplorerSection shipments={filteredShipments} />

          {['Dashboard', 'Loading'].includes(activePage) && (
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
          )}
            </>
          )}
            </>
          ) : (
            <section className="source-empty-state compact no-results-state">
              <span className="source-kind">Filtered report snapshot</span>
              <h2>No results for the current filters</h2>
              <p>Remove one or more filter chips, or clear all filters to restore the report rows.</p>
              <button type="button" className="btn" onClick={resetAllFilters}>Clear filters</button>
            </section>
          )}
            </>
          )}

          <section className="workspace-data-table">
            <div className="data-table-heading">
              <div><h2>Imported reports</h2><p>File, report date, sheet count, and import result from the organization API.</p></div>
              <span className="data-count">{visibleFiles.length} files</span>
            </div>
            <div className="responsive-table-wrap">
              <table>
                <thead><tr><th>File name</th><th>Report date</th><th>Import status</th><th>Sheets</th><th>Rows</th><th>Uploaded</th></tr></thead>
                <tbody>
                  {visibleFiles.map((file) => {
                    const relatedJobs = importJobs.filter((job) => job.file_id === file.id || job.name === file.name);
                    const latestJob = relatedJobs.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
                    return (
                      <tr key={file.id}>
                        <td className="file-name-cell"><FileSpreadsheet size={16} /><span title={file.name}>{file.name}</span></td>
                        <td>{file.detectedDate || 'Not set'}</td>
                        <td><span className={`import-pill ${latestJob?.state === 'failed' ? 'is-error' : latestJob && latestJob.state !== 'completed' ? 'is-pending' : importJobsAccessRestricted ? 'is-info' : 'is-success'}`}>{latestJob?.state || (importJobsAccessRestricted ? 'Restricted' : 'Imported')}</span></td>
                        <td>{file.sheetsCount ?? '—'}</td>
                        <td>{file.recordCount.toLocaleString()}</td>
                        <td>{file.uploadedAt ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(file.uploadedAt) : 'Not available'}</td>
                      </tr>
                    );
                  })}
                  {visibleFiles.length === 0 && <tr><td colSpan={6}>No imported files match the selected report date and file filters.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}

      {activePage === 'Users' && activeTab === 'Sheets' && (
        <section className="source-empty-state">
          <div className="empty-icon"><FileSpreadsheet size={22} /></div>
          <span className="source-kind">Sheets source unavailable</span>
          <h2>No sheet source connected</h2>
          <p>Organization members are provided by the access-controlled API, not by an imported user sheet.</p>
        </section>
      )}

      {activePage === 'Users' && activeTab === 'Live' && currentAccessLoadState === 'loading' && (
        <section className="workspace-data-table access-loading-table" role="status" aria-label="Loading memberships">
          <div className="data-table-heading"><div><h2>Organization members</h2><p>Loading membership records…</p></div></div>
          <div className="access-skeleton-list">{Array.from({ length: 5 }, (_, index) => <div className="access-skeleton-row" key={index}><i /><i /><i /><i /></div>)}</div>
        </section>
      )}
      {activePage === 'Users' && activeTab === 'Live' && currentAccessLoadState === 'forbidden' && (
        <div className="access-state-card is-info"><ShieldCheck size={19} /><div><strong>Membership access is restricted</strong><span>Your current account does not have permission to view this organization&apos;s member list. The Users page remains available.</span></div></div>
      )}
      {activePage === 'Users' && activeTab === 'Live' && currentAccessLoadState === 'error' && (
        <div className="access-state-card is-error" role="alert">
          <AlertTriangle size={19} />
          <div><strong>Could not load memberships</strong><span>{accessLoadError || 'The membership API request failed.'}</span></div>
          <button type="button" className="btn sm" onClick={() => setAccessRetryVersion((version) => version + 1)}><RefreshCw size={14} /> Try again</button>
        </div>
      )}
      {activePage === 'Users' && activeTab === 'Live' && currentAccessLoadState === 'ready' && (
        visibleMembers.length > 0 ? (
          <section className="workspace-data-table">
            <div className="data-table-heading"><div><h2>Organization members</h2><p>Memberships returned by the current organization API snapshot.</p></div><span className="data-count">{visibleMembers.length} shown</span></div>
            <div className="responsive-table-wrap"><table>
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Member since</th></tr></thead>
              <tbody>{visibleMembers.map((member) => (
                <tr key={member.id}>
                  <td>{member.name}</td><td>{member.email}</td><td>{member.role?.name || 'No role assigned'}</td>
                  <td><span className={`import-pill ${member.status === 'active' ? 'is-success' : 'is-pending'}`}>{member.status}</span></td>
                  <td>{member.joined_at ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(Date.parse(member.joined_at)) : 'Not available'}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </section>
        ) : <section className="source-empty-state compact"><h2>{activeSearch ? 'No memberships match this search' : 'No memberships available'}</h2><p>{activeSearch ? 'Try another name, email, role, or status.' : 'The API returned no organization membership records for this account.'}</p></section>
      )}

      {activePage === 'Roles & Permissions' && activeTab === 'Sheets' && (
        <section className="source-empty-state">
          <div className="empty-icon"><FileSpreadsheet size={22} /></div>
          <span className="source-kind">Sheets source unavailable</span>
          <h2>No sheet source connected</h2>
          <p>Roles and permissions come from the fixed backend catalog; no imported sheet source is connected.</p>
        </section>
      )}

      {activePage === 'Roles & Permissions' && activeTab === 'Live' && currentAccessLoadState === 'loading' && (
        <section className="workspace-data-table access-loading-table" role="status" aria-label="Loading role catalog">
          <div className="data-table-heading"><div><h2>Role catalog</h2><p>Loading role and permission definitions…</p></div></div>
          <div className="access-skeleton-list">{Array.from({ length: 4 }, (_, index) => <div className="access-skeleton-row" key={index}><i /><i /><i /><i /></div>)}</div>
        </section>
      )}
      {activePage === 'Roles & Permissions' && activeTab === 'Live' && currentAccessLoadState === 'forbidden' && (
        <div className="access-state-card is-info"><ShieldCheck size={19} /><div><strong>Catalog access is restricted</strong><span>Your current account does not have permission to view roles and permissions. This catalog is read-only.</span></div></div>
      )}
      {activePage === 'Roles & Permissions' && activeTab === 'Live' && currentAccessLoadState === 'error' && (
        <div className="access-state-card is-error" role="alert">
          <AlertTriangle size={19} />
          <div><strong>Could not load the role catalog</strong><span>{accessLoadError || 'The access catalog API request failed.'}</span></div>
          <button type="button" className="btn sm" onClick={() => setAccessRetryVersion((version) => version + 1)}><RefreshCw size={14} /> Try again</button>
        </div>
      )}
      {activePage === 'Roles & Permissions' && activeTab === 'Live' && currentAccessLoadState === 'ready' && (
        <div className="access-catalog">
          {visibleRoles.length > 0 ? visibleRoles.map((role) => (
            <section className="role-catalog-card" key={`${role.scope}-${role.slug}`}>
              <div className="role-card-heading"><div><span className="source-kind">{role.scope === 'system' ? 'System' : 'Organization'}</span><h2>{role.name}</h2><p>{role.slug}</p></div><span className="import-pill is-info">{role.assignable ? 'Catalog role' : 'Not assignable'}</span></div>
              <div className="role-permissions"><strong>{role.permissions.length === 1 && role.permissions[0] === '*' ? 'All system permissions' : `${role.permissions.length} permissions`}</strong>
                {role.permissions[0] === '*' ? <p>System administrator permissions are represented by the backend&apos;s wildcard grant.</p> : <div className="permission-chip-list">{role.permissions.map((permission) => <span className="permission-chip" key={permission}>{permission}</span>)}</div>}
              </div>
            </section>
          )) : <section className="source-empty-state compact"><h2>{activeSearch ? 'No roles match this search' : 'No roles returned'}</h2><p>The API did not return any role definitions for this organization.</p></section>}
          <section className="workspace-data-table">
            <div className="data-table-heading"><div><h2>Permission definitions</h2><p>Descriptions from the current backend catalog.</p></div><span className="data-count">{visiblePermissions.length} shown</span></div>
            <div className="responsive-table-wrap"><table><thead><tr><th>Permission</th><th>Description</th></tr></thead><tbody>
              {visiblePermissions.map((permission) => <tr key={permission.name}><td><code>{permission.name}</code></td><td>{permission.description}</td></tr>)}
              {visiblePermissions.length === 0 && <tr><td colSpan={2}>No permissions match this search.</td></tr>}
            </tbody></table></div>
          </section>
          <p className="catalog-readonly-note"><ShieldCheck size={16} /> This is a fixed backend catalog. Role creation and permission editing are not available here.</p>
        </div>
      )}
          </div>

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
        </main>
      </div>
    </div>
  );
}

function BoxMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m3 7 9-4 9 4-9 4-9-4Z" />
      <path d="M3 7v10l9 4 9-4V7M12 11v10" />
    </svg>
  );
}
