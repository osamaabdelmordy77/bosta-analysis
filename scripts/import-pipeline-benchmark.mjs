import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(root, 'backend', '.local', 'import-benchmark');
const outputDir = path.join(fixtureDir, 'phase3-results');
const filePath = path.resolve(process.argv[2] || path.join(fixtureDir, 'synthetic_bosta_15mb_211_columns.xlsx'));
const allowedPrefix = fixtureDir.toLowerCase() + path.sep;
const explicitRealWorkbook = process.argv.includes('--real-workbook');
if (!filePath.toLowerCase().startsWith(allowedPrefix) && !explicitRealWorkbook) {
  throw new Error(`Pipeline benchmark accepts generated fixtures under ${fixtureDir} only; it never uploads the source workbook.`);
}

const fileInfo = await stat(filePath);
if (!fileInfo.isFile()) throw new Error('The benchmark input must be a regular file.');
const timeoutMs = Number(process.env.IMPORT_BENCHMARK_TIMEOUT_MS || 60 * 60 * 1000);
const baseUrl = process.env.IMPORT_BENCHMARK_URL || 'http://127.0.0.1:8000';
const expectedDatabase = process.env.IMPORT_BENCHMARK_DATABASE || 'bosta_analysis_benchmark';
if (explicitRealWorkbook && (!['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname)
  || new URL(baseUrl).port === '8000' || !expectedDatabase.endsWith('_benchmark'))) {
  throw new Error('Real workbook benchmarks require a separate loopback API port and an isolated *_benchmark database.');
}
const origin = process.env.IMPORT_BENCHMARK_ORIGIN || 'http://localhost:3001';
const organizationSlug = process.env.IMPORT_BENCHMARK_ORGANIZATION || 'phase1-benchmark';
const email = process.env.IMPORT_BENCHMARK_EMAIL;
const password = process.env.IMPORT_BENCHMARK_PASSWORD;
if (!email || !password) throw new Error('Set IMPORT_BENCHMARK_EMAIL and IMPORT_BENCHMARK_PASSWORD for the isolated benchmark account.');

const totalStartedAt = performance.now();
const fileReadStartedAt = performance.now();
const fileBytes = await readFile(filePath);
const fileReadMs = performance.now() - fileReadStartedAt;
const sha256 = createHash('sha256').update(fileBytes).digest('hex');
const correlationId = randomUUID();
const extension = path.extname(filePath).toLowerCase();
const importName = `${explicitRealWorkbook ? 'real-workbook-benchmark' : 'synthetic-phase3'}-${correlationId}${extension}`;
const reportDate = process.env.IMPORT_BENCHMARK_REPORT_DATE || '2026-11-04';
const apiBase = new URL('/api/', baseUrl);
const organizationPath = `organizations/${encodeURIComponent(organizationSlug)}`;
const cookies = new Map();
const requestStats = {
  count: 0,
  response_body_bytes: 0,
  elapsed_ms: 0,
  sql_query_count: 0,
  sql_total_ms: 0,
  server_wall_ms: 0,
  server_peak_memory_bytes: 0,
  server_request_bytes: 0,
  server_phases_ms: {},
};

function rememberCookies(response) {
  const values = response.headers.getSetCookie?.() || [];
  for (const value of values) {
    const pair = value.split(';', 1)[0];
    const separator = pair.indexOf('=');
    if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader() {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}

function xsrfToken() {
  return decodeURIComponent(cookies.get('XSRF-TOKEN') || '');
}

function headers({ mutating = false } = {}) {
  return {
    Accept: 'application/json',
    Origin: origin,
    'X-Requested-With': 'XMLHttpRequest',
    'X-Import-Correlation-Id': correlationId,
    ...(cookies.size ? { Cookie: cookieHeader() } : {}),
    ...(mutating ? { 'X-XSRF-TOKEN': xsrfToken() } : {}),
  };
}

async function request(route, options = {}) {
  const { stage = 'unspecified', requireBenchmarkDatabase = false, ...fetchOptions } = options;
  const requestStartedAt = performance.now();
  const response = await fetch(new URL(route.replace(/^\//, ''), apiBase), {
    ...fetchOptions,
    headers: { ...headers({ mutating: (fetchOptions.method || 'GET') !== 'GET' }), 'X-Import-Stage': stage, ...fetchOptions.headers },
  });
  rememberCookies(response);
  if (requireBenchmarkDatabase && response.headers.get('X-Import-Benchmark-Database') !== expectedDatabase) {
    throw new Error('The target API did not prove it is using the expected isolated benchmark database. No workbook was uploaded.');
  }
  const bodyText = await response.text();
  const elapsed = performance.now() - requestStartedAt;
  requestStats.count++;
  requestStats.response_body_bytes += Buffer.byteLength(bodyText, 'utf8');
  requestStats.elapsed_ms += elapsed;
  requestStats.sql_query_count += Number(response.headers.get('X-Import-Sql-Queries')) || 0;
  requestStats.sql_total_ms += Number(response.headers.get('X-Import-Sql-Ms')) || 0;
  requestStats.server_wall_ms += Number(response.headers.get('X-Import-Server-Ms')) || 0;
  requestStats.server_peak_memory_bytes = Math.max(requestStats.server_peak_memory_bytes, Number(response.headers.get('X-Import-Peak-Memory-Bytes')) || 0);
  requestStats.server_request_bytes += Number(response.headers.get('X-Import-Request-Bytes')) || 0;
  try {
    const phases = JSON.parse(response.headers.get('X-Import-Server-Phases') || '{}');
    for (const [name, value] of Object.entries(phases)) requestStats.server_phases_ms[name] = (requestStats.server_phases_ms[name] || 0) + Number(value || 0);
  } catch { /* leave server phase aggregation empty if a response omits telemetry */ }
  let envelope = {};
  try { envelope = bodyText ? JSON.parse(bodyText) : {}; } catch { /* preserve the HTTP error below */ }
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${route} returned HTTP ${response.status}: ${envelope.message || 'request failed'}`);
  }
  return envelope.data;
}

const authStartedAt = performance.now();
const csrfStartedAt = performance.now();
const csrfResponse = await fetch(new URL('/sanctum/csrf-cookie', baseUrl), { headers: { Origin: origin } });
rememberCookies(csrfResponse);
const csrfText = await csrfResponse.text();
requestStats.count++;
requestStats.response_body_bytes += Buffer.byteLength(csrfText, 'utf8');
requestStats.elapsed_ms += performance.now() - csrfStartedAt;
if (!csrfResponse.ok || !cookies.has('XSRF-TOKEN')) throw new Error(`CSRF bootstrap failed with HTTP ${csrfResponse.status}.`);
await request('/auth/login', {
  method: 'POST',
  stage: 'auth_login',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const authElapsedMs = performance.now() - authStartedAt;
if (explicitRealWorkbook) {
  await request('/organizations', { stage: 'benchmark_guard', requireBenchmarkDatabase: true });
}
const workflowStartedAt = totalStartedAt;

const uploadStartedAt = performance.now();
const form = new FormData();
const mediaType = path.extname(filePath).toLowerCase() === '.csv'
  ? 'text/csv'
  : path.extname(filePath).toLowerCase() === '.xls'
    ? 'application/vnd.ms-excel'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
form.set('file', new Blob([fileBytes], { type: mediaType }), importName);
form.set('report_date', reportDate);
form.set('manual_date', '0');
form.set('column_overrides', '{}');
const started = await request(`/${organizationPath}/imports`, { method: 'POST', body: form, stage: 'file_upload' });
const uploadRoundTripMs = performance.now() - uploadStartedAt;
if (started.already_imported || started.duplicate_upload) {
  throw new Error('The server treated this benchmark upload as an existing run. Use a fresh isolated benchmark organization.');
}
if (!started.run_id || !started.file_id) throw new Error('The upload response did not contain stable file and run IDs.');
console.log(JSON.stringify({ event: 'uploaded', correlation_id: correlationId, file_id: started.file_id, run_id: started.run_id, upload_http_ms: +uploadRoundTripMs.toFixed(3) }));

const completionWaitStartedAt = performance.now();
const deadline = Date.now() + timeoutMs;
let job = null;
let polls = 0;
let lastProgressSignature = '';
while (Date.now() < deadline) {
  const result = await request(`/${organizationPath}/imports/jobs`, { stage: 'import_status' });
  polls++;
  job = result.jobs?.find((candidate) => candidate.run_id === started.run_id) || null;
  if (job) {
    const progressSignature = `${job.state}:${job.processed_rows}:${job.total_rows}`;
    if (progressSignature !== lastProgressSignature) {
      console.log(JSON.stringify({ event: 'import_progress', correlation_id: correlationId, state: job.state, processed_rows: job.processed_rows, total_rows: job.total_rows }));
      lastProgressSignature = progressSignature;
    }
  }
  if (job?.state === 'completed') break;
  if (job?.state === 'failed') throw new Error(`Import worker failed: ${job.error || job.error_code || 'unknown processing failure'}`);
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
const completionWaitMs = performance.now() - completionWaitStartedAt;
if (!job || job.state !== 'completed') throw new Error(`Timed out waiting for the import worker after ${timeoutMs} ms.`);

const resultFetchStartedAt = performance.now();
async function readShipments(source) {
  const shipments = [];
  let cursor = null;
  const seen = new Set();
  do {
    const query = new URLSearchParams({ source, per_page: '2000' });
    if (cursor) query.set('cursor', cursor);
    const result = await request(`/${organizationPath}/imports/shipments?${query}`, { stage: `results_shipments_${source}` });
    shipments.push(...result.shipments);
    cursor = result.pagination.next_cursor;
    if (cursor && seen.has(cursor)) throw new Error(`Repeated ${source} shipment cursor.`);
    if (cursor) seen.add(cursor);
  } while (cursor);
  return shipments;
}

const [imports, settings, publishedShipments, legacyShipments] = await Promise.all([
  request(`/${organizationPath}/imports`, { stage: 'results_files' }),
  request(`/${organizationPath}/settings`, { stage: 'results_settings' }),
  readShipments('published'),
  readShipments('legacy'),
]);
const resultFetchMs = performance.now() - resultFetchStartedAt;
const totalMs = performance.now() - workflowStartedAt - authElapsedMs;
const metrics = job.metrics || {};
const report = {
  correlation_id: correlationId,
  file: path.basename(filePath),
  uploaded_name: importName,
  file_sha256: sha256,
  file_bytes: fileBytes.byteLength,
  format: path.extname(filePath).slice(1).toLowerCase(),
  report_date: reportDate,
  ids: { file_id: started.file_id, run_id: started.run_id },
  state: job.state,
  phase_timings_ms: {
    client_file_read: +fileReadMs.toFixed(3),
    upload_http_round_trip: +uploadRoundTripMs.toFixed(3),
    queue_wait_and_processing_observation: +completionWaitMs.toFixed(3),
    result_reload_and_json_decode: +resultFetchMs.toFixed(3),
    total_until_results_loaded: +totalMs.toFixed(3),
    server_queue_wait: metrics.queue_wait_ms ?? null,
    server_worker_elapsed: metrics.elapsed_worker_ms ?? null,
    server_queue_to_publish: metrics.server_queue_to_publish_ms ?? null,
    server_workbook_inspection: metrics.server_phases_ms?.workbook_inspection_wall_ms ?? null,
    server_read_transform_and_ingest: metrics.server_phases_ms?.read_validate_transform_and_ingest_wall_ms ?? null,
  },
  server_metrics: metrics,
  counts: job.counts,
  sheets_total: metrics.sheets_total ?? null,
  processed_rows: job.processed_rows,
  total_rows: job.total_rows,
  visible_published_shipments: publishedShipments.length,
  visible_legacy_shipments: legacyShipments.length,
  visible_import_files: imports.files?.length ?? null,
  settings_loaded: Boolean(settings.settings),
  accepted_matches_visible_snapshots: publishedShipments.length === job.counts.accepted,
  requests: {
    ...requestStats,
    status_poll_requests: polls,
    upload_file_requests: 1,
    upload_bytes_received_by_php: metrics.upload_request_bytes ?? null,
    combined_sql_query_count_worker_and_correlated_http: requestStats.sql_query_count + (metrics.sql_query_count || 0),
    combined_sql_total_ms_worker_and_correlated_http: +(requestStats.sql_total_ms + (metrics.sql_total_ms || 0)).toFixed(3),
  },
  response_body_bytes_observed: requestStats.response_body_bytes,
  react_render_ms: null,
  note: 'Measures file read, one API upload, queued server processing, publication, and application result queries. React rendering is intentionally not included; no browser automation was run.',
};

await mkdir(outputDir, { recursive: true });
const outputPath = path.join(outputDir, `${correlationId}.json`);
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ report_path: outputPath, ...report }, null, 2));
