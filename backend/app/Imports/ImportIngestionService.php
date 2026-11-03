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

    public function __construct()
    {
        $this->manifest = config('bosta_columns', []);
        if (count($this->manifest) !== 211) {
            throw new RuntimeException('The Bosta source manifest must define exactly 211 columns.');
        }
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
        return DB::transaction(function () use (
            $organizationId,
            $fileId,
            $runId,
            $sheetId,
            $chunkIndex,
            $rows,
            $columnOverrides,
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
                return [
                    'rows_processed' => (int) $existingChunk->rows_processed,
                    'accepted' => 0,
                    'duplicates' => 0,
                    'rejected' => 0,
                    'issues' => (int) $existingChunk->issues_count,
                    'already_processed' => true,
                ];
            }

            $rows = array_values(array_filter($rows, fn (array $row): bool => $this->hasValues($row['values'] ?? [])));
            if ($rows === []) {
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
            $headerIndexes = [];
            foreach ($headers as $index => $header) {
                $normalized = self::normalizeLabel((string) $header);
                if ($normalized !== '' && ! array_key_exists($normalized, $headerIndexes)) {
                    $headerIndexes[$normalized] = (int) $index;
                }
            }

            $overridesByColumn = $this->overrideIndexes($headerIndexes, $columnOverrides);
            $hasTrackingColumn = isset($headerIndexes[self::normalizeLabel('Tracking Number')])
                || isset($overridesByColumn['shipment_snapshots.tracking_number']);

            $sourceRows = [];
            $snapshots = [];
            $parties = [];
            $routing = [];
            $financials = [];
            $services = [];
            $attempts = [];
            $issues = [];
            $shipmentIdsInChunk = [];
            $shipmentIdByTrackingHash = [];
            $businessIdCache = [];
            $hubIdCache = [];
            $accepted = 0;
            $duplicates = 0;
            $rejected = 0;
            $issueCount = 0;

            foreach ($rows as $row) {
                $sourceRowNumber = (int) $row['source_row_number'];
                $values = array_values($row['values'] ?? []);
                $sourceRowId = (string) Str::ulid();
                [$mapped, $attemptValues, $rowIssues] = $this->mapValues($headers, $values, $overridesByColumn, $row['dashboard_record'] ?? null);

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
                if (array_key_exists($trackingKey, $shipmentIdByTrackingHash)) {
                    $shipmentId = $shipmentIdByTrackingHash[$trackingKey];
                } else {
                    $shipmentId = (string) Str::ulid();
                    DB::table('shipments')->insertOrIgnore([
                        'id' => $shipmentId,
                        'organization_id' => $organizationId,
                        'tracking_fingerprint' => $trackingHash,
                        'created_at' => $timestamp,
                        'updated_at' => $timestamp,
                    ]);
                    $shipmentId = (string) DB::table('shipments')
                        ->where('organization_id', $organizationId)
                        ->where('tracking_fingerprint', $trackingHash)
                        ->value('id');
                    $shipmentIdByTrackingHash[$trackingKey] = $shipmentId;
                }

                $alreadyInRun = isset($shipmentIdsInChunk[$shipmentId]) || DB::table('shipment_snapshots')
                    ->where('organization_id', $organizationId)
                    ->where('shipment_id', $shipmentId)
                    ->where('import_run_id', $runId)
                    ->exists();

                if ($alreadyInRun) {
                    $sourceRows[array_key_last($sourceRows)]['status'] = 'duplicate';
                    $duplicates++;
                    foreach ($rowIssues as $issue) {
                        $issues[] = $this->issueRow($organizationId, $runId, $sourceRowId, (int) $sheet->source_sheet_index, $sourceRowNumber, $issue, $timestamp);
                    }
                    $issueCount += count($rowIssues);

                    continue;
                }

                $businessId = $this->businessId(
                    $organizationId,
                    $mapped['shipment_snapshots']['business_name'] ?? null,
                    $mapped['shipment_snapshots']['business_external_id'] ?? null,
                    $timestamp,
                    $businessIdCache,
                );
                $hubIds = [];
                foreach ([
                    'current_hub_name' => 'current_hub_id',
                    'assigned_hub_name' => 'assigned_hub_id',
                    'auto_assigned_hub_name' => 'auto_assigned_hub_id',
                    'first_hub_name' => 'first_hub_id',
                    'last_dispatch_hub_name' => 'last_dispatch_hub_id',
                    'loss_liable_hub_name' => 'loss_liable_hub_id',
                ] as $nameColumn => $idColumn) {
                    $hubIds[$idColumn] = $this->hubId(
                        $organizationId,
                        $mapped['shipment_snapshot_routing'][$nameColumn] ?? null,
                        $timestamp,
                        $hubIdCache,
                    );
                }

                $snapshotId = (string) Str::ulid();
                $snapshot = array_merge($mapped['shipment_snapshots'] ?? [], [
                    'id' => $snapshotId,
                    'organization_id' => $organizationId,
                    'shipment_id' => $shipmentId,
                    'import_run_id' => $runId,
                    'import_source_row_id' => $sourceRowId,
                    'business_id' => $businessId,
                    'delivery_state_fingerprint' => $this->fingerprint($mapped['shipment_snapshots']['delivery_state'] ?? null),
                    'created_at' => $timestamp,
                    'updated_at' => $timestamp,
                ], $hubIds);
                $snapshots[] = $snapshot;
                $shipmentIdsInChunk[$shipmentId] = true;

                $parties[] = $this->relatedRow('shipment_snapshot_parties', $mapped, $organizationId, $snapshotId, $timestamp);
                $routing[] = $this->relatedRow('shipment_snapshot_routing', $mapped, $organizationId, $snapshotId, $timestamp);
                $financials[] = $this->relatedRow('shipment_snapshot_financials', $mapped, $organizationId, $snapshotId, $timestamp);
                $services[] = $this->relatedRow('shipment_snapshot_service', $mapped, $organizationId, $snapshotId, $timestamp);
                foreach ($attemptValues as $attemptIndex => $attemptValue) {
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

                foreach ($rowIssues as $issue) {
                    $issues[] = $this->issueRow($organizationId, $runId, $sourceRowId, (int) $sheet->source_sheet_index, $sourceRowNumber, $issue, $timestamp);
                }
                $issueCount += count($rowIssues);
                $accepted++;
            }

            $this->insertInBatches('import_source_rows', $sourceRows);
            $this->insertInBatches('shipment_snapshots', $snapshots);
            $this->insertInBatches('shipment_snapshot_parties', array_values(array_filter($parties)));
            $this->insertInBatches('shipment_snapshot_routing', array_values(array_filter($routing)));
            $this->insertInBatches('shipment_snapshot_financials', array_values(array_filter($financials)));
            $this->insertInBatches('shipment_snapshot_service', array_values(array_filter($services)));
            $this->insertInBatches('delivery_attempts', $attempts);
            $this->insertInBatches('import_issues', $issues);

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

    /** @param list<string> $headers @param list<mixed> $values @param array<string,int> $overridesByColumn */
    private function mapValues(array $headers, array $values, array $overridesByColumn, ?array $dashboardRecord): array
    {
        $headerIndexes = [];
        foreach ($headers as $index => $header) {
            $normalized = self::normalizeLabel((string) $header);
            if ($normalized !== '' && ! array_key_exists($normalized, $headerIndexes)) {
                $headerIndexes[$normalized] = (int) $index;
            }
        }

        $mapped = [];
        $attempts = [];
        $issues = [];
        foreach ($this->manifest as $definition) {
            $target = $definition['table'].'.'.$definition['physical_column'];
            $index = $overridesByColumn[$target] ?? $headerIndexes[self::normalizeLabel($definition['source_label'])] ?? null;
            if ($index === null) {
                continue;
            }

            $raw = $values[$index] ?? null;
            [$value, $valid] = $this->typedValue($raw, $definition['provisional_type']);
            if (! $valid) {
                $issues[] = [
                    'source_column_number' => $index + 1,
                    'source_column_label' => (string) ($headers[$index] ?? $definition['source_label']),
                    'issue_code' => 'invalid_typed_value',
                    'severity' => 'warning',
                    'safe_message' => 'A value could not be represented in the provisional database type and was retained in the raw row.',
                ];
            }

            if ($definition['table'] === 'delivery_attempts') {
                $attemptIndex = $this->attemptIndex($definition['source_label']);
                $attempts[$attemptIndex][$definition['physical_column']] = $value;
            } else {
                $mapped[$definition['table']][$definition['physical_column']] = $value;
            }
        }

        if ($dashboardRecord !== null) {
            foreach ([
                'tracking' => ['shipment_snapshots', 'tracking_number'],
                'items' => ['shipment_snapshots', 'items'],
                'business' => ['shipment_snapshots', 'business_name'],
                'shipType' => ['shipment_snapshots', 'shipment_type'],
                'packageType' => ['shipment_snapshots', 'package_type'],
                'packageSize' => ['shipment_snapshots', 'package_size'],
                'pickupCity' => ['shipment_snapshot_parties', 'pickup_city'],
                'dropCity' => ['shipment_snapshot_parties', 'dropoff_city'],
                'pickupZone' => ['shipment_snapshot_parties', 'pickup_zone'],
                'assignedHub' => ['shipment_snapshot_routing', 'assigned_hub_name'],
            ] as $key => [$table, $column]) {
                if (array_key_exists($key, $dashboardRecord) && $dashboardRecord[$key] !== null) {
                    [$value] = $this->typedValue($dashboardRecord[$key], $this->typeFor($table, $column));
                    $mapped[$table][$column] = $value;
                }
            }

            foreach ((array) ($dashboardRecord['hubs'] ?? []) as $label => $hubName) {
                $normalized = self::normalizeLabel((string) $label);
                foreach ($this->manifest as $definition) {
                    if ($definition['table'] === 'shipment_snapshot_routing'
                        && self::normalizeLabel($definition['source_label']) === $normalized
                        && $hubName !== null) {
                        [$value] = $this->typedValue($hubName, $definition['provisional_type']);
                        $mapped[$definition['table']][$definition['physical_column']] = $value;
                    }
                }
            }
        }

        return [$mapped, $attempts, $issues];
    }

    private function typeFor(string $table, string $column): string
    {
        foreach ($this->manifest as $definition) {
            if ($definition['table'] === $table && $definition['physical_column'] === $column) {
                return $definition['provisional_type'];
            }
        }

        return 'text';
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

    private function typedValue(mixed $raw, string $type): array
    {
        if ($raw === null || $raw === '') {
            return [null, true];
        }

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
                if (is_numeric($raw) && (float) $raw >= 20000 && (float) $raw <= 80000) {
                    $seconds = ((float) $raw - 25569) * 86400;

                    return [Carbon::createFromTimestampUTC((int) round($seconds))->format('Y-m-d H:i:s.u'), true];
                }

                return [Carbon::parse((string) $raw)->utc()->format('Y-m-d H:i:s.u'), true];
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

    /** @param array<string,?string> $cache */
    private function businessId(string $organizationId, mixed $name, mixed $externalId, mixed $now, array &$cache): ?string
    {
        $canonical = $this->cleanString($name) ?? $this->cleanString($externalId);
        if ($canonical === null) {
            return null;
        }

        $nameHash = hash('sha256', $organizationId."\0".mb_strtolower($canonical), true);
        $external = $this->cleanString($externalId);
        $externalHash = $external === null ? null : hash('sha256', $organizationId."\0".mb_strtolower($external), true);
        $cacheKey = bin2hex($externalHash ?? $nameHash);
        if (array_key_exists($cacheKey, $cache)) {
            return $cache[$cacheKey];
        }

        $query = DB::table('businesses')->where('organization_id', $organizationId);
        if ($externalHash !== null) {
            $query->where('external_id_hash', $externalHash);
        } else {
            $query->where('canonical_name_hash', $nameHash);
        }
        $id = $query->value('id');
        if ($id !== null) {
            return $cache[$cacheKey] = (string) $id;
        }

        $newId = (string) Str::ulid();
        DB::table('businesses')->insertOrIgnore([
            'id' => $newId,
            'organization_id' => $organizationId,
            'name' => $canonical,
            'canonical_name_hash' => $nameHash,
            'external_id' => $external,
            'external_id_hash' => $externalHash,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $query = DB::table('businesses')->where('organization_id', $organizationId);
        $id = $externalHash === null
            ? $query->where('canonical_name_hash', $nameHash)->value('id')
            : $query->where('external_id_hash', $externalHash)->value('id');

        return $cache[$cacheKey] = $id === null ? null : (string) $id;
    }

    /** @param array<string,?string> $cache */
    private function hubId(string $organizationId, mixed $name, mixed $now, array &$cache): ?string
    {
        $canonical = $this->cleanString($name);
        if ($canonical === null) {
            return null;
        }

        $nameHash = hash('sha256', $organizationId."\0".mb_strtolower($canonical), true);
        $cacheKey = bin2hex($nameHash);
        if (array_key_exists($cacheKey, $cache)) {
            return $cache[$cacheKey];
        }

        $id = DB::table('hubs')->where('organization_id', $organizationId)
            ->where('canonical_name_hash', $nameHash)->value('id');
        if ($id !== null) {
            return $cache[$cacheKey] = (string) $id;
        }

        $newId = (string) Str::ulid();
        DB::table('hubs')->insertOrIgnore([
            'id' => $newId,
            'organization_id' => $organizationId,
            'canonical_name' => $canonical,
            'canonical_name_hash' => $nameHash,
            'external_code' => null,
            'external_code_hash' => null,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $hubId = (string) DB::table('hubs')->where('organization_id', $organizationId)
            ->where('canonical_name_hash', $nameHash)->value('id');
        if ($hubId === '') {
            return $cache[$cacheKey] = null;
        }

        $aliasHash = hash('sha256', $organizationId."\0".mb_strtolower($canonical), true);
        DB::table('hub_aliases')->insertOrIgnore([
            'organization_id' => $organizationId,
            'hub_id' => $hubId,
            'source_name' => $canonical,
            'source_name_hash' => $aliasHash,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return $cache[$cacheKey] = $hubId;
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

    private function insertInBatches(string $table, array $rows): void
    {
        foreach (array_chunk($rows, 100) as $batch) {
            if ($batch !== []) {
                DB::table($table)->insert($batch);
            }
        }
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
