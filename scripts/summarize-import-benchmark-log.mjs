import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const correlationId = process.argv[2];
const reportPath = path.resolve(process.argv[3] || '');
if (!correlationId || !/^[0-9a-f-]{36}$/i.test(correlationId) || !reportPath.endsWith('.json')) {
  throw new Error('Usage: node scripts/summarize-import-benchmark-log.mjs <correlation-id> <phase3-report.json>');
}

const logDir = path.join(root, 'backend', 'storage', 'logs');
const logFiles = (await readdir(logDir)).filter((name) => /^laravel(?:-\d{4}-\d{2}-\d{2})?\.log$/.test(name));
const events = [];
for (const name of logFiles) {
  const text = await readFile(path.join(logDir, name), 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes(correlationId) || !line.includes('import.benchmark.request ')) continue;
    const marker = line.indexOf('import.benchmark.request ');
    const jsonText = line.slice(marker + 'import.benchmark.request '.length).trim();
    try {
      const event = JSON.parse(jsonText);
      if (event.correlation_id === correlationId) events.push(event);
    } catch { /* Ignore unrelated or partial log entries. */ }
  }
}
if (events.length === 0) throw new Error('No correlated HTTP request metrics were found in Laravel logs.');

const byEndpoint = {};
for (const event of events) {
  const name = event.endpoint || 'unknown';
  const current = byEndpoint[name] || { count: 0, sql_query_count: 0, sql_total_ms: 0, server_wall_ms: 0 };
  current.count++;
  current.sql_query_count += Number(event.sql_query_count) || 0;
  current.sql_total_ms += Number(event.sql_total_ms) || 0;
  current.server_wall_ms += Number(event.elapsed_ms) || 0;
  byEndpoint[name] = current;
}
const httpMetrics = {
  request_count: events.length,
  sql_query_count: events.reduce((sum, event) => sum + (Number(event.sql_query_count) || 0), 0),
  sql_total_ms: +events.reduce((sum, event) => sum + (Number(event.sql_total_ms) || 0), 0).toFixed(3),
  server_wall_ms: +events.reduce((sum, event) => sum + (Number(event.elapsed_ms) || 0), 0).toFixed(3),
  peak_php_memory_bytes: Math.max(...events.map((event) => Number(event.peak_memory_bytes) || 0)),
  request_bytes: events.reduce((sum, event) => sum + (Number(event.request_bytes) || 0), 0),
  by_endpoint: Object.fromEntries(Object.entries(byEndpoint).map(([key, value]) => [key, {
    ...value,
    sql_total_ms: +value.sql_total_ms.toFixed(3),
    server_wall_ms: +value.server_wall_ms.toFixed(3),
  }])),
};
const report = JSON.parse(await readFile(reportPath, 'utf8'));
report.http_request_metrics = httpMetrics;
report.combined_sql_query_count_worker_and_correlated_http = httpMetrics.sql_query_count + (report.server_metrics?.sql_query_count || 0);
report.combined_sql_total_ms_worker_and_correlated_http = +(httpMetrics.sql_total_ms + (report.server_metrics?.sql_total_ms || 0)).toFixed(3);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ correlation_id: correlationId, ...httpMetrics,
  combined_sql_query_count_worker_and_correlated_http: report.combined_sql_query_count_worker_and_correlated_http,
  combined_sql_total_ms_worker_and_correlated_http: report.combined_sql_total_ms_worker_and_correlated_http,
}, null, 2));
