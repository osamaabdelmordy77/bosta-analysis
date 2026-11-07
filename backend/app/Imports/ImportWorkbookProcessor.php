<?php

namespace App\Imports;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

class ImportWorkbookProcessor
{
    public function __construct(
        private readonly ImportFileContentStorage $contentStorage,
        private readonly ImportWorkbookReader $reader,
        private readonly ImportIngestionService $ingestion,
        private readonly ImportPublicationService $publication,
        private readonly ImportBenchmarkMetrics $metrics,
    ) {}

    public function process(string $organizationId, string $fileId, string $runId): void
    {
        $startedAt = hrtime(true);
        $workerStartedWall = now();
        $this->metrics->begin();
        if (function_exists('memory_reset_peak_usage')) {
            memory_reset_peak_usage();
        }

        $temporaryOriginal = null;
        try {
            $run = DB::table('import_runs')->where('id', $runId)->where('import_file_id', $fileId)
                ->where('organization_id', $organizationId)->first();
            if (! $run || $run->processing_state === 'completed') {
                return;
            }
            if ($run->processing_state !== 'queued' && $run->processing_state !== 'parsing'
                && $run->processing_state !== 'importing' && $run->processing_state !== 'finalizing') {
                throw new RuntimeException('This import run is not available for processing.');
            }
            $queueWaitMs = $run->queued_at === null ? null
                : max(0, Carbon::parse($run->queued_at)->diffInMilliseconds($workerStartedWall));

            $now = now();
            DB::table('import_runs')->where('id', $runId)->where('organization_id', $organizationId)->update([
                'processing_state' => 'parsing',
                'processing_error_code' => null,
                'processing_error' => null,
                'processing_started_at' => DB::raw('COALESCE(processing_started_at, '.DB::connection()->getPdo()->quote($now->toDateTimeString()).')'),
                'started_at' => DB::raw('COALESCE(started_at, '.DB::connection()->getPdo()->quote($now->toDateTimeString()).')'),
                'updated_at' => $now,
            ]);

            $file = DB::table('import_files')->where('id', $fileId)->where('organization_id', $organizationId)->first();
            $content = DB::table('import_file_contents')->where('import_run_id', $runId)
                ->where('import_file_id', $fileId)->where('organization_id', $organizationId)->first();
            if (! $file || ! $content) {
                throw new RuntimeException('The private workbook reference is missing.');
            }

            $phaseStartedAt = hrtime(true);
            $pathResult = $this->contentStorage->resolveForProcessing($content);
            $this->metrics->addPhase('private_original_verify_or_materialize_wall_ms', (hrtime(true) - $phaseStartedAt) / 1_000_000);
            $temporaryOriginal = $pathResult['temporary'] ? $pathResult['path'] : null;
            $extension = strtolower(pathinfo((string) $file->original_name, PATHINFO_EXTENSION));
            $options = $this->decodeOptions($run->processing_options);
            $overrides = $options['column_overrides'] ?? [];
            if (! is_array($overrides)) {
                throw new RuntimeException('The saved import column settings are invalid.');
            }

            $phaseStartedAt = hrtime(true);
            $inspection = $this->reader->inspect($pathResult['path'], $extension, $overrides);
            $this->metrics->addPhase('workbook_inspection_wall_ms', (hrtime(true) - $phaseStartedAt) / 1_000_000);
            $mappingFingerprint = $this->mappingFingerprint($run, $inspection, $overrides, $options);

            $this->registerSheets($organizationId, $runId, $run, $inspection, $overrides, $mappingFingerprint);

            $duplicate = $this->findPublishedDuplicate($organizationId, $fileId, $runId, $run, $content, $mappingFingerprint);
            if ($duplicate !== null) {
                $this->completeAsDuplicate($organizationId, $runId, $duplicate, $inspection, $startedAt, $queueWaitMs, $options, $file, $content);

                return;
            }

            DB::table('import_runs')->where('id', $runId)->where('organization_id', $organizationId)->update([
                'processing_state' => 'importing',
                'mapping_fingerprint' => $mappingFingerprint,
                'total_source_rows' => null,
                'updated_at' => now(),
            ]);

            $sheetIds = DB::table('import_sheets')->where('import_run_id', $runId)
                ->where('organization_id', $organizationId)->pluck('id', 'source_sheet_index')->map(fn ($id): string => (string) $id)->all();
            $candidateIndexes = array_fill_keys(array_map('intval', array_column($inspection['selected_sheets'], 'index')), true);
            $hubLabels = $inspection['hub_labels'];
            $seenTracking = [];
            $validRecordNumber = 0;
            $pendingRows = [];
            $activeSheetIndex = null;
            $chunkIndex = 0;
            $observedRows = 0;
            // Existing runs used 400 rows. New runs retain their original saved size on retry.
            $rowsPerChunk = max(100, min(2000, (int) ($options['source_chunk_rows'] ?? 400)));

            $flushMilliseconds = 0.0;
            $flush = function () use (&$pendingRows, &$activeSheetIndex, &$chunkIndex, &$observedRows, &$flushMilliseconds, $organizationId, $fileId, $runId, $sheetIds, $overrides): void {
                if ($pendingRows === [] || $activeSheetIndex === null) {
                    return;
                }
                $sheetId = $sheetIds[$activeSheetIndex] ?? null;
                if ($sheetId === null) {
                    throw new RuntimeException('A workbook worksheet was not registered for import.');
                }
                $flushStartedAt = hrtime(true);
                $this->ingestion->ingestChunk($organizationId, $fileId, $runId, $sheetId, $chunkIndex, $pendingRows, $overrides);
                $pendingRows = [];
                $chunkIndex++;
                $observedRows = (int) DB::table('import_runs')->where('id', $runId)->where('organization_id', $organizationId)->value('source_rows_count');
                DB::table('import_runs')->where('id', $runId)->where('organization_id', $organizationId)->update([
                    'processed_source_rows' => $observedRows,
                    'updated_at' => now(),
                ]);
                $flushMilliseconds += (hrtime(true) - $flushStartedAt) / 1_000_000;
            };

            $phaseStartedAt = hrtime(true);
            foreach ($this->reader->rows($pathResult['path'], $inspection) as $row) {
                $sheetIndex = (int) $row['sheet']['index'];
                if ($activeSheetIndex !== null && $activeSheetIndex !== $sheetIndex) {
                    $flush();
                    $chunkIndex = 0;
                }
                $activeSheetIndex = $sheetIndex;
                $dashboardRecord = isset($candidateIndexes[$sheetIndex])
                    ? $this->reader->dashboardRecord(
                        $row['sheet'], $row['values'], (string) $file->original_name, $validRecordNumber, $seenTracking, $overrides, $hubLabels,
                    )
                    : null;
                $pendingRows[] = [
                    'source_row_number' => (int) $row['source_row_number'],
                    'values' => $row['values'],
                    'dashboard_record' => $dashboardRecord,
                ];
                if (count($pendingRows) >= $rowsPerChunk) {
                    $flush();
                }
            }
            $flush();
            $readAndIngestMilliseconds = (hrtime(true) - $phaseStartedAt) / 1_000_000;
            $this->metrics->addPhase('read_validate_transform_and_ingest_wall_ms', $readAndIngestMilliseconds);
            $this->metrics->addPhase('chunk_ingestion_and_progress_wall_ms', $flushMilliseconds);
            $this->metrics->addPhase('reader_and_dashboard_wall_ms', max(0, $readAndIngestMilliseconds - $flushMilliseconds));

            $prepublicationStartedAt = hrtime(true);
            $currentRun = DB::table('import_runs')->where('id', $runId)->where('organization_id', $organizationId)->first();
            $observedRows = (int) $currentRun->source_rows_count;
            DB::table('import_runs')->where('id', $runId)->where('organization_id', $organizationId)->update([
                'processing_state' => 'finalizing',
                'processed_source_rows' => $observedRows,
                'total_source_rows' => $observedRows,
                'finalizing_at' => now(),
                'updated_at' => now(),
            ]);

            $warningCount = (int) DB::table('import_issues')->where('organization_id', $organizationId)
                ->where('import_run_id', $runId)->where('severity', 'warning')->count();
            $this->metrics->addPhase('prepublication_checks_wall_ms', (hrtime(true) - $prepublicationStartedAt) / 1_000_000);
            $this->publication->publish($organizationId, $fileId, $runId, function () use (
                $inspection, $currentRun, $observedRows, $warningCount, $startedAt, $queueWaitMs,
                $options, $file, $content, $runId,
            ): array {
                $summary = $this->metrics->finish();
                $summary['query_measurement_enabled'] = (bool) config('import_benchmark.enabled');
                if (! config('import_benchmark.enabled')) {
                    $summary['sql_query_count'] = null;
                    $summary['sql_total_ms'] = null;
                }
                $summary['peak_memory_bytes'] = memory_get_peak_usage(true);
                $summary['elapsed_worker_ms'] = round((hrtime(true) - $startedAt) / 1_000_000, 3);
                $summary['queue_wait_ms'] = $queueWaitMs;
                $summary['server_upload_request_count'] = 1;
                $summary['upload_request_bytes'] = (int) ($options['upload_request_bytes'] ?? 0);
                $summary['file_bytes'] = (int) $file->size_bytes;
                $summary['file_sha256'] = (string) $content->sha256;
                $summary['correlation_id'] = (string) ($options['correlation_id'] ?? $runId);
                $summary['server_queue_to_publish_ms'] = $queueWaitMs === null
                    ? null
                    : round($queueWaitMs + (hrtime(true) - $startedAt) / 1_000_000, 3);
                $summary['sheets_total'] = count($inspection['sheets']);
                $summary['sheets_selected'] = count($inspection['selected_sheets']);
                $summary['format'] = $inspection['format'];
                $summary['source_rows'] = $observedRows;
                $summary['counts'] = [
                    'accepted' => (int) $currentRun->accepted_rows_count,
                    'duplicates' => (int) $currentRun->duplicate_rows_count,
                    'rejected' => (int) $currentRun->rejected_rows_count,
                    'issues' => (int) $currentRun->issues_count,
                ];
                $summary['warning_count'] = $warningCount;

                return $summary;
            });
        } catch (Throwable $exception) {
            throw $exception;
        } finally {
            if ($temporaryOriginal !== null && is_file($temporaryOriginal)) {
                @unlink($temporaryOriginal);
            }
        }
    }

    /** @param array<string,mixed> $inspection @param array<string,string> $overrides */
    private function registerSheets(string $organizationId, string $runId, object $run, array $inspection, array $overrides, string $fingerprint): void
    {
        DB::transaction(function () use ($organizationId, $runId, $run, $inspection, $overrides, $fingerprint): void {
            $lockedRun = DB::table('import_runs')->where('id', $runId)->where('organization_id', $organizationId)->lockForUpdate()->first();
            if (! $lockedRun || $lockedRun->processing_state === 'completed') {
                return;
            }
            if ($lockedRun->mapping_fingerprint !== null && ! hash_equals((string) $lockedRun->mapping_fingerprint, $fingerprint)) {
                throw new RuntimeException('The workbook mapping changed while this import was being resumed.');
            }
            DB::table('import_runs')->where('id', $runId)->where('organization_id', $organizationId)->update([
                'mapping_fingerprint' => $fingerprint,
                'updated_at' => now(),
            ]);

            $existing = DB::table('import_sheets')->where('import_run_id', $runId)->where('organization_id', $organizationId)
                ->get()->keyBy('source_sheet_index');
            foreach ($inspection['sheets'] as $sheet) {
                $headers = json_encode($sheet['headers'], JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE);
                $plan = $this->ingestion->compileColumnPlan(
                    $sheet['headers'], $overrides, (int) $run->mapping_version, $fingerprint,
                    (string) $sheet['date_system'], (string) ($run->report_timezone ?: config('app.timezone', 'UTC')),
                );
                $existingSheet = $existing->get((int) $sheet['index']);
                if ($existingSheet) {
                    if ((string) $existingSheet->source_sheet_name !== (string) $sheet['name']
                        || json_decode((string) $existingSheet->source_headers, true, 512, JSON_THROW_ON_ERROR) !== $sheet['headers']) {
                        throw new RuntimeException('A worksheet changed while a previous import chunk was being resumed.');
                    }
                    DB::table('import_sheets')->where('id', $existingSheet->id)->update([
                        'column_mapping_plan' => json_encode($plan, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE),
                        'updated_at' => now(),
                    ]);

                    continue;
                }

                DB::table('import_sheets')->insert([
                    'id' => (string) Str::ulid(),
                    'organization_id' => $organizationId,
                    'import_run_id' => $runId,
                    'source_sheet_index' => (int) $sheet['index'],
                    'source_sheet_name' => mb_substr((string) $sheet['name'], 0, 500),
                    'source_headers' => $headers,
                    'column_mapping_plan' => json_encode($plan, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE),
                    'header_row_number' => (int) $sheet['header_row_number'],
                    'data_rows_count' => 0,
                    'detected_columns_count' => count($sheet['headers']),
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
        }, 3);
    }

    private function mappingFingerprint(object $run, array $inspection, array $overrides, array $options): string
    {
        ksort($overrides);
        $sheets = array_map(static function (array $sheet): array {
            $normalized = [
                'index' => (int) $sheet['index'],
                'name' => mb_substr(trim((string) $sheet['name']), 0, 500),
                'header_row_number' => max(1, (int) $sheet['header_row_number']),
                'headers' => array_map(static fn ($header): string => mb_substr(trim((string) $header), 0, 500), $sheet['headers']),
            ];
            if ((string) $sheet['date_system'] === '1904') {
                $normalized['date_system'] = '1904';
            }

            return $normalized;
        }, $inspection['sheets']);

        return hash('sha256', json_encode([
            'report_date' => (string) $run->report_date,
            'manual_date' => (bool) ($options['manual_date'] ?? false),
            'sheets' => $sheets,
            'column_overrides' => $overrides,
        ], JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE));
    }

    private function findPublishedDuplicate(string $organizationId, string $fileId, string $runId, object $run, object $content, string $fingerprint): ?object
    {
        return DB::table('import_runs as old_runs')
            ->join('import_file_contents as old_content', 'old_content.import_run_id', '=', 'old_runs.id')
            ->where('old_runs.organization_id', $organizationId)->where('old_runs.import_file_id', $fileId)
            ->where('old_runs.id', '!=', $runId)->where('old_runs.status', 'published')
            ->where('old_runs.report_date', $run->report_date)->where('old_runs.mapping_fingerprint', $fingerprint)
            ->where('old_content.sha256', $content->sha256)
            ->orderByDesc('old_runs.revision')
            ->first(['old_runs.id', 'old_runs.revision', 'old_runs.source_rows_count', 'old_runs.accepted_rows_count',
                'old_runs.duplicate_rows_count', 'old_runs.rejected_rows_count', 'old_runs.issues_count']);
    }

    private function completeAsDuplicate(
        string $organizationId,
        string $runId,
        object $duplicate,
        array $inspection,
        int $startedAt,
        ?float $queueWaitMs,
        array $options,
        object $file,
        object $content,
    ): void {
        $warningCount = (int) DB::table('import_issues')->where('organization_id', $organizationId)
            ->where('import_run_id', $duplicate->id)->where('severity', 'warning')->count();
        $summary = $this->metrics->finish();
        $summary['query_measurement_enabled'] = (bool) config('import_benchmark.enabled');
        if (! config('import_benchmark.enabled')) {
            $summary['sql_query_count'] = null;
            $summary['sql_total_ms'] = null;
        }
        $summary['peak_memory_bytes'] = memory_get_peak_usage(true);
        $summary['elapsed_worker_ms'] = round((hrtime(true) - $startedAt) / 1_000_000, 3);
        $summary['queue_wait_ms'] = $queueWaitMs;
        $summary['server_upload_request_count'] = 1;
        $summary['upload_request_bytes'] = (int) ($options['upload_request_bytes'] ?? 0);
        $summary['file_bytes'] = (int) $file->size_bytes;
        $summary['file_sha256'] = (string) $content->sha256;
        $summary['correlation_id'] = (string) ($options['correlation_id'] ?? $runId);
        $summary['server_queue_to_publish_ms'] = $queueWaitMs === null
            ? null
            : round($queueWaitMs + (hrtime(true) - $startedAt) / 1_000_000, 3);
        $summary['sheets_total'] = count($inspection['sheets']);
        $summary['sheets_selected'] = count($inspection['selected_sheets']);
        $summary['format'] = $inspection['format'];
        $summary['duplicate_of_run_id'] = $duplicate->id;
        $summary['source_rows'] = (int) $duplicate->source_rows_count;
        $summary['counts'] = [
            'accepted' => (int) $duplicate->accepted_rows_count,
            'duplicates' => (int) $duplicate->duplicate_rows_count,
            'rejected' => (int) $duplicate->rejected_rows_count,
            'issues' => (int) $duplicate->issues_count,
        ];
        $summary['warning_count'] = $warningCount;

        DB::table('import_runs')->where('id', $runId)->where('organization_id', $organizationId)->update([
            'status' => 'duplicate',
            'processing_state' => 'completed',
            'source_rows_count' => (int) $duplicate->source_rows_count,
            'accepted_rows_count' => (int) $duplicate->accepted_rows_count,
            'duplicate_rows_count' => (int) $duplicate->duplicate_rows_count,
            'rejected_rows_count' => (int) $duplicate->rejected_rows_count,
            'issues_count' => (int) $duplicate->issues_count,
            'processed_source_rows' => (int) $duplicate->source_rows_count,
            'total_source_rows' => (int) $duplicate->source_rows_count,
            'processing_metrics' => json_encode($summary, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE),
            'processing_completed_at' => now(),
            'finished_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @return array<string,mixed> */
    private function decodeOptions(mixed $raw): array
    {
        if (is_array($raw)) {
            return $raw;
        }
        if (! is_string($raw) || $raw === '') {
            return [];
        }

        $options = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);

        return is_array($options) ? $options : [];
    }
}
