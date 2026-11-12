<?php

namespace App\Http\Controllers;

use App\Security\AuditLogService;
use App\Tenancy\OrganizationContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class LegacyImportController extends Controller
{
    public function __construct(private readonly OrganizationContext $context) {}

    public function start(Request $request, string $organization, AuditLogService $audit): JsonResponse
    {
        $data = $request->validate([
            'legacy_key' => ['required', 'string', 'size:64', 'regex:/\A[a-f0-9]{64}\z/'],
            'original_name' => ['required', 'string', 'max:500'],
            'size_bytes' => ['required', 'integer', 'min:0'],
            'detected_date' => ['nullable', 'date_format:Y-m-d'],
            'manual_date' => ['required', 'boolean'],
            'record_count' => ['required', 'integer', 'min:0', 'max:10000000'],
            'duplicate_count' => ['required', 'integer', 'min:0'],
            'sheets_count' => ['required', 'integer', 'min:0', 'max:1000'],
            'uploaded_at_ms' => ['nullable', 'integer', 'min:0'],
        ]);

        $organizationId = $this->context->requireId();
        $now = now();
        $uploadedAt = isset($data['uploaded_at_ms'])
            ? now()->setTimestamp((int) floor(((int) $data['uploaded_at_ms']) / 1000))
            : $now;
        $id = (string) Str::ulid();

        DB::table('legacy_import_files')->insertOrIgnore([
            'id' => $id,
            'organization_id' => $organizationId,
            'legacy_key' => $data['legacy_key'],
            'original_name' => $data['original_name'],
            'size_bytes' => $data['size_bytes'],
            'detected_date' => $data['detected_date'] ?? null,
            'manual_date' => (bool) $data['manual_date'],
            'record_count' => $data['record_count'],
            'duplicate_count' => $data['duplicate_count'],
            'sheets_count' => $data['sheets_count'],
            'uploaded_at' => $uploadedAt,
            'migration_status' => 'migrating',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $file = DB::table('legacy_import_files')->where('organization_id', $organizationId)
            ->where('legacy_key', $data['legacy_key'])->first();

        if ($file->migration_status === 'migrating') {
            $audit->record($request->user(), 'import.legacy_migration_started', 'legacy_import_file', (string) $file->id);
        }

        return $this->success([
            'id' => (string) $file->id,
            'migration_status' => (string) $file->migration_status,
            'expected_records' => (int) $file->record_count,
        ]);
    }

    public function appendChunk(Request $request, string $organization, string $legacyFile, string $chunk, AuditLogService $audit): JsonResponse
    {
        abort_unless(preg_match('/\A\d{1,8}\z/', $chunk) === 1, 404);
        $data = $request->validate([
            'records' => ['required', 'array', 'min:1', 'max:500'],
            'records.*.id' => ['required', 'string', 'max:500'],
            'records.*.shipmentDate' => ['nullable', 'date_format:Y-m-d'],
            'records.*.tracking' => ['nullable', 'string', 'max:500'],
            'records.*.items' => ['nullable', 'numeric', 'min:0'],
            'records.*.business' => ['nullable', 'string', 'max:1000'],
            'records.*.shipType' => ['nullable', 'string', 'max:1000'],
            'records.*.packageType' => ['nullable', 'string', 'max:1000'],
            'records.*.packageSize' => ['nullable', 'string', 'max:1000'],
            'records.*.pickupCity' => ['nullable', 'string', 'max:1000'],
            'records.*.dropCity' => ['nullable', 'string', 'max:1000'],
            'records.*.pickupZone' => ['nullable', 'string', 'max:1000'],
            'records.*.assignedHub' => ['nullable', 'string', 'max:1000'],
            'records.*.hubs' => ['nullable', 'array', 'max:100'],
            'records.*.rawDate' => ['nullable', 'string', 'max:1000'],
            'records.*.receivedTime' => ['nullable', 'string', 'max:1000'],
            'records.*.firstReceivingBy' => ['nullable', 'string', 'max:1000'],
        ]);

        $organizationId = $this->context->requireId();
        $file = DB::table('legacy_import_files')->where('id', $legacyFile)
            ->where('organization_id', $organizationId)->first();
        abort_unless($file && $file->migration_status === 'migrating', 409, 'This legacy migration is not accepting rows.');

        $now = now();
        $rows = [];
        foreach ($data['records'] as $record) {
            $tracking = isset($record['tracking']) ? trim((string) $record['tracking']) : null;
            $sourceKey = hash('sha256', (string) $record['id']);
            $rows[] = [
                'id' => (string) Str::ulid(),
                'organization_id' => $organizationId,
                'legacy_import_file_id' => $legacyFile,
                'source_record_key' => $sourceKey,
                'shipment_date' => $record['shipmentDate'] ?? $file->detected_date,
                'tracking' => $tracking,
                'tracking_hash' => $tracking === null || $tracking === '' ? null : hash('sha256', $organizationId."\0".mb_strtolower($tracking), true),
                'items' => $record['items'] ?? 1,
                'business' => $record['business'] ?? null,
                'ship_type' => $record['shipType'] ?? null,
                'package_type' => $record['packageType'] ?? null,
                'package_size' => $record['packageSize'] ?? null,
                'pickup_city' => $record['pickupCity'] ?? null,
                'drop_city' => $record['dropCity'] ?? null,
                'pickup_zone' => $record['pickupZone'] ?? null,
                'assigned_hub' => $record['assignedHub'] ?? null,
                'hubs' => json_encode($record['hubs'] ?? [], JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE),
                'raw_date' => $record['rawDate'] ?? null,
                'received_time' => $record['receivedTime'] ?? null,
                'first_receiving_by' => $record['firstReceivingBy'] ?? null,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        $inserted = DB::table('legacy_import_records')->insertOrIgnore($rows);

        return $this->success(['received' => count($rows), 'inserted' => $inserted]);
    }

    public function complete(Request $request, string $organization, string $legacyFile, AuditLogService $audit): JsonResponse
    {
        $organizationId = $this->context->requireId();
        $file = DB::table('legacy_import_files')->where('id', $legacyFile)
            ->where('organization_id', $organizationId)->lockForUpdate()->first();
        abort_unless($file, 404);

        $count = DB::table('legacy_import_records')->where('organization_id', $organizationId)
            ->where('legacy_import_file_id', $legacyFile)->count();
        abort_unless($count === (int) $file->record_count, 409, 'Legacy record count verification failed; browser data was retained.');

        DB::table('legacy_import_files')->where('id', $legacyFile)->update([
            'migration_status' => 'completed',
            'migration_completed_at' => now(),
            'updated_at' => now(),
        ]);
        $audit->record($request->user(), 'import.legacy_migration_completed', 'legacy_import_file', $legacyFile, [
            'status' => 'completed',
        ]);

        return $this->success(['migration_status' => 'completed', 'records' => $count]);
    }
}
