import { UploadedFile, ShipmentRecord } from '../types';
import type { VolumeSummary } from '../utils/receiveVolume';
import {
  beginImportBenchmarkRequest,
  finishImportBenchmarkRequest,
  importBenchmarkEnabled,
  importBenchmarkHeaders,
} from './importBenchmark';

export interface OrganizationOption {
  id: string;
  name: string;
  slug: string;
  role?: { name: string; slug: string } | null;
}

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  is_system_administrator: boolean;
  memberships: Array<{
    organization: { id: string; name: string; slug: string };
    role: { name: string; slug: string } | null;
  }>;
}

export interface OrganizationMember {
  id: number;
  name: string;
  email: string;
  status: string;
  joined_at: string | null;
  role: { id: number; name: string; slug: string } | null;
}

export interface AccessRole {
  id: number | null;
  name: string;
  slug: string;
  scope: 'organization' | 'system';
  assignable: boolean;
  permissions: string[];
}

export interface AccessPermission {
  name: string;
  description: string;
}

export interface OrganizationSettings {
  hubBasis?: string;
  columnOverrides?: Record<string, string>;
}

export interface ImportJob {
  run_id: string;
  file_id: string;
  revision: number;
  name: string;
  report_date: string | null;
  state: 'uploaded' | 'queued' | 'parsing' | 'importing' | 'finalizing' | 'completed' | 'failed';
  error_code: string | null;
  error: string | null;
  processed_rows: number;
  total_rows: number | null;
  counts: { source: number; accepted: number; duplicates: number; rejected: number };
  metrics?: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
}

interface ApiEnvelope<T> {
  data: T;
  message?: string;
  error?: { code?: string };
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function csrfToken(): Promise<string> {
  let token = readCsrfCookie();
  if (token) return token;

  const response = await fetch('/sanctum/csrf-cookie', { credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new ApiError('Unable to initialize the secure session.', response.status);
  token = readCsrfCookie();
  if (!token) throw new ApiError('The server did not issue a CSRF cookie.', 419, 'csrf_token_mismatch');
  return token;
}

function readCsrfCookie(): string | null {
  const encoded = document.cookie.split('; ').find((cookie) => cookie.startsWith('XSRF-TOKEN='))?.slice('XSRF-TOKEN='.length);
  return encoded ? decodeURIComponent(encoded) : null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  headers.set('X-Requested-With', 'XMLHttpRequest');

  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    headers.set('X-XSRF-TOKEN', await csrfToken());
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const stage = headers.get('X-Import-Stage') || 'unspecified';
  for (const [name, value] of Object.entries(importBenchmarkHeaders(stage))) headers.set(name, value);
  const benchmarkRequest = beginImportBenchmarkRequest(stage, init.body);

  let response: Response;
  try {
    response = await fetch(path, { ...init, method, headers, credentials: 'include' });
  } catch (error) {
    finishImportBenchmarkRequest(benchmarkRequest);
    throw error;
  }
  let payload: ApiEnvelope<T>;
  let responseBodyBytes: number | undefined;
  if (importBenchmarkEnabled()) {
    const responseText = await response.text();
    responseBodyBytes = new TextEncoder().encode(responseText).byteLength;
    try { payload = responseText ? JSON.parse(responseText) as ApiEnvelope<T> : {} as ApiEnvelope<T>; }
    catch { payload = {} as ApiEnvelope<T>; }
  } else {
    payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  }
  finishImportBenchmarkRequest(benchmarkRequest, response, responseBodyBytes);
  if (!response.ok) {
    throw new ApiError(
      payload.message || `Request failed with HTTP ${response.status}.`,
      response.status,
      payload.error?.code,
    );
  }

  return payload.data;
}

const organizationPath = (slug: string) => `/api/organizations/${encodeURIComponent(slug)}`;

export async function downloadReceiveVolumePivot(slug: string, rows: VolumeSummary[]): Promise<void> {
  const response = await fetch(`${organizationPath(slug)}/receive/volume/export`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'X-Requested-With': 'XMLHttpRequest', 'X-XSRF-TOKEN': await csrfToken() },
    body: JSON.stringify({ rows }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new ApiError(payload.message || `Export failed with HTTP ${response.status}.`, response.status);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url; link.download = 'receive-volume-comparisons-pivots.xlsx';
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const result = await request<{ user: AuthUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return result.user;
}

export async function logout(): Promise<void> {
  await request('/api/auth/logout', { method: 'POST', body: '{}' });
}

export async function getCurrentUser(): Promise<AuthUser> {
  const result = await request<{ user: AuthUser }>('/api/auth/user');
  return result.user;
}

export async function getOrganizations(): Promise<OrganizationOption[]> {
  const result = await request<{ organizations: OrganizationOption[] }>('/api/organizations');
  return result.organizations;
}

export async function getOrganizationMembers(slug: string): Promise<OrganizationMember[]> {
  const members: OrganizationMember[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ per_page: '100' });
    if (cursor) params.set('cursor', cursor);
    const result = await request<{
      members: OrganizationMember[];
      pagination: { next_cursor: string | null };
    }>(`${organizationPath(slug)}/members?${params.toString()}`);
    members.push(...result.members);
    cursor = result.pagination.next_cursor;
  } while (cursor);
  return members;
}

export async function getAccessCatalog(slug: string): Promise<{
  roles: AccessRole[];
  permissions: AccessPermission[];
}> {
  const [rolesResult, permissionsResult] = await Promise.all([
    request<{ roles: AccessRole[] }>(`${organizationPath(slug)}/roles`),
    request<{ permissions: AccessPermission[] }>(`${organizationPath(slug)}/permissions`),
  ]);
  return { roles: rolesResult.roles, permissions: permissionsResult.permissions };
}

export async function getImportFiles(slug: string): Promise<{
  files: UploadedFile[];
  headers: string[];
  hubLabels: string[];
}> {
  const result = await request<{ files: UploadedFile[]; all_headers: string[]; hub_labels: string[] }>(`${organizationPath(slug)}/imports`, {
    headers: importBenchmarkHeaders('results_files'),
  });
  return { files: result.files, headers: result.all_headers, hubLabels: result.hub_labels };
}

export async function getAllShipments(slug: string): Promise<ShipmentRecord[]> {
  const sources: Array<'published' | 'legacy'> = ['published', 'legacy'];
  const recordsBySource = await Promise.all(sources.map(async (source) => {
    const records: ShipmentRecord[] = [];
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams({ source, per_page: '10000' });
      if (cursor) params.set('cursor', cursor);
      const result = await request<{ shipments: ShipmentRecord[]; pagination: { next_cursor: string | null } }>(
        `${organizationPath(slug)}/imports/shipments?${params.toString()}`,
        { headers: importBenchmarkHeaders(`results_shipments_${source}`) },
      );
      records.push(...result.shipments);
      cursor = result.pagination.next_cursor;
    } while (cursor);
    return records;
  }));

  return recordsBySource.flat();
}

export async function getOrganizationSettings(slug: string): Promise<OrganizationSettings> {
  const result = await request<{ settings: OrganizationSettings }>(`${organizationPath(slug)}/settings`, {
    headers: importBenchmarkHeaders('results_settings'),
  });
  return result.settings;
}

export async function saveOrganizationSetting(slug: string, key: keyof OrganizationSettings, value: unknown): Promise<void> {
  await request(`${organizationPath(slug)}/settings/${key}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
}

export async function uploadWorkbookFile(
  slug: string,
  file: File,
  reportDate: string,
  manualDate: boolean,
  columnOverrides: Record<string, string>,
  onProgress?: (loaded: number, total: number) => void,
): Promise<{ alreadyImported: boolean; duplicateUpload: boolean; fileId: string; runId: string; revision: number; state: ImportJob['state']; counts: ImportJob['counts']; correlationId: string; uploadElapsedMs: number }> {
  const clientStartedAt = performance.now();
  const correlationId = crypto.randomUUID();
  const body = new FormData();
  body.set('file', file, file.name);
  body.set('report_date', reportDate);
  body.set('manual_date', manualDate ? '1' : '0');
  body.set('column_overrides', JSON.stringify(columnOverrides));

  const token = await csrfToken();
  const headers = {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    'X-XSRF-TOKEN': token,
    'X-Import-Stage': 'file_upload',
    ...importBenchmarkHeaders('file_upload'),
    'X-Import-Correlation-Id': correlationId,
  };
  const sample = beginImportBenchmarkRequest('file_upload', body);
  const result = await new Promise<ApiEnvelope<{
    already_imported: boolean;
    duplicate_upload: boolean;
    file_id: string;
    run_id: string;
    revision: number;
    state: ImportJob['state'];
    counts: ImportJob['counts'];
    correlation_id: string;
  }>>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${organizationPath(slug)}/imports`);
    xhr.withCredentials = true;
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
    };
    xhr.onerror = () => {
      finishImportBenchmarkRequest(sample);
      reject(new ApiError('The workbook upload failed because the connection was interrupted.', 0));
    };
    xhr.onload = () => {
      const responseHeaders = new Headers();
      for (const headerName of ['X-Import-Correlation-Id', 'X-Import-Server-Ms', 'X-Import-Sql-Queries', 'X-Import-Sql-Ms', 'X-Import-Server-Phases', 'X-Import-Peak-Memory-Bytes', 'X-Import-Request-Bytes', 'Content-Length']) {
        const value = xhr.getResponseHeader(headerName);
        if (value) responseHeaders.set(headerName, value);
      }
      const response = new Response(xhr.responseText, { status: xhr.status, headers: responseHeaders });
      finishImportBenchmarkRequest(sample, response, new TextEncoder().encode(xhr.responseText).byteLength);
      let payload: ApiEnvelope<{
        already_imported: boolean; duplicate_upload: boolean; file_id: string; run_id: string;
        revision: number; state: ImportJob['state']; counts: ImportJob['counts'];
        correlation_id: string;
      }>;
      try { payload = JSON.parse(xhr.responseText) as typeof payload; }
      catch { payload = {} as typeof payload; }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError(payload.message || `Upload failed with HTTP ${xhr.status}.`, xhr.status, payload.error?.code));
        return;
      }
      resolve(payload);
    };
    xhr.send(body);
  });
  const data = result.data;
  return {
    alreadyImported: data.already_imported,
    duplicateUpload: data.duplicate_upload,
    fileId: data.file_id,
    runId: data.run_id,
    revision: data.revision,
    state: data.state,
    counts: data.counts,
    correlationId: data.correlation_id || correlationId,
    uploadElapsedMs: performance.now() - clientStartedAt,
  };
}

export async function getImportJobs(slug: string): Promise<ImportJob[]> {
  const result = await request<{ jobs: ImportJob[] }>(`${organizationPath(slug)}/imports/jobs`);
  return result.jobs;
}

export async function retryImportRun(slug: string, fileId: string, runId: string): Promise<void> {
  await request(`${organizationPath(slug)}/imports/${fileId}/runs/${runId}/retry`, {
    method: 'POST',
    body: '{}',
  });
}

export async function archiveImport(slug: string, fileId: string): Promise<void> {
  await request(`${organizationPath(slug)}/imports/${fileId}`, { method: 'DELETE' });
}

export async function archiveAllImports(slug: string): Promise<void> {
  await request(`${organizationPath(slug)}/imports`, { method: 'DELETE' });
}

export async function updateImportDate(slug: string, fileId: string, reportDate: string): Promise<void> {
  await request(`${organizationPath(slug)}/imports/${fileId}/date`, {
    method: 'PATCH',
    body: JSON.stringify({ report_date: reportDate }),
  });
}

export interface LegacyFileMetadata {
  id: string;
  name: string;
  size: number;
  detectedDate: string;
  manualDate?: boolean;
  recordCount: number;
  duplicateCount: number;
  uploadedAt: number;
  sheetsCount?: number;
}

export async function startLegacyFileMigration(slug: string, file: LegacyFileMetadata): Promise<{ id: string; complete: boolean }> {
  const legacyKey = await sha256Hex(`${file.id}\u0000${file.name}`);
  const result = await request<{ id: string; migration_status: string }>(`${organizationPath(slug)}/legacy-import-files`, {
    method: 'POST',
    body: JSON.stringify({
      legacy_key: legacyKey,
      original_name: file.name,
      size_bytes: file.size,
      detected_date: file.detectedDate || null,
      manual_date: Boolean(file.manualDate),
      record_count: file.recordCount,
      duplicate_count: file.duplicateCount,
      sheets_count: file.sheetsCount || 0,
      uploaded_at_ms: file.uploadedAt,
    }),
  });

  return { id: result.id, complete: result.migration_status === 'completed' };
}

export async function uploadLegacyRecords(slug: string, fileId: string, chunkIndex: number, records: ShipmentRecord[]): Promise<void> {
  await request(`${organizationPath(slug)}/legacy-import-files/${fileId}/chunks/${chunkIndex}`, {
    method: 'POST',
    body: JSON.stringify({ records }),
  });
}

export async function completeLegacyFileMigration(slug: string, fileId: string): Promise<number> {
  const result = await request<{ records: number }>(`${organizationPath(slug)}/legacy-import-files/${fileId}/complete`, {
    method: 'POST',
    body: '{}',
  });
  return result.records;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
