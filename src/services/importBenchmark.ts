type RequestSample = { stage: string; startedAt: number; payloadBytes: number };

type BenchmarkSession = {
  correlationId: string;
  startedAt: number;
  fileBytes: number;
  requests: number;
  uploadPayloadBytesEstimate: number;
  responseBytesObserved: number;
  requestBytesReportedByServer: number;
  sqlQueries: number;
  sqlMilliseconds: number;
  serverMilliseconds: number;
  serverPhasesMs: Record<string, number>;
  phpPeakMemoryBytes: number;
  phases: Record<string, number>;
  requestsByStage: Record<string, number>;
  browserRequestMillisecondsByStage: Record<string, number>;
  requestBytesEstimateByStage: Record<string, number>;
};

let activeSession: BenchmarkSession | null = null;

export function importBenchmarkEnabled(): boolean {
  return import.meta.env.VITE_IMPORT_BENCHMARK === '1';
}

export function startImportBenchmark(fileBytes: number): string | null {
  if (!importBenchmarkEnabled()) return null;

  const correlationId = crypto.randomUUID();
  activeSession = {
    correlationId,
    startedAt: performance.now(),
    fileBytes,
    requests: 0,
    uploadPayloadBytesEstimate: 0,
    responseBytesObserved: 0,
    requestBytesReportedByServer: 0,
    sqlQueries: 0,
    sqlMilliseconds: 0,
    serverMilliseconds: 0,
    serverPhasesMs: {},
    phpPeakMemoryBytes: 0,
    phases: {},
    requestsByStage: {},
    browserRequestMillisecondsByStage: {},
    requestBytesEstimateByStage: {},
  };

  return correlationId;
}

export function recordImportBenchmarkPhase(name: string, milliseconds: number): void {
  if (!activeSession || !Number.isFinite(milliseconds)) return;
  activeSession.phases[name] = (activeSession.phases[name] || 0) + milliseconds;
}

export function beginImportBenchmarkRequest(stage: string, body: BodyInit | null | undefined): RequestSample | null {
  if (!activeSession) return null;
  const payloadBytes = estimatePayloadBytes(body);
  activeSession.requests++;
  activeSession.uploadPayloadBytesEstimate += payloadBytes;
  activeSession.requestsByStage[stage] = (activeSession.requestsByStage[stage] || 0) + 1;
  activeSession.requestBytesEstimateByStage[stage] = (activeSession.requestBytesEstimateByStage[stage] || 0) + payloadBytes;
  return { stage, startedAt: performance.now(), payloadBytes };
}

export function finishImportBenchmarkRequest(sample: RequestSample | null, response?: Response, responseBodyBytes?: number): void {
  if (!activeSession || !sample) return;
  const headers = response?.headers;
  const responseBytes = Number(headers?.get('Content-Length')) || responseBodyBytes || 0;
  if (Number.isFinite(responseBytes) && responseBytes > 0) activeSession.responseBytesObserved += responseBytes;
  activeSession.browserRequestMillisecondsByStage[sample.stage] =
    (activeSession.browserRequestMillisecondsByStage[sample.stage] || 0) + performance.now() - sample.startedAt;
  activeSession.requestBytesReportedByServer += Number(headers?.get('X-Import-Request-Bytes')) || 0;

  const correlationId = headers?.get('X-Import-Correlation-Id');
  if (correlationId && correlationId !== activeSession.correlationId) return;
  activeSession.serverMilliseconds += Number(headers?.get('X-Import-Server-Ms')) || 0;
  try {
    const phases = JSON.parse(headers?.get('X-Import-Server-Phases') || '{}') as Record<string, number>;
    for (const [name, value] of Object.entries(phases)) activeSession.serverPhasesMs[name] = (activeSession.serverPhasesMs[name] || 0) + Number(value || 0);
  } catch { /* Ignore malformed optional telemetry headers. */ }
  activeSession.sqlQueries += Number(headers?.get('X-Import-Sql-Queries')) || 0;
  activeSession.sqlMilliseconds += Number(headers?.get('X-Import-Sql-Ms')) || 0;
  activeSession.phpPeakMemoryBytes = Math.max(
    activeSession.phpPeakMemoryBytes,
    Number(headers?.get('X-Import-Peak-Memory-Bytes')) || 0,
  );
}

export function importBenchmarkHeaders(stage: string, rowCount?: number): Record<string, string> {
  if (!activeSession) return {};
  return {
    'X-Import-Correlation-Id': activeSession.correlationId,
    'X-Import-Stage': stage,
    ...(rowCount === undefined ? {} : { 'X-Import-Row-Count': String(rowCount) }),
  };
}

export function finishImportBenchmark(summary: {
  sheets: number;
  rows: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  warnings: number;
  error?: boolean;
}): void {
  if (!activeSession) return;
  const session = activeSession;
  activeSession = null;
  const totalMs = performance.now() - session.startedAt;
  console.info('[import-benchmark]', JSON.stringify({
    correlation_id: session.correlationId,
    sheets: summary.sheets,
    source_rows: summary.rows,
    accepted: summary.accepted,
    duplicates: summary.duplicates,
    rejected: summary.rejected,
    warnings: summary.warnings,
    file_bytes: session.fileBytes,
    request_count: session.requests,
    upload_payload_bytes_estimate: session.uploadPayloadBytesEstimate,
    request_bytes_estimate_by_stage: session.requestBytesEstimateByStage,
    request_bytes_reported_by_server: session.requestBytesReportedByServer,
    response_bytes_observed: session.responseBytesObserved,
    browser_request_elapsed_ms_by_stage: Object.fromEntries(Object.entries(session.browserRequestMillisecondsByStage).map(([name, ms]) => [name, +ms.toFixed(3)])),
    browser_phases_ms: Object.fromEntries(Object.entries(session.phases).map(([name, ms]) => [name, +ms.toFixed(3)])),
    server_request_wall_ms_sum: +session.serverMilliseconds.toFixed(3),
    server_phases_ms: Object.fromEntries(Object.entries(session.serverPhasesMs).map(([name, ms]) => [name, +ms.toFixed(3)])),
    sql_query_count: session.sqlQueries,
    sql_total_ms: +session.sqlMilliseconds.toFixed(3),
    php_peak_memory_bytes: session.phpPeakMemoryBytes,
    browser_worker_peak_memory_bytes: null,
    browser_worker_memory_note: 'Standard browser APIs do not expose a Web Worker heap high-water mark.',
    queue_wait_ms: 0,
    total_ms: +totalMs.toFixed(3),
    failed: !!summary.error,
    requests_by_stage: session.requestsByStage,
  }));
}

function estimatePayloadBytes(body: BodyInit | null | undefined): number {
  if (body == null) return 0;
  if (typeof body === 'string') return new TextEncoder().encode(body).byteLength;
  if (body instanceof Blob) return body.size;
  if (body instanceof FormData) {
    let size = 256; // Multipart boundaries and headers are approximate; PHP reports exact request bytes.
    body.forEach((value, name) => {
      size += new TextEncoder().encode(name).byteLength + 64;
      size += typeof value === 'string' ? new TextEncoder().encode(value).byteLength : value.size;
    });
    return size;
  }
  if (body instanceof URLSearchParams) return new TextEncoder().encode(body.toString()).byteLength;
  return 0;
}
