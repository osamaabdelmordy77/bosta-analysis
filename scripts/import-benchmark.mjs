import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { parseExcelBuffer } from '../src/utils/excelParser.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'backend', '.local', 'import-benchmark');
const manifestPath = path.join(root, 'docs', 'phase-00', 'bosta_211_column_manifest.json');
const command = process.argv[2] || 'profile';
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  .sort((a, b) => a.source_number - b.source_number);
const headers = manifest.map((column) => column.source_label);
const headerIndex = new Map(headers.map((label, index) => [label.toLowerCase(), index]));
const set = (row, label, value) => {
  const index = headerIndex.get(label.toLowerCase());
  if (index !== undefined) row[index] = value;
};

if (command === 'generate') {
  const rowCount = Number(process.argv[3] || 15120);
  const noteLength = Number(process.argv[4] || 220);
  if (!Number.isInteger(rowCount) || rowCount < 100 || rowCount > 100000) throw new Error('Rows must be from 100 to 100000.');
  if (!Number.isInteger(noteLength) || noteLength < 16 || noteLength > 10000) throw new Error('Note length must be from 16 to 10000.');
  await mkdir(outputDir, { recursive: true });
  const splitAt = Math.floor(rowCount / 2);
  const makeRows = (first, count) => {
    const rows = [headers];
    for (let offset = 0; offset < count; offset++) {
      const global = first + offset;
      const row = Array(headers.length).fill(null);
      const tracking = global === splitAt
        ? 'SYN-00000001'
        : global > 0 && global % 200 === 0
        ? `SYN-${String(global - 1).padStart(8, '0')}`
        : global % 997 === 0 ? '' : `SYN-${String(global).padStart(8, '0')}`;
      set(row, 'Business', global % 29 === 0 ? '' : `Synthetic Merchant ${global % 31}`);
      set(row, 'Business ID', `SYN-BIZ-${String(global % 31).padStart(3, '0')}`);
      set(row, 'Tracking Number', tracking);
      set(row, 'Package Size', ['Small', 'Medium', 'Large'][global % 3]);
      set(row, 'Shipment Type', ['Delivery', 'Exchange', 'Return'][global % 3]);
      set(row, 'Pickup City', ['Cairo', 'Giza', 'Alexandria'][global % 3]);
      set(row, 'DropOff City', ['Tanta', 'Mansoura', 'Cairo'][global % 3]);
      set(row, 'Items', global % 17 === 0 ? '' : (global % 9) + 1);
      set(row, 'Notes', `SYNTHETIC-${global}-` + deterministicText(global, noteLength));
      for (const label of headers) {
        const normalized = label.toLowerCase();
        if (/amount|fee|cod|price|cost|cash/.test(normalized)) {
          set(row, label, (global * 137 % 120000) / 100);
        }
        if (/date/.test(normalized) && !/attempt/.test(normalized)) {
          set(row, label, global % 997 === 0 ? 'not-a-date' : `2026-10-${String((global % 28) + 1).padStart(2, '0')}`);
        }
        const attempt = normalized.match(/attempt\s*(\d+)/);
        if (attempt) {
          const attemptNumber = Number(attempt[1]);
          if (attemptNumber <= (global % 9)) {
            const value = /date|time/.test(normalized) ? '2026-10-15 10:30:00'
              : /status|reason/.test(normalized) ? ['Delivered', 'No answer', 'Rescheduled'][attemptNumber % 3]
                : attemptNumber + 1;
            set(row, label, value);
          }
        }
      }
      rows.push(row);
    }
    return rows;
  };

  const firstRows = makeRows(0, splitAt);
  const secondRows = makeRows(splitAt, rowCount - splitAt);
  const largeWorkbook = XLSX.utils.book_new();
  const firstSheet = XLSX.utils.aoa_to_sheet(firstRows);
  const secondSheet = XLSX.utils.aoa_to_sheet(secondRows);
  const range = XLSX.utils.decode_range(secondSheet['!ref']);
  range.e.r += 5000; // Exercise a worksheet range larger than the non-empty row set.
  secondSheet['!ref'] = XLSX.utils.encode_range(range);
  XLSX.utils.book_append_sheet(largeWorkbook, firstSheet, 'Deliveries A');
  XLSX.utils.book_append_sheet(largeWorkbook, secondSheet, 'Deliveries B');
  const workbookName = noteLength <= 800 ? 'synthetic_bosta_15mb_211_columns.xlsx' : 'synthetic_bosta_limit_211_columns.xlsx';
  const largePath = path.join(outputDir, workbookName);
  await writeFile(largePath, XLSX.write(largeWorkbook, { type: 'buffer', bookType: 'xlsx', compression: true }));

  const compatibilityRows = makeRows(0, 100);
  const xlsWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(xlsWorkbook, XLSX.utils.aoa_to_sheet(compatibilityRows), 'Legacy XLS');
  const xlsPath = path.join(outputDir, 'synthetic_bosta_compatibility.xls');
  await writeFile(xlsPath, XLSX.write(xlsWorkbook, { type: 'buffer', bookType: 'biff8' }));
  const csv = XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(compatibilityRows));
  const csvPath = path.join(outputDir, 'synthetic_bosta_compatibility.csv');
  await writeFile(csvPath, `\uFEFF${csv}`, 'utf8');

  const files = [];
  for (const filePath of [largePath, xlsPath, csvPath]) {
    const info = await stat(filePath);
    const bytes = await readFile(filePath);
    files.push({ file: path.basename(filePath), bytes: info.size, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  console.log(JSON.stringify({ output: outputDir, rows: rowCount, columns: headers.length, sheets: 2, duplicates: 'every 200th source row plus a cross-sheet repeat at the second sheet start', missing_tracking: 'every 997th source row', invalid_dates: 'every 997th source row', oversized_used_range_extra_rows: 5000, synthetic_notes_per_row: noteLength, files }, null, 2));
} else if (command === 'profile') {
  const filePath = path.resolve(process.argv[3] || path.join(root, 'Deliveries_Export_2026-09-28-1790623015813.xlsx'));
  const readStartedAt = performance.now();
  const fileBytes = await readFile(filePath);
  const readMs = performance.now() - readStartedAt;
  const buffer = fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength);
  const parseStartedAt = performance.now();
  const parsed = parseExcelBuffer(buffer, path.basename(filePath), path.basename(filePath), '2026-09-28', {}, { includeDashboardRecords: false });
  const parseMs = performance.now() - parseStartedAt;
  const result = {
    file: path.basename(filePath),
    file_bytes: fileBytes.byteLength,
    file_read_ms_node_proxy: +readMs.toFixed(3),
    parse_and_row_extraction_ms_node_main_thread: +parseMs.toFixed(3),
    sheets: parsed.sourceSheets.map((sheet) => ({ index: sheet.index, name: sheet.name, header_row: sheet.headerRowNumber, columns: sheet.headers.length, extracted_rows: sheet.rows.length })),
    source_rows: parsed.sourceSheets.reduce((sum, sheet) => sum + sheet.rows.length, 0),
    parse_statistics: parsed.stats,
    memory: {
      heap_used_bytes: process.memoryUsage().heapUsed,
      rss_bytes: process.memoryUsage().rss,
    },
    network_sql_publish_results: 'not measured by this local parser-only command; run the UI with VITE_IMPORT_BENCHMARK=1 and IMPORT_BENCHMARK_ENABLED=true for one aggregate browser record plus correlated PHP request records.',
  };
  console.log(JSON.stringify(result, null, 2));
} else if (command === 'legacy-client-benchmark') {
  const filePath = path.resolve(process.argv[3] || path.join(outputDir, 'synthetic_bosta_15mb_211_columns.xlsx'));
  const normalizedOutput = path.resolve(outputDir) + path.sep;
  if (!filePath.toLowerCase().startsWith(normalizedOutput.toLowerCase())) {
    throw new Error(`Full-import benchmark only accepts generated synthetic files under ${outputDir}`);
  }
  const baseUrl = process.env.IMPORT_BENCHMARK_URL || 'http://127.0.0.1:8000';
  const organizationSlug = process.env.IMPORT_BENCHMARK_ORGANIZATION || 'phase1-benchmark';
  const email = process.env.IMPORT_BENCHMARK_EMAIL;
  const password = process.env.IMPORT_BENCHMARK_PASSWORD;
  if (!email || !password) throw new Error('Set IMPORT_BENCHMARK_EMAIL and IMPORT_BENCHMARK_PASSWORD for the isolated benchmark account.');

  const cookies = new Map();
  const origin = process.env.IMPORT_BENCHMARK_ORIGIN || 'http://localhost:3000';
  const rememberCookies = (response) => {
    for (const value of response.headers.getSetCookie?.() || []) {
      const [pair] = value.split(';', 1);
      const separator = pair.indexOf('=');
      if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  };
  const cookieHeader = () => [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
  const baseHeaders = () => ({
    Accept: 'application/json',
    Origin: origin,
    'X-Requested-With': 'XMLHttpRequest',
    ...(cookies.size ? { Cookie: cookieHeader() } : {}),
  });
  const csrfResponse = await fetch(new URL('/sanctum/csrf-cookie', baseUrl), { headers: { Origin: origin } });
  rememberCookies(csrfResponse);
  if (!csrfResponse.ok || !cookies.has('XSRF-TOKEN')) throw new Error(`CSRF bootstrap failed with HTTP ${csrfResponse.status}.`);
  const csrfToken = () => decodeURIComponent(cookies.get('XSRF-TOKEN') || '');
  const loginResponse = await fetch(new URL('/api/auth/login', baseUrl), {
    method: 'POST',
    headers: { ...baseHeaders(), 'Content-Type': 'application/json', 'X-XSRF-TOKEN': csrfToken() },
    body: JSON.stringify({ email, password }),
  });
  rememberCookies(loginResponse);
  if (!loginResponse.ok) throw new Error(`Benchmark account login failed with HTTP ${loginResponse.status}.`);

  const correlationId = randomUUID();
  const server = { request_count: 0, request_bytes: 0, response_bytes_observed: 0, sql_query_count: 0, sql_total_ms: 0, request_wall_ms: 0, php_peak_memory_bytes: 0, phases_ms: {} };
  const requestMsByStage = {};
  const requestBytesEstimateByStage = {};
  const apiRequest = async (route, { method = 'GET', body, stage = 'unspecified', rowCount } = {}) => {
    const headers = {
      ...baseHeaders(),
      ...(method === 'GET' ? {} : { 'X-XSRF-TOKEN': csrfToken() }),
      'X-Import-Correlation-Id': correlationId,
      'X-Import-Stage': stage,
      ...(rowCount === undefined ? {} : { 'X-Import-Row-Count': String(rowCount) }),
    };
    if (body != null && !(body instanceof FormData) && typeof body !== 'string') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    } else if (typeof body === 'string') {
      headers['Content-Type'] = 'application/json';
    }
    const payloadBytes = body == null ? 0
      : typeof body === 'string' ? Buffer.byteLength(body)
        : body instanceof FormData ? 0 : 0;
    requestBytesEstimateByStage[stage] = (requestBytesEstimateByStage[stage] || 0) + payloadBytes;
    const startedAt = performance.now();
    const response = await fetch(new URL(route, baseUrl), { method, headers, body });
    rememberCookies(response);
    const text = await response.text();
    const requestElapsed = performance.now() - startedAt;
    requestMsByStage[stage] = (requestMsByStage[stage] || 0) + requestElapsed;
    server.request_count++;
    server.request_bytes += Number(response.headers.get('X-Import-Request-Bytes')) || 0;
    server.response_bytes_observed += Buffer.byteLength(text, 'utf8');
    server.sql_query_count += Number(response.headers.get('X-Import-Sql-Queries')) || 0;
    server.sql_total_ms += Number(response.headers.get('X-Import-Sql-Ms')) || 0;
    server.request_wall_ms += Number(response.headers.get('X-Import-Server-Ms')) || 0;
    server.php_peak_memory_bytes = Math.max(server.php_peak_memory_bytes, Number(response.headers.get('X-Import-Peak-Memory-Bytes')) || 0);
    try {
      const phases = JSON.parse(response.headers.get('X-Import-Server-Phases') || '{}');
      for (const [name, value] of Object.entries(phases)) server.phases_ms[name] = (server.phases_ms[name] || 0) + Number(value || 0);
    } catch {}
    let envelope;
    try { envelope = text ? JSON.parse(text) : {}; } catch { envelope = {}; }
    if (!response.ok) throw new Error(`${method} ${route} returned HTTP ${response.status}: ${envelope.message || 'request failed'}`);
    return envelope.data;
  };

  const totalStartedAt = performance.now();
  const readStartedAt = performance.now();
  const fileBytes = await readFile(filePath);
  const fileReadMs = performance.now() - readStartedAt;
  const buffer = fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength);
  const parseStartedAt = performance.now();
  const parsed = parseExcelBuffer(buffer, path.basename(filePath), path.basename(filePath), '2026-11-04', {}, { includeDashboardRecords: false });
  const parseMs = performance.now() - parseStartedAt;
  const rows = parsed.sourceSheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);

  const uploadStartedAt = performance.now();
  const form = new FormData();
  const importName = process.env.IMPORT_BENCHMARK_FILE_NAME || `synthetic-benchmark-${correlationId}.xlsx`;
  form.set('file', new Blob([fileBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), importName);
  form.set('report_date', '2026-11-04');
  form.set('manual_date', '0');
  form.set('sheets', JSON.stringify(parsed.sourceSheets.map(({ index, name, dateSystem, headerRowNumber, headers: sheetHeaders }) => ({
    index, name, date_system: dateSystem, header_row_number: headerRowNumber, headers: sheetHeaders,
  }))));
  form.set('column_overrides', '{}');
  const started = await apiRequest(`/api/organizations/${encodeURIComponent(organizationSlug)}/imports`, { method: 'POST', body: form, stage: 'file_upload' });
  if (started.already_imported) {
    throw new Error('This synthetic file is already present in the selected organization. Use a fresh synthetic benchmark organization so the run includes upload, chunk persistence, and publish.');
  }
  const fileUploadMs = performance.now() - uploadStartedAt;

  let accepted = 0; let duplicates = 0; let rejected = 0; let chunkIssueCount = 0; let chunkRequests = 0;
  let chunksMs = 0;
  let published;
  let publishMs = 0;
  const chunksStartedAt = performance.now();
  for (const sheet of parsed.sourceSheets) {
    const sheetId = started.sheet_ids[String(sheet.index)];
    if (!sheetId) throw new Error(`No server sheet id was returned for source sheet ${sheet.index}.`);
    for (let offset = 0, chunkIndex = 0; offset < sheet.rows.length; offset += 200, chunkIndex++) {
      const chunkRows = sheet.rows.slice(offset, offset + 200);
      const result = await apiRequest(
        `/api/organizations/${encodeURIComponent(organizationSlug)}/imports/${started.file_id}/runs/${started.run_id}/sheets/${sheetId}/chunks`,
        {
          method: 'POST',
          stage: 'row_chunk',
          rowCount: chunkRows.length,
          body: {
            chunk_index: chunkIndex,
            rows: chunkRows.map((row) => ({ source_row_number: row.sourceRowNumber, values: row.values })),
            column_overrides: {},
          },
        },
      );
      accepted += result.accepted;
      duplicates += result.duplicates;
      rejected += result.rejected;
      chunkIssueCount += result.issues;
      chunkRequests++;
    }
  }
  chunksMs = performance.now() - chunksStartedAt;

  const publishStartedAt = performance.now();
  published = await apiRequest(`/api/organizations/${encodeURIComponent(organizationSlug)}/imports/${started.file_id}/runs/${started.run_id}/publish`, {
    method: 'POST', body: {}, stage: 'publish',
  });
  publishMs = performance.now() - publishStartedAt;

  const resultsStartedAt = performance.now();
  const organizationPath = `/api/organizations/${encodeURIComponent(organizationSlug)}`;
  const shipments = [];
  const readShipments = async (source) => {
    let cursor = null;
    const seenCursors = new Set();
    do {
      const params = new URLSearchParams({ source, per_page: '1000' });
      if (cursor) params.set('cursor', cursor);
      const result = await apiRequest(`${organizationPath}/imports/shipments?${params}`, { stage: `results_shipments_${source}` });
      shipments.push(...result.shipments);
      cursor = result.pagination.next_cursor;
      if (cursor && seenCursors.has(cursor)) throw new Error(`Repeated ${source} results cursor; refusing to loop forever.`);
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
  };
  const [files, settings] = await Promise.all([
    apiRequest(`${organizationPath}/imports`, { stage: 'results_files' }),
    apiRequest(`${organizationPath}/settings`, { stage: 'results_settings' }),
    readShipments('published'),
    readShipments('legacy'),
  ]);
  const resultsMs = performance.now() - resultsStartedAt;
  const totalMs = performance.now() - totalStartedAt;
  const report = {
    correlation_id: correlationId,
    synthetic_file: path.basename(filePath),
    synthetic_upload_name: importName,
    import_reused: started.already_imported,
    file_bytes: fileBytes.byteLength,
    sheets: parsed.sourceSheets.length,
    source_rows: rows,
    accepted,
    duplicates,
    rejected,
    issues: chunkIssueCount,
    warnings: published.counts.warnings,
    phases_ms: {
      file_read_node_proxy: +fileReadMs.toFixed(3),
      workbook_parse_and_row_extraction_node_main_thread: +parseMs.toFixed(3),
      file_upload_request: +fileUploadMs.toFixed(3),
      sequential_row_chunk_requests: +chunksMs.toFixed(3),
      publish: +publishMs.toFixed(3),
      result_fetches_and_json_decode: +resultsMs.toFixed(3),
      browser_display_and_react_render: null,
    },
    total_until_results_loaded: +totalMs.toFixed(3),
    queue_wait_ms: 0,
    counts_reported_by_publish: published.counts,
    files_visible_after_publish: files.files.length,
    settings_received: !!settings.settings,
    shipment_records_received: shipments.length,
    actual_http_requests: server.request_count,
    row_chunk_requests: chunkRequests,
    request_bytes_from_php_content_length: server.request_bytes,
    estimated_json_payload_bytes_by_stage: requestBytesEstimateByStage,
    response_body_utf8_bytes_observed: server.response_bytes_observed,
    browser_request_elapsed_ms_by_stage: Object.fromEntries(Object.entries(requestMsByStage).map(([key, value]) => [key, +value.toFixed(3)])),
    server_request_wall_ms_sum: +server.request_wall_ms.toFixed(3),
    server_phases_ms: Object.fromEntries(Object.entries(server.phases_ms).map(([key, value]) => [key, +value.toFixed(3)])),
    sql_query_count: server.sql_query_count,
    sql_total_ms: +server.sql_total_ms.toFixed(3),
    php_peak_memory_bytes: server.php_peak_memory_bytes,
    node_heap_used_after_results_bytes: process.memoryUsage().heapUsed,
    node_peak_rss_kib: process.resourceUsage().maxRSS,
    note: 'API, storage, parsing and results download measured. Run through the React UI with both benchmark flags enabled to add actual browser-worker timing and result-render timing.',
  };
  console.log(JSON.stringify(report, null, 2));
} else {
  throw new Error('The client-row import benchmark was retired in Phase 3. Use `npm run benchmark:import-pipeline -- <synthetic-file>` for the queued server pipeline. Usage: node --import tsx scripts/import-benchmark.mjs [generate [rows [note-length]] | profile [file]]');
}

function deterministicText(seed, length) {
  let state = (seed + 1) >>> 0;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  while (text.length < length) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    text += alphabet[state % alphabet.length];
  }
  return text.slice(0, length);
}
