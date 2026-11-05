<?php

namespace App\Imports;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

class ImportIngestionService
{
    /** @var list<array{source_number:int,source_label:string,table:string,physical_column:string,provisional_type:string}> */
    private array $manifest;

    /** @var array<string,string> */
    private array $typeByTarget = [];

    /** @var array<string,array{table:string,column:string,type:string}> */
    private array $dashboardHubTargets = [];

    private static ?int $maxAllowedPacket = null;

    public function __construct()
    {
        $this->manifest = config('bosta_columns', []);
        if (count($this->manifest) !== 211) {
            throw new RuntimeException('The Bosta source manifest must define exactly 211 columns.');
        }

        foreach ($this->manifest as $definition) {
            $target = $definition['table'].'.'.$definition['physical_column'];
            $this->typeByTarget[$target] = $definition['provisional_type'];
            if ($definition['table'] === 'shipment_snapshot_routing') {
                $this->dashboardHubTargets[self::normalizeLabel($definition['source_label'])] = [
                    'table' => $definition['table'],
                    'column' => $definition['physical_column'],
                    'type' => $definition['provisional_type'],
                ];
            }
        }
    }

    /** @param list<string> $headers @param array<string,string> $overrides */
    public function compileColumnPlan(
        array $headers,
        array $overrides,
        int $mappingVersion,
        ?string $mappingFingerprint,
        string $dateSystem = '1900',
        string $reportTimezone = 'UTC',
    ): array {
        $headerIndexes = [];
        foreach ($headers as $index => $header) {
            $normalized = self::normalizeLabel($header);
            if ($normalized !== '' && ! array_key_exists($normalized, $headerIndexes)) {
                $headerIndexes[$normalized] = (int) $index;
            }
        }

        ksort($overrides);
        $overrideIndexes = $this->overrideIndexes($headerIndexes, $overrides);
        $columns = [];
        $hasTrackingColumn = false;
        foreach ($this->manifest as $definition) {
            $target = $definition['table'].'.'.$definition['physical_column'];
            $index = $overrideIndexes[$target] ?? $headerIndexes[self::normalizeLabel($definition['source_label'])] ?? null;
            if ($index === null) {
                continue;
            }

            $columns[] = [
                'source_index' => $index,
                'table' => $definition['table'],
                'column' => $definition['physical_column'],
                'source_label' => $definition['source_label'],
                'source_column_label' => $headers[$index] ?? $definition['source_label'],
                'type' => $definition['provisional_type'],
                'attempt_index' => $definition['table'] === 'delivery_attempts'
                    ? $this->attemptIndex($definition['source_label'])
                    : null,
            ];
            if ($target === 'shipment_snapshots.tracking_number') {
                $hasTrackingColumn = true;
            }
        }

        $dashboardHubsByLabel = [];
        foreach ($headers as $header) {
            $normalized = self::normalizeLabel($header);
            if (isset($this->dashboardHubTargets[$normalized])) {
                $dashboardHubsByLabel[(string) $header] = $this->dashboardHubTargets[$normalized];
            }
        }
        foreach ($this->manifest as $definition) {
            if ($definition['table'] === 'shipment_snapshot_routing') {
                $normalized = self::normalizeLabel($definition['source_label']);
                if (isset($this->dashboardHubTargets[$normalized])) {
                    $dashboardHubsByLabel[$definition['source_label']] = $this->dashboardHubTargets[$normalized];
                }
            }
        }

        return [
            'plan_version' => 1,
            'mapping_version' => $mappingVersion,
            'mapping_fingerprint' => $mappingFingerprint,
            'excel_date_system' => $dateSystem,
            'report_timezone' => $reportTimezone,
            'overrides_sha256' => hash('sha256', json_encode($overrides, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE)),
            'headers_sha256' => hash('sha256', json_encode($headers, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE)),
            'has_tracking_column' => $hasTrackingColumn,
            'columns' => $columns,
            'dashboard_fields' => [
                'tracking' => ['table' => 'shipment_snapshots', 'column' => 'tracking_number', 'type' => $this->typeByTarget['shipment_snapshots.tracking_number'] ?? 'text'],
                'items' => ['table' => 'shipment_snapshots', 'column' => 'items', 'type' => $this->typeByTarget['shipment_snapshots.items'] ?? 'text'],
                'business' => ['table' => 'shipment_snapshots', 'column' => 'business_name', 'type' => $this->typeByTarget['shipment_snapshots.business_name'] ?? 'text'],
                'shipType' => ['table' => 'shipment_snapshots', 'column' => 'shipment_type', 'type' => $this->typeByTarget['shipment_snapshots.shipment_type'] ?? 'text'],
                'packageType' => ['table' => 'shipment_snapshots', 'column' => 'package_type', 'type' => $this->typeByTarget['shipment_snapshots.package_type'] ?? 'text'],
                'packageSize' => ['table' => 'shipment_snapshots', 'column' => 'package_size', 'type' => $this->typeByTarget['shipment_snapshots.package_size'] ?? 'text'],
                'pickupCity' => ['table' => 'shipment_snapshot_parties', 'column' => 'pickup_city', 'type' => $this->typeByTarget['shipment_snapshot_parties.pickup_city'] ?? 'text'],
                'dropCity' => ['table' => 'shipment_snapshot_parties', 'column' => 'dropoff_city', 'type' => $this->typeByTarget['shipment_snapshot_parties.dropoff_city'] ?? 'text'],
                'pickupZone' => ['table' => 'shipment_snapshot_parties', 'column' => 'pickup_zone', 'type' => $this->typeByTarget['shipment_snapshot_parties.pickup_zone'] ?? 'text'],
                'assignedHub' => ['table' => 'shipment_snapshot_routing', 'column' => 'assigned_hub_name', 'type' => $this->typeByTarget['shipment_snapshot_routing.assigned_hub_name'] ?? 'text'],
            ],
            'dashboard_hubs' => $this->dashboardHubTargets,
            'dashboard_hubs_by_label' => $dashboardHubsByLabel,
        ];
    }

    /**
     * Persist one retry-safe source chunk and materialize normalized Bosta snapshots.
     *
     * @param  list<array{source_row_number:int,values:list<mixed>,dashboard_record?:array<string,mixed>}>  $rows
     * @param  array<string,string>  $columnOverrides
     * @return array{rows_processed:int,accepted:int,duplicates:int,rejected:int,issues:int,already_processed:bool}
     */
    public function ingestChunk(
        string $organizationId,
        string $fileId,
        string $runId,
        string $sheetId,
        int $chunkIndex,
        array $rows,
        array $columnOverrides = [],
    ): array {
        $payloadSha256 = $this->chunkPayloadFingerprint($rows, $columnOverrides);

        return DB::transaction(function () use (
            $organizationId,
            $fileId,
            $runId,
            $sheetId,
            $chunkIndex,
            $rows,
            $columnOverrides,
            $payloadSha256,
        ): array {
            $run = DB::table('import_runs')
                ->where('id', $runId)
                ->where('import_file_id', $fileId)
                ->where('organization_id', $organizationId)
                ->lockForUpdate()
                ->first();

            abort_unless($run && $run->status === 'importing', 409, 'This import run is not accepting rows.');

            $sheet = DB::table('import_sheets')
                ->where('id', $sheetId)
                ->where('import_run_id', $runId)
                ->where('organization_id', $organizationId)
                ->first();

            abort_unless($sheet, 404, 'Import sheet not found.');

            $existingChunk = DB::table('import_chunks')
                ->where('import_run_id', $runId)
                ->where('import_sheet_id', $sheetId)
                ->where('chunk_index', $chunkIndex)
                ->lockForUpdate()
                ->first();

            if ($existingChunk?->status === 'completed') {
                abort_unless(
                    is_string($existingChunk->payload_sha256)
                        && hash_equals($existingChunk->payload_sha256, $payloadSha256),
                    409,
                    'This import chunk key was already completed with different or unverifiable content.',
                );

                return [
                    'rows_processed' => (int) $existingChunk->rows_processed,
                    'accepted' => 0,
                    'duplicates' => 0,
                    'rejected' => 0,
                    'issues' => (int) $existingChunk->issues_count,
                    'already_processed' => true,
                ];
            }

            if ($existingChunk?->payload_sha256 !== null) {
                abort_unless(
                    hash_equals((string) $existingChunk->payload_sha256, $payloadSha256),
                    409,
                    'This import chunk key is already assigned to different content.',
                );
            }

            $sourceRowNumbers = array_map(static fn (array $row): int => (int) $row['source_row_number'], $rows);
            $rows = array_values(array_filter($rows, fn (array $row): bool => $this->hasValues($row['values'] ?? [])));
            if ($rows === []) {
                $now = now();
                $chunkId = $existingChunk?->id ?? (string) Str::ulid();
                $emptyChunkData = [
                    'status' => 'completed',
                    'payload_sha256' => $payloadSha256,
                    'attempts' => (int) ($existingChunk?->attempts ?? 0) + 1,
                    'first_source_row' => $sourceRowNumbers === [] ? 0 : min($sourceRowNumbers),
                    'last_source_row' => $sourceRowNumbers === [] ? 0 : max($sourceRowNumbers),
                    'rows_processed' => 0,
                    'issues_count' => 0,
                    'started_at' => $now,
                    'finished_at' => $now,
                    'updated_at' => $now,
                ];
                if ($existingChunk) {
                    DB::table('import_chunks')->where('id', $chunkId)->update($emptyChunkData);
                } else {
                    DB::table('import_chunks')->insert(array_merge($emptyChunkData, [
                        'id' => $chunkId,
                        'organization_id' => $organizationId,
                        'import_run_id' => $runId,
                        'import_sheet_id' => $sheetId,
                        'chunk_index' => $chunkIndex,
                        'created_at' => $now,
                    ]));
                }

                return [
                    'rows_processed' => 0,
                    'accepted' => 0,
                    'duplicates' => 0,
                    'rejected' => 0,
                    'issues' => 0,
                    'already_processed' => false,
                ];
            }

            $now = now();
            $chunkId = $existingChunk?->id ?? (string) Str::ulid();
            $chunkData = [
                'status' => 'processing',
                'payload_sha256' => $payloadSha256,
                'attempts' => (int) ($existingChunk?->attempts ?? 0) + 1,
                'first_source_row' => min(array_column($rows, 'source_row_number')),
                'last_source_row' => max(array_column($rows, 'source_row_number')),
                'started_at' => $now,
                'updated_at' => $now,
            ];

            if ($existingChunk) {
                DB::table('import_chunks')->where('id', $chunkId)->update($chunkData);
            } else {
                DB::table('import_chunks')->insert(array_merge($chunkData, [
                    'id' => $chunkId,
                    'organization_id' => $organizationId,
                    'import_run_id' => $runId,
                    'import_sheet_id' => $sheetId,
                    'chunk_index' => $chunkIndex,
                    'rows_processed' => 0,
                    'issues_count' => 0,
                    'created_at' => $now,
                ]));
            }

            $headers = is_string($sheet->source_headers)
                ? (json_decode($sheet->source_headers, true, 512, JSON_THROW_ON_ERROR) ?: [])
                : (array) $sheet->source_headers;
            $mappingPlan = $this->columnPlanForSheet($sheet, $run, $headers, $columnOverrides);
            $hasTrackingColumn = (bool) $mappingPlan['has_tracking_column'];

            $sourceRows = [];
            $issues = [];
            $mappedRows = [];
            $trackingHashes = [];
            $accepted = 0;
            $duplicates = 0;
            $rejected = 0;
            $issueCount = 0;
            $conversionTimings = [
                'date_conversion_wall_ms' => 0.0,
                'financial_conversion_wall_ms' => 0.0,
                'warning_generation_wall_ms' => 0.0,
            ];

            $rowProcessingStartedAt = hrtime(true);
            foreach ($rows as $row) {
                $sourceRowNumber = (int) $row['source_row_number'];
                $values = array_values($row['values'] ?? []);
                $sourceRowId = (string) Str::ulid();
                [$mapped, $attemptValues, $rowIssues] = $this->mapValues($mappingPlan, $values, $row['dashboard_record'] ?? null, $conversionTimings);

                $trackingColumnValue = $mapped['shipment_snapshots']['tracking_number'] ?? null;
                $tracking = $this->cleanString($trackingColumnValue);
                if ($tracking === null && ! $hasTrackingColumn) {
                    $tracking = 'ROW-'.$fileId.'-'.$sheet->source_sheet_index.'-'.$sourceRowNumber;
                    $mapped['shipment_snapshots']['tracking_number'] = $tracking;
                }

                $rowStatus = 'accepted';
                if ($tracking === null) {
                    $rowStatus = 'rejected';
                    $rejected++;
                    $rowIssues[] = [
                        'source_column_number' => null,
                        'source_column_label' => null,
                        'issue_code' => 'missing_tracking_number',
                        'severity' => 'error',
                        'safe_message' => 'The row has no usable tracking number and was retained for review.',
                    ];
                }

                $timestamp = now();
                $sourceRows[] = [
                    'id' => $sourceRowId,
                    'organization_id' => $organizationId,
                    'import_run_id' => $runId,
                    'import_sheet_id' => $sheetId,
                    'import_chunk_id' => $chunkId,
                    'source_row_number' => $sourceRowNumber,
                    'source_values' => json_encode($values, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE),
                    'status' => $rowStatus,
                    'issues_count' => count($rowIssues),
                    'processed_at' => $timestamp,
                    'created_at' => $timestamp,
                    'updated_at' => $timestamp,
                ];

                if ($rowStatus !== 'accepted') {
                    foreach ($rowIssues as $issue) {
                        $issues[] = $this->issueRow($organizationId, $runId, $sourceRowId, (int) $sheet->source_sheet_index, $sourceRowNumber, $issue, $timestamp);
                    }
                    $issueCount += count($rowIssues);

                    continue;
                }

                $trackingHash = hash('sha256', $organizationId."\0".mb_strtolower($tracking), true);
                $trackingKey = bin2hex($trackingHash);
                $trackingHashes[$trackingKey] = $trackingHash;
                $mappedRows[] = [
                    'source_index' => array_key_last($sourceRows),
                    'source_row_id' => $sourceRowId,
                    'source_row_number' => $sourceRowNumber,
                    'tracking_key' => $trackingKey,
                    'mapped' => $mapped,
                    'attempts' => $attemptValues,
                    'issues' => $rowIssues,
                    'timestamp' => $timestamp,
                ];
            }

            app(ImportBenchmarkMetrics::class)->addPhase(
                'row_mapping_and_validation_wall_ms',
                (hrtime(true) - $rowProcessingStartedAt) / 1_000_000,
            );
            foreach ($conversionTimings as $phase => $milliseconds) {
                app(ImportBenchmarkMetrics::class)->addPhase($phase, $milliseconds);
            }

            $identityResolutionStartedAt = hrtime(true);
            $shipmentIdByTrackingKey = $this->resolveShipmentIds($organizationId, $trackingHashes, $now);
            $existingShipmentIdsInRun = $this->existingShipmentIdsInRun(
                $organizationId,
                $runId,
                array_values($shipmentIdByTrackingKey),
            );
            app(ImportBenchmarkMetrics::class)->addPhase(
                'shipment_identity_resolution_wall_ms',
                (hrtime(true) - $identityResolutionStartedAt) / 1_000_000,
            );

            $seenTrackingKeys = [];
            $rowsToAccept = [];
            $businessCandidates = [];
            $hubCandidates = [];
            foreach ($mappedRows as $mappedRow) {
                $trackingKey = $mappedRow['tracking_key'];
                $shipmentId = $shipmentIdByTrackingKey[$trackingKey];
                $isDuplicate = isset($seenTrackingKeys[$trackingKey]) || isset($existingShipmentIdsInRun[$shipmentId]);
                $seenTrackingKeys[$trackingKey] = true;

                if ($isDuplicate) {
                    $sourceRows[$mappedRow['source_index']]['status'] = 'duplicate';
                    $duplicates++;
                    foreach ($mappedRow['issues'] as $issue) {
                        $issues[] = $this->issueRow($organizationId, $runId, $mappedRow['source_row_id'], (int) $sheet->source_sheet_index, $mappedRow['source_row_number'], $issue, $mappedRow['timestamp']);
                    }
                    $issueCount += count($mappedRow['issues']);

                    continue;
                }

                $mappedRow['business'] = $this->businessDescriptor(
                    $organizationId,
                    $mappedRow['mapped']['shipment_snapshots']['business_name'] ?? null,
                    $mappedRow['mapped']['shipment_snapshots']['business_external_id'] ?? null,
                );
                if ($mappedRow['business'] !== null) {
                    $businessCandidates[$mappedRow['business']['key']] ??= $mappedRow['business'];
                }

                $mappedRow['hub_keys'] = [];
                foreach ([
                    'current_hub_name' => 'current_hub_id',
                    'assigned_hub_name' => 'assigned_hub_id',
                    'auto_assigned_hub_name' => 'auto_assigned_hub_id',
                    'first_hub_name' => 'first_hub_id',
                    'last_dispatch_hub_name' => 'last_dispatch_hub_id',
                    'loss_liable_hub_name' => 'loss_liable_hub_id',
                ] as $nameColumn => $idColumn) {
                    $descriptor = $this->hubDescriptor($organizationId, $mappedRow['mapped']['shipment_snapshot_routing'][$nameColumn] ?? null);
                    $mappedRow['hub_keys'][$idColumn] = $descriptor['key'] ?? null;
                    if ($descriptor !== null) {
                        $hubCandidates[$descriptor['key']] ??= $descriptor;
                    }
                }

                $rowsToAccept[] = $mappedRow;
            }

            $dimensionResolutionStartedAt = hrtime(true);
            $businessIds = $this->resolveBusinessIds($organizationId, $businessCandidates, $now);
            $hubIdsByKey = $this->resolveHubIds($organizationId, $hubCandidates, $now);
            app(ImportBenchmarkMetrics::class)->addPhase(
                'business_and_hub_resolution_wall_ms',
                (hrtime(true) - $dimensionResolutionStartedAt) / 1_000_000,
            );

            $snapshots = [];
            $parties = [];
            $routing = [];
            $financials = [];
            $services = [];
            $attempts = [];
            foreach ($rowsToAccept as $mappedRow) {
                $timestamp = $mappedRow['timestamp'];
                $mapped = $mappedRow['mapped'];
                $snapshotId = (string) Str::ulid();
                $hubIds = [];
                foreach ($mappedRow['hub_keys'] as $column => $key) {
                    $hubIds[$column] = $key === null ? null : ($hubIdsByKey[$key] ?? null);
                }

                $snapshots[] = array_merge($mapped['shipment_snapshots'] ?? [], [
                    'id' => $snapshotId,
                    'organization_id' => $organizationId,
                    'shipment_id' => $shipmentIdByTrackingKey[$mappedRow['tracking_key']],
                    'import_run_id' => $runId,
                    'import_source_row_id' => $mappedRow['source_row_id'],
                    'business_id' => $mappedRow['business'] === null ? null : ($businessIds[$mappedRow['business']['key']] ?? null),
                    'delivery_state_fingerprint' => $this->fingerprint($mapped['shipment_snapshots']['delivery_state'] ?? null),
                    'created_at' => $timestamp,
                    'updated_at' => $timestamp,
                ], $hubIds);

                $parties[] = $this->relatedRow('shipment_snapshot_parties', $mapped, $organizationId, $snapshotId, $timestamp);
                $routing[] = $this->relatedRow('shipment_snapshot_routing', $mapped, $organizationId, $snapshotId, $timestamp);
                $financials[] = $this->relatedRow('shipment_snapshot_financials', $mapped, $organizationId, $snapshotId, $timestamp);
                $services[] = $this->relatedRow('shipment_snapshot_service', $mapped, $organizationId, $snapshotId, $timestamp);
                foreach ($mappedRow['attempts'] as $attemptIndex => $attemptValue) {
                    if ($this->hasValues($attemptValue)) {
                        $attempts[] = array_merge($attemptValue, [
                            'id' => (string) Str::ulid(),
                            'organization_id' => $organizationId,
                            'shipment_snapshot_id' => $snapshotId,
                            'attempt_index' => $attemptIndex,
                            'created_at' => $timestamp,
                            'updated_at' => $timestamp,
                        ]);
                    }
                }

                foreach ($mappedRow['issues'] as $issue) {
                    $issues[] = $this->issueRow($organizationId, $runId, $mappedRow['source_row_id'], (int) $sheet->source_sheet_index, $mappedRow['source_row_number'], $issue, $timestamp);
                }
                $issueCount += count($mappedRow['issues']);
                $accepted++;
            }

            $batchPersistenceStartedAt = hrtime(true);
            $this->insertInBatches('import_source_rows', $sourceRows);
            $this->insertInBatches('shipment_snapshots', $snapshots);
            $this->insertInBatches('shipment_snapshot_parties', array_values(array_filter($parties)));
            $this->insertInBatches('shipment_snapshot_routing', array_values(array_filter($routing)));
            $this->insertInBatches('shipment_snapshot_financials', array_values(array_filter($financials)));
            $this->insertInBatches('shipment_snapshot_service', array_values(array_filter($services)));
            $this->insertInBatches('delivery_attempts', $attempts);
            $this->insertInBatches('import_issues', $issues);
            app(ImportBenchmarkMetrics::class)->addPhase(
                'batch_persistence_wall_ms',
                (hrtime(true) - $batchPersistenceStartedAt) / 1_000_000,
            );

            DB::table('import_chunks')->where('id', $chunkId)->update([
                'status' => 'completed',
                'rows_processed' => count($sourceRows),
                'issues_count' => $issueCount,
                'finished_at' => now(),
                'updated_at' => now(),
            ]);
            DB::table('import_sheets')->where('id', $sheetId)->increment('data_rows_count', count($sourceRows));
            DB::table('import_runs')->where('id', $runId)->update([
                'source_rows_count' => DB::raw('source_rows_count + '.count($sourceRows)),
                'accepted_rows_count' => DB::raw('accepted_rows_count + '.$accepted),
                'duplicate_rows_count' => DB::raw('duplicate_rows_count + '.$duplicates),
                'rejected_rows_count' => DB::raw('rejected_rows_count + '.$rejected),
                'issues_count' => DB::raw('issues_count + '.$issueCount),
                'updated_at' => now(),
            ]);

            return [
                'rows_processed' => count($sourceRows),
                'accepted' => $accepted,
                'duplicates' => $duplicates,
                'rejected' => $rejected,
                'issues' => $issueCount,
                'already_processed' => false,
            ];
        }, 3);
    }

    private function columnPlanForSheet(object $sheet, object $run, array $headers, array $overrides): array
    {
        $plan = $sheet->column_mapping_plan;
        if (is_string($plan) && $plan !== '') {
            $plan = json_decode($plan, true, 512, JSON_THROW_ON_ERROR);
        }

        $expectedHeaders = hash('sha256', json_encode($headers, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE));
        ksort($overrides);
        $expectedOverrides = hash('sha256', json_encode($overrides, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE));
        if ($plan === null) {
            $planStartedAt = config('import_benchmark.enabled') ? hrtime(true) : 0;
            $plan = $this->compileColumnPlan(
                $headers,
                $overrides,
                (int) $run->mapping_version,
                $run->mapping_fingerprint === null ? null : (string) $run->mapping_fingerprint,
                '1900',
                (string) ($run->report_timezone ?: config('app.timezone', 'UTC')),
            );
            if ($planStartedAt > 0) {
                app(ImportBenchmarkMetrics::class)->addPhase(
                    'column_plan_build_wall_ms',
                    (hrtime(true) - $planStartedAt) / 1_000_000,
                );
            }
            DB::table('import_sheets')->where('id', $sheet->id)->update([
                'column_mapping_plan' => json_encode($plan, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE),
            ]);
        }

        abort_unless(
            is_array($plan)
                && ($plan['plan_version'] ?? null) === 1
                && ($plan['mapping_version'] ?? null) === (int) $run->mapping_version
                && ($plan['mapping_fingerprint'] ?? null) === ($run->mapping_fingerprint === null ? null : (string) $run->mapping_fingerprint)
                && hash_equals((string) ($plan['overrides_sha256'] ?? ''), $expectedOverrides)
                && hash_equals((string) ($plan['headers_sha256'] ?? ''), $expectedHeaders)
                && is_array($plan['columns'] ?? null),
            409,
            'The stored sheet mapping plan does not match this import revision.',
        );

        return $plan;
    }

    /** @param list<mixed> $values */
    private function mapValues(array $plan, array $values, ?array $dashboardRecord, array &$conversionTimings): array
    {
        $mapped = [];
        $attempts = [];
        $issues = [];
        $dateSystem = (string) ($plan['excel_date_system'] ?? '1900');
        $reportTimezone = (string) ($plan['report_timezone'] ?? config('app.timezone', 'UTC'));
        foreach ($plan['columns'] as $column) {
            $index = (int) $column['source_index'];
            $raw = $values[$index] ?? null;
            [$value, $valid] = $this->typedValue($raw, (string) $column['type'], $conversionTimings, $dateSystem, $reportTimezone);
            if (! $valid) {
                $warningStartedAt = config('import_benchmark.enabled') ? hrtime(true) : 0;
                $issues[] = [
                    'source_column_number' => $index + 1,
                    'source_column_label' => (string) $column['source_column_label'],
                    'issue_code' => 'invalid_typed_value',
                    'severity' => 'warning',
                    'safe_message' => 'A value could not be represented in the provisional database type and was retained in the raw row.',
                ];
                if ($warningStartedAt > 0) {
                    $conversionTimings['warning_generation_wall_ms'] += (hrtime(true) - $warningStartedAt) / 1_000_000;
                }
            }

            if ($column['table'] === 'delivery_attempts') {
                $attempts[(int) $column['attempt_index']][(string) $column['column']] = $value;
            } else {
                $mapped[(string) $column['table']][(string) $column['column']] = $value;
            }
        }

        if ($dashboardRecord !== null) {
            foreach ($plan['dashboard_fields'] as $key => $field) {
                if (! array_key_exists($key, $dashboardRecord) || $dashboardRecord[$key] === null) {
                    continue;
                }

                [$value] = $this->typedValue($dashboardRecord[$key], (string) $field['type'], $conversionTimings, $dateSystem, $reportTimezone);
                $mapped[$field['table']][$field['column']] = $value;
            }

            foreach ((array) ($dashboardRecord['hubs'] ?? []) as $label => $hubName) {
                if ($hubName === null) {
                    continue;
                }
                $target = $plan['dashboard_hubs_by_label'][(string) $label] ?? null;
                if ($target === null) {
                    continue;
                }

                [$value] = $this->typedValue($hubName, (string) $target['type'], $conversionTimings, $dateSystem, $reportTimezone);
                $mapped[$target['table']][$target['column']] = $value;
            }
        }

        return [$mapped, $attempts, $issues];
    }

    private function overrideIndexes(array $headerIndexes, array $overrides): array
    {
        $targets = [
            'tracking' => 'shipment_snapshots.tracking_number',
            'items' => 'shipment_snapshots.items',
            'business' => 'shipment_snapshots.business_name',
            'shipType' => 'shipment_snapshots.shipment_type',
            'packageType' => 'shipment_snapshots.package_type',
            'packageSize' => 'shipment_snapshots.package_size',
            'pickupCity' => 'shipment_snapshot_parties.pickup_city',
            'dropCity' => 'shipment_snapshot_parties.dropoff_city',
            'pickupZone' => 'shipment_snapshot_parties.pickup_zone',
        ];
        $indexes = [];
        foreach ($targets as $role => $target) {
            $label = $overrides[$role] ?? null;
            $normalized = $label === null ? '' : self::normalizeLabel((string) $label);
            if ($normalized !== '' && isset($headerIndexes[$normalized])) {
                $indexes[$target] = $headerIndexes[$normalized];
            }
        }

        return $indexes;
    }

    private function typedValue(
        mixed $raw,
        string $type,
        array &$timings,
        string $dateSystem = '1900',
        string $reportTimezone = 'UTC',
    ): array {
        if ($raw === null || $raw === '') {
            return [null, true];
        }

        $phase = $type === 'dateTime'
            ? 'date_conversion_wall_ms'
            : (str_starts_with($type, 'decimal(') ? 'financial_conversion_wall_ms' : null);
        $startedAt = $phase !== null && config('import_benchmark.enabled') ? hrtime(true) : 0;

        try {
            return $this->convertTypedValue($raw, $type, $dateSystem, $reportTimezone);
        } finally {
            if ($phase !== null && $startedAt > 0) {
                $timings[$phase] = ($timings[$phase] ?? 0.0) + (hrtime(true) - $startedAt) / 1_000_000;
            }
        }
    }

    private function convertTypedValue(mixed $raw, string $type, string $dateSystem, string $reportTimezone): array
    {
        if ($type === 'boolean') {
            if (is_bool($raw)) {
                return [$raw, true];
            }
            $value = mb_strtolower(trim((string) $raw));
            if (in_array($value, ['1', 'true', 'yes', 'y'], true)) {
                return [true, true];
            }
            if (in_array($value, ['0', 'false', 'no', 'n'], true)) {
                return [false, true];
            }

            return [null, false];
        }

        if ($type === 'dateTime') {
            try {
                $minimumExcelSerial = $dateSystem === '1904' ? 0 : 20000;
                if (is_numeric($raw) && (float) $raw >= $minimumExcelSerial && (float) $raw <= 80000) {
                    $seconds = $dateSystem === '1904'
                        ? ((float) $raw - 24107) * 86400
                        : ((float) $raw - 25569) * 86400;
                    $wholeSeconds = (int) floor($seconds);
                    $microseconds = (int) round(($seconds - $wholeSeconds) * 1_000_000);
                    if ($microseconds >= 1_000_000) {
                        $wholeSeconds++;
                        $microseconds = 0;
                    }
                    $wallClock = Carbon::createFromTimestampUTC($wholeSeconds)->format('Y-m-d H:i:s')
                        .'.'.str_pad((string) $microseconds, 6, '0', STR_PAD_LEFT);
                    $date = Carbon::createFromFormat('Y-m-d H:i:s.u', $wallClock, $reportTimezone);
                    if (! $date) {
                        return [null, false];
                    }

                    return [$date->setTimezone('UTC')->format('Y-m-d H:i:s.u'), true];
                }

                $value = trim((string) $raw);
                $knownIsoFormat = preg_match('/\A\d{4}-\d{2}-\d{2}\z/', $value) === 1
                    || preg_match('/\A\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})?\z/i', $value) === 1
                    || preg_match('/\A\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})?\z/i', $value) === 1;
                $timezone = new \DateTimeZone($reportTimezone);
                $date = $knownIsoFormat
                    ? new \DateTimeImmutable($value, $timezone)
                    : Carbon::parse($value, $timezone)->toDateTimeImmutable();

                return [$date->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s.u'), true];
            } catch (\Throwable) {
                return [null, false];
            }
        }

        if ($type === 'unsignedInteger') {
            $value = trim((string) $raw);
            if (preg_match('/\A\d+\z/', $value) !== 1) {
                return [null, false];
            }

            return [$value, true];
        }

        if (str_starts_with($type, 'decimal(')) {
            $value = trim(str_replace(',', '', (string) $raw));
            if (preg_match('/\A-?\d+(?:\.\d+)?\z/', $value) !== 1) {
                return [null, false];
            }

            return [$value, true];
        }

        if (is_scalar($raw) || $raw instanceof \Stringable) {
            return [(string) $raw, true];
        }

        return [json_encode($raw, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE), true];
    }

    private function attemptIndex(string $label): int
    {
        if (preg_match('/\A(?:Attempt|Exception)(?:\s+(\d+))?\s+/i', trim($label), $match) !== 1) {
            return 0;
        }

        return min(8, (int) ($match[1] ?? 0));
    }

    private function businessDescriptor(string $organizationId, mixed $name, mixed $externalId): ?array
    {
        $canonical = $this->cleanString($name) ?? $this->cleanString($externalId);
        if ($canonical === null) {
            return null;
        }

        $external = $this->cleanString($externalId);
        $nameHash = hash('sha256', $organizationId."\0".mb_strtolower($canonical), true);
        $externalHash = $external === null ? null : hash('sha256', $organizationId."\0".mb_strtolower($external), true);

        return [
            'key' => ($externalHash === null ? 'name:' : 'external:').bin2hex($externalHash ?? $nameHash),
            'name_hash' => $nameHash,
            'external_hash' => $externalHash,
            'canonical_name' => $canonical,
            'external_id' => $external,
        ];
    }

    private function hubDescriptor(string $organizationId, mixed $name): ?array
    {
        $canonical = $this->cleanString($name);
        if ($canonical === null) {
            return null;
        }

        $hash = hash('sha256', $organizationId."\0".mb_strtolower($canonical), true);

        return ['key' => bin2hex($hash), 'hash' => $hash, 'canonical_name' => $canonical];
    }

    /** @param array<string,string> $trackingHashes @return array<string,string> */
    private function resolveShipmentIds(string $organizationId, array $trackingHashes, mixed $now): array
    {
        if ($trackingHashes === []) {
            return [];
        }

        $ids = $this->lookupBinaryIdentityIds('shipments', 'tracking_fingerprint', $organizationId, array_values($trackingHashes));
        $missing = [];
        foreach ($trackingHashes as $key => $hash) {
            if (! isset($ids[$key])) {
                $missing[] = [
                    'id' => (string) Str::ulid(),
                    'organization_id' => $organizationId,
                    'tracking_fingerprint' => $hash,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }
        }

        if ($missing !== []) {
            $this->insertOnExpectedDuplicateKeyNoop('shipments', $missing);
            $resolved = $this->lookupBinaryIdentityIds(
                'shipments',
                'tracking_fingerprint',
                $organizationId,
                array_column($missing, 'tracking_fingerprint'),
                true,
            );
            $ids += $resolved;
        }

        foreach ($trackingHashes as $key => $_hash) {
            if (! isset($ids[$key])) {
                throw new RuntimeException('A shipment identity could not be resolved after its unique-key insert.');
            }
        }

        return $ids;
    }

    /** @param list<string> $hashes @return array<string,string> */
    private function lookupBinaryIdentityIds(string $table, string $column, string $organizationId, array $hashes, bool $currentRead = false): array
    {
        $ids = [];
        foreach (array_chunk(array_values(array_unique($hashes, SORT_REGULAR)), $this->lookupBatchSize()) as $batch) {
            $query = DB::table($table)->where('organization_id', $organizationId)->whereIn($column, $batch);
            if ($currentRead) {
                $query->lockForUpdate();
            }
            $rows = $query->get(['id', $column]);
            foreach ($rows as $row) {
                $ids[bin2hex((string) $row->{$column})] = (string) $row->id;
            }
        }

        return $ids;
    }

    /** @param list<string> $shipmentIds @return array<string,true> */
    private function existingShipmentIdsInRun(string $organizationId, string $runId, array $shipmentIds): array
    {
        $existing = [];
        foreach (array_chunk(array_values(array_unique($shipmentIds)), $this->lookupBatchSize()) as $batch) {
            foreach (DB::table('shipment_snapshots')->where('organization_id', $organizationId)
                ->where('import_run_id', $runId)->whereIn('shipment_id', $batch)->pluck('shipment_id') as $shipmentId) {
                $existing[(string) $shipmentId] = true;
            }
        }

        return $existing;
    }

    /** @param array<string,array<string,mixed>> $candidates @return array<string,string|null> */
    private function resolveBusinessIds(string $organizationId, array $candidates, mixed $now): array
    {
        if ($candidates === []) {
            return [];
        }

        $ids = $this->lookupBusinessIds($organizationId, $candidates);
        $missing = [];
        $missingCandidates = [];
        foreach ($candidates as $key => $candidate) {
            if (! array_key_exists($key, $ids)) {
                $missingCandidates[$key] = $candidate;
                $missing[] = [
                    'id' => (string) Str::ulid(),
                    'organization_id' => $organizationId,
                    'name' => $candidate['canonical_name'],
                    'canonical_name_hash' => $candidate['name_hash'],
                    'external_id' => $candidate['external_id'],
                    'external_id_hash' => $candidate['external_hash'],
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }
        }

        if ($missing !== []) {
            $this->insertOnExpectedDuplicateKeyNoop('businesses', $missing);
            $resolved = $this->lookupBusinessIds($organizationId, $missingCandidates, true);
            $ids += $resolved;
        }

        return $ids;
    }

    /** @param array<string,array<string,mixed>> $candidates @return array<string,string> */
    private function lookupBusinessIds(string $organizationId, array $candidates, bool $currentRead = false): array
    {
        $resolved = [];
        foreach (array_chunk($candidates, $this->lookupBatchSize(), true) as $batch) {
            $externalHashes = [];
            $nameHashes = [];
            foreach ($batch as $candidate) {
                if ($candidate['external_hash'] !== null) {
                    $externalHashes[] = $candidate['external_hash'];
                }
                $nameHashes[] = $candidate['name_hash'];
            }
            $externalHashes = array_values(array_unique($externalHashes, SORT_REGULAR));
            $nameHashes = array_values(array_unique($nameHashes, SORT_REGULAR));
            if ($externalHashes === [] && $nameHashes === []) {
                continue;
            }

            $query = DB::table('businesses')->where('organization_id', $organizationId)->where(function ($query) use ($externalHashes, $nameHashes): void {
                if ($externalHashes !== []) {
                    $query->whereIn('external_id_hash', $externalHashes);
                }
                if ($nameHashes !== []) {
                    ($externalHashes === [] ? $query : $query->orWhereIn('canonical_name_hash', $nameHashes));
                }
            });
            if ($currentRead) {
                $query->lockForUpdate();
            }
            $rows = $query->get(['id', 'external_id_hash', 'canonical_name_hash']);

            $byExternalHash = [];
            $byNameHash = [];
            foreach ($rows as $row) {
                if ($row->external_id_hash !== null) {
                    $byExternalHash[bin2hex((string) $row->external_id_hash)] = (string) $row->id;
                }
                if ($row->canonical_name_hash !== null) {
                    $byNameHash[bin2hex((string) $row->canonical_name_hash)] = (string) $row->id;
                }
            }
            foreach ($batch as $key => $candidate) {
                $id = $candidate['external_hash'] === null
                    ? ($byNameHash[bin2hex($candidate['name_hash'])] ?? null)
                    : ($byExternalHash[bin2hex($candidate['external_hash'])] ?? null);
                if ($id !== null) {
                    $resolved[$key] = $id;
                }
            }
        }

        return $resolved;
    }

    /** @param array<string,array<string,mixed>> $candidates @return array<string,string> */
    private function resolveHubIds(string $organizationId, array $candidates, mixed $now): array
    {
        if ($candidates === []) {
            return [];
        }

        $ids = $this->lookupBinaryIdentityIds('hubs', 'canonical_name_hash', $organizationId, array_column($candidates, 'hash'));
        $missing = [];
        foreach ($candidates as $key => $candidate) {
            if (! isset($ids[$key])) {
                $missing[] = [
                    'id' => (string) Str::ulid(),
                    'organization_id' => $organizationId,
                    'canonical_name' => $candidate['canonical_name'],
                    'canonical_name_hash' => $candidate['hash'],
                    'external_code' => null,
                    'external_code_hash' => null,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }
        }

        if ($missing !== []) {
            $this->insertOnExpectedDuplicateKeyNoop('hubs', $missing);
            $resolved = $this->lookupBinaryIdentityIds('hubs', 'canonical_name_hash', $organizationId, array_column($missing, 'canonical_name_hash'), true);
            $ids += $resolved;

            $aliases = [];
            foreach ($missing as $hub) {
                $key = bin2hex($hub['canonical_name_hash']);
                $hubId = $ids[$key] ?? null;
                if ($hubId === null) {
                    throw new RuntimeException('A hub identity could not be resolved after its unique-key insert.');
                }
                $aliases[] = [
                    'organization_id' => $organizationId,
                    'hub_id' => $hubId,
                    'source_name' => $hub['canonical_name'],
                    'source_name_hash' => $hub['canonical_name_hash'],
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }
            $this->insertOnExpectedDuplicateKeyNoop('hub_aliases', $aliases, 'id');
        }

        return $ids;
    }

    private function lookupBatchSize(): int
    {
        return max(1, min(400, (int) config('import_ingestion.lookup_batch_keys', 400)));
    }

    /** @param list<array<string,mixed>> $rows */
    private function insertInBatches(string $table, array $rows): void
    {
        $this->writeAdaptiveBatches($table, $rows, false);
    }

    /** @param list<array<string,mixed>> $rows */
    private function insertOnExpectedDuplicateKeyNoop(string $table, array $rows, string $noOpColumn = 'id'): void
    {
        abort_unless(in_array($table, ['shipments', 'businesses', 'hubs', 'hub_aliases'], true), 500);
        abort_unless($noOpColumn === 'id', 500);
        $this->writeAdaptiveBatches($table, $rows, true);
    }

    /** @param list<array<string,mixed>> $rows */
    private function writeAdaptiveBatches(string $table, array $rows, bool $noOpOnUniqueConflict): void
    {
        if ($rows === []) {
            return;
        }

        $limits = $this->batchLimits();
        $batch = [];
        $signature = null;
        $batchBytes = 0;
        $columns = [];
        foreach ($rows as $row) {
            $rowColumns = array_keys($row);
            $rowSignature = implode("\0", $rowColumns);
            $rowBytes = $this->estimateInsertRowBytes($row);
            $rowBindings = count($rowColumns);
            $wouldExceed = $batch !== [] && (
                $rowSignature !== $signature
                || count($batch) >= $limits['rows']
                || ((count($batch) + 1) * count($columns)) > $limits['bindings']
                || $batchBytes + $rowBytes > $limits['batch_bytes']
            );
            if ($wouldExceed) {
                $this->executeInsertBatch($table, $columns, $batch, $noOpOnUniqueConflict);
                $batch = [];
                $batchBytes = 0;
            }

            if ($batch === []) {
                $signature = $rowSignature;
                $columns = $rowColumns;
            }
            if ($rowBindings > $limits['bindings'] || $rowBytes > $limits['single_row_bytes']) {
                throw new RuntimeException('An individual source row exceeds the configured safe MariaDB batch budget.');
            }
            $batch[] = $row;
            $batchBytes += $rowBytes;
        }

        if ($batch !== []) {
            $this->executeInsertBatch($table, $columns, $batch, $noOpOnUniqueConflict);
        }
    }

    /** @param list<string> $columns @param list<array<string,mixed>> $rows */
    private function executeInsertBatch(string $table, array $columns, array $rows, bool $noOpOnUniqueConflict): void
    {
        if (! $noOpOnUniqueConflict) {
            DB::table($table)->insert($rows);

            return;
        }

        $grammar = DB::connection()->getQueryGrammar();
        $columnSql = implode(', ', array_map(fn (string $column): string => $grammar->wrap($column), $columns));
        $rowPlaceholder = '('.implode(', ', array_fill(0, count($columns), '?')).')';
        $valuesSql = implode(', ', array_fill(0, count($rows), $rowPlaceholder));
        $bindings = [];
        foreach ($rows as $row) {
            foreach ($columns as $column) {
                $bindings[] = $row[$column];
            }
        }
        $idColumn = $grammar->wrap('id');
        $sql = 'INSERT INTO '.$grammar->wrapTable($table).' ('.$columnSql.') VALUES '.$valuesSql
            .' ON DUPLICATE KEY UPDATE '.$idColumn.' = '.$idColumn;

        DB::insert($sql, $bindings);
    }

    /** @param array<string,mixed> $row */
    private function estimateInsertRowBytes(array $row): int
    {
        $bytes = 32 + (count($row) * 4);
        foreach ($row as $value) {
            if ($value === null) {
                $bytes += 8;
            } elseif (is_bool($value)) {
                $bytes += 4;
            } elseif (is_int($value) || is_float($value)) {
                $bytes += strlen((string) $value) + 4;
            } elseif (is_string($value)) {
                $bytes += strlen($value) + 4;
            } else {
                $bytes += strlen((string) $value) + 8;
            }
        }

        return $bytes;
    }

    /** @return array{rows:int,bindings:int,batch_bytes:int,single_row_bytes:int} */
    private function batchLimits(): array
    {
        if (self::$maxAllowedPacket === null) {
            $serverLimit = DB::selectOne('SELECT @@max_allowed_packet AS packet_bytes');
            self::$maxAllowedPacket = max(4096, (int) ($serverLimit->packet_bytes ?? 1048576));
        }
        $margin = max(4096, (int) config('import_ingestion.packet_margin_bytes', 65536));
        $safeBytes = max(1024, self::$maxAllowedPacket - $margin);
        $configuredBytes = max(1024, (int) config('import_ingestion.max_batch_bytes', 524288));

        return [
            'rows' => max(1, (int) config('import_ingestion.max_batch_rows', 400)),
            'bindings' => max(1, (int) config('import_ingestion.max_batch_bindings', 4000)),
            'batch_bytes' => min($safeBytes, $configuredBytes),
            'single_row_bytes' => $safeBytes,
        ];
    }

    private function chunkPayloadFingerprint(array $rows, array $columnOverrides): string
    {
        return hash('sha256', json_encode(
            $this->canonicalChunkValue(['rows' => $rows, 'column_overrides' => $columnOverrides]),
            JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PRESERVE_ZERO_FRACTION,
        ));
    }

    private function canonicalChunkValue(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        if (array_is_list($value)) {
            return array_map(fn (mixed $item): mixed => $this->canonicalChunkValue($item), $value);
        }

        ksort($value, SORT_STRING);
        foreach ($value as $key => $item) {
            $value[$key] = $this->canonicalChunkValue($item);
        }

        return $value;
    }

    private function relatedRow(string $table, array $mapped, string $organizationId, string $snapshotId, mixed $now): ?array
    {
        $values = $mapped[$table] ?? [];
        if ($values === [] || ! $this->hasValues($values)) {
            return null;
        }

        return array_merge($values, [
            'id' => (string) Str::ulid(),
            'organization_id' => $organizationId,
            'shipment_snapshot_id' => $snapshotId,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    private function issueRow(string $organizationId, string $runId, string $sourceRowId, int $sheetIndex, int $rowNumber, array $issue, mixed $now): array
    {
        return [
            'id' => (string) Str::ulid(),
            'organization_id' => $organizationId,
            'import_run_id' => $runId,
            'import_source_row_id' => $sourceRowId,
            'source_sheet_index' => $sheetIndex,
            'source_row_number' => $rowNumber,
            'source_column_number' => $issue['source_column_number'],
            'source_column_label' => $issue['source_column_label'],
            'issue_code' => $issue['issue_code'],
            'severity' => $issue['severity'],
            'safe_message' => $issue['safe_message'],
            'created_at' => $now,
            'updated_at' => $now,
        ];
    }

    private function hasValues(array $values): bool
    {
        foreach ($values as $value) {
            if ($value !== null && $value !== '') {
                return true;
            }
        }

        return false;
    }

    private function cleanString(mixed $value): ?string
    {
        if ($value === null || is_array($value) || is_object($value) && ! $value instanceof \Stringable) {
            return null;
        }

        $string = trim(preg_replace('/\s+/u', ' ', (string) $value) ?? (string) $value);
        if ($string === '' || in_array(mb_strtolower($string), ['nan', 'null', 'undefined', 'n/a', 'na', 'none', '-', '--'], true)) {
            return null;
        }

        return $string;
    }

    private function fingerprint(mixed $value): ?string
    {
        $string = $this->cleanString($value);

        return $string === null ? null : hash('sha256', mb_strtolower($string), true);
    }

    public static function normalizeLabel(string $label): string
    {
        return preg_replace('/[^a-z0-9]+/i', '', mb_strtolower(trim($label))) ?? '';
    }
}
