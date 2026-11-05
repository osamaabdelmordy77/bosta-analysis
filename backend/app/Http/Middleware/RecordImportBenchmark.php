<?php

namespace App\Http\Middleware;

use App\Imports\ImportBenchmarkMetrics;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

class RecordImportBenchmark
{
    public function __construct(private readonly ImportBenchmarkMetrics $metrics) {}

    public function handle(Request $request, Closure $next): Response
    {
        if (! config('import_benchmark.enabled')) {
            return $next($request);
        }

        if (DB::connection()->getDatabaseName() !== config('import_benchmark.database')) {
            return response()->json([
                'message' => 'Import benchmarking is restricted to the configured isolated benchmark database.',
                'error' => ['code' => 'benchmark_database_mismatch'],
            ], 409);
        }

        $correlationId = (string) $request->header('X-Import-Correlation-Id', '');
        if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $correlationId) !== 1) {
            return $next($request);
        }

        $this->metrics->begin();
        if (function_exists('memory_reset_peak_usage')) {
            memory_reset_peak_usage();
        }
        $startedAt = hrtime(true);
        $response = null;

        try {
            $response = $next($request);

            return $response;
        } finally {
            $elapsedMs = (hrtime(true) - $startedAt) / 1_000_000;
            $summary = $this->metrics->finish();
            $stage = (string) $request->header('X-Import-Stage', 'unspecified');
            if (preg_match('/^[a-z_]{1,48}$/', $stage) !== 1) {
                $stage = 'unspecified';
            }
            $route = $request->route();
            $serverMs = round($elapsedMs, 3);
            $memoryBytes = memory_get_peak_usage(true);

            Log::info('import.benchmark.request', [
                'correlation_id' => $correlationId,
                'stage' => $stage,
                'endpoint' => $route?->getActionName() ?? 'unresolved',
                'http_status' => $response?->getStatusCode() ?? 500,
                'elapsed_ms' => $serverMs,
                'request_bytes' => max(0, (int) $request->server('CONTENT_LENGTH', 0)),
                'row_count' => max(0, (int) $request->header('X-Import-Row-Count', 0)),
                'peak_memory_bytes' => $memoryBytes,
                ...$summary,
            ]);

            if ($response !== null) {
                $response->headers->set('X-Import-Correlation-Id', $correlationId);
                $response->headers->set('X-Import-Benchmark-Database', DB::connection()->getDatabaseName());
                $response->headers->set('X-Import-Server-Ms', (string) $serverMs);
                $response->headers->set('X-Import-Sql-Queries', (string) $summary['sql_query_count']);
                $response->headers->set('X-Import-Sql-Ms', (string) $summary['sql_total_ms']);
                $response->headers->set('X-Import-Server-Phases', json_encode($summary['server_phases_ms'], JSON_THROW_ON_ERROR));
                $response->headers->set('X-Import-Peak-Memory-Bytes', (string) $memoryBytes);
                $response->headers->set('X-Import-Request-Bytes', (string) max(0, (int) $request->server('CONTENT_LENGTH', 0)));
            }
        }
    }
}
