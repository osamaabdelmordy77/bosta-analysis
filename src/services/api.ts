import { UploadedFile, ShipmentRecord } from '../types';
import { ParseResult } from '../utils/excelParser';

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

export interface OrganizationSettings {
  hubBasis?: string;
  columnOverrides?: Record<string, string>;
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

  const response = await fetch(path, { ...init, method, headers, credentials: 'include' });
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
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

export async function getImportFiles(slug: string): Promise<{
  files: UploadedFile[];
  headers: string[];
  hubLabels: string[];
}> {
  const result = await request<{ files: UploadedFile[]; all_headers: string[]; hub_labels: string[] }>(`${organizationPath(slug)}/imports`);
  return { files: result.files, headers: result.all_headers, hubLabels: result.hub_labels };
}

export async function getAllShipments(slug: string): Promise<ShipmentRecord[]> {
  const sources: Array<'published' | 'legacy'> = ['published', 'legacy'];
  const records: ShipmentRecord[] = [];

  for (const source of sources) {
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams({ source, per_page: '1000' });
      if (cursor) params.set('cursor', cursor);
      const result = await request<{ shipments: ShipmentRecord[]; pagination: { next_cursor: string | null } }>(
        `${organizationPath(slug)}/imports/shipments?${params.toString()}`,
      );
      records.push(...result.shipments);
      cursor = result.pagination.next_cursor;
    } while (cursor);
  }

  return records;
}

export async function getOrganizationSettings(slug: string): Promise<OrganizationSettings> {
  const result = await request<{ settings: OrganizationSettings }>(`${organizationPath(slug)}/settings`);
  return result.settings;
}

export async function saveOrganizationSetting(slug: string, key: keyof OrganizationSettings, value: unknown): Promise<void> {
  await request(`${organizationPath(slug)}/settings/${key}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
}

export async function startWorkbookImport(
  slug: string,
  file: File,
  reportDate: string,
  manualDate: boolean,
  parsed: ParseResult,
  columnOverrides: Record<string, string>,
): Promise<{ alreadyImported: boolean; fileId: string; runId: string; sheetIds: Record<number, string>; revision: number; counts: { accepted: number; duplicates: number; rejected: number } }> {
  const body = new FormData();
  body.set('file', file, file.name);
  body.set('report_date', reportDate);
  body.set('manual_date', manualDate ? '1' : '0');
  body.set('sheets', JSON.stringify(parsed.sourceSheets.map(({ index, name, headerRowNumber, headers }) => ({
    index,
    name,
    header_row_number: headerRowNumber,
    headers,
  }))));
  body.set('column_overrides', JSON.stringify(columnOverrides));

  const result = await request<{
    already_imported: boolean;
    file_id: string;
    run_id: string;
    sheet_ids: Record<string, string>;
    revision: number;
    counts: { accepted: number; duplicates: number; rejected: number };
  }>(`${organizationPath(slug)}/imports`, { method: 'POST', body });

  return {
    alreadyImported: result.already_imported,
    fileId: result.file_id,
    runId: result.run_id,
    sheetIds: Object.fromEntries(Object.entries(result.sheet_ids).map(([index, id]) => [Number(index), id])),
    revision: result.revision,
    counts: result.counts,
  };
}

export async function uploadWorkbookRows(
  slug: string,
  fileId: string,
  runId: string,
  sheetId: string,
  chunkIndex: number,
  rows: ParseResult['sourceSheets'][number]['rows'],
  columnOverrides: Record<string, string>,
): Promise<void> {
  await request(`${organizationPath(slug)}/imports/${fileId}/runs/${runId}/sheets/${sheetId}/chunks`, {
    method: 'POST',
    body: JSON.stringify({ chunk_index: chunkIndex, rows, column_overrides: columnOverrides }),
  });
}

export async function publishWorkbookImport(slug: string, fileId: string, runId: string): Promise<void> {
  await request(`${organizationPath(slug)}/imports/${fileId}/runs/${runId}/publish`, { method: 'POST', body: '{}' });
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
