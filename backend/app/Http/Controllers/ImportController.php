<?php

namespace App\Http\Controllers;

use App\Imports\ImportIngestionService;
use App\Models\ShipmentSnapshot;
use App\Security\AuditLogService;
use App\Security\AuthorizationService;
use App\Security\HubAccessService;
use App\Tenancy\OrganizationContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class ImportController extends Controller
{
    public function __construct(private readonly OrganizationContext $context) {}

    public function index(string $organization, AuthorizationService $authorization, Request $request): JsonResponse
    {
        abort_unless(
            $authorization->hasPermission($request->user(), 'imports.manage')
                || $authorization->hasPermission($request->user(), 'shipments.view_all')
                || $authorization->hasPermission($request->user(), 'shipments.view_assigned'),
            403,
        );
        $organizationId = $this->context->requireId();
        $files = DB::table('import_files as files')
            ->leftJoin('import_runs as runs', function ($join): void {
                $join->on('runs.id', '=', 'files.active_run_id')
                    ->on('runs.import_file_id', '=', 'files.id')
                    ->on('runs.organization_id', '=', 'files.organization_id');
            })
            ->where('files.organization_id', $organizationId)
            ->whereNotNull('files.active_run_id')
            ->whereNull('files.archived_at')
            ->orderByDesc('files.created_at')
            ->get([
                'files.id', 'files.original_name', 'files.size_bytes', 'files.created_at',
                'runs.id as run_id', 'runs.report_date', 'runs.report_date_is_manual',
                'runs.accepted_rows_count', 'runs.duplicate_rows_count', 'runs.rejected_rows_count',
            ]);

        $legacy = DB::table('legacy_import_files')
            ->where('organization_id', $organizationId)
            ->whereNull('archived_at')
            ->orderByDesc('uploaded_at')
            ->get();

        $headers = [];
        foreach ($files as $file) {
            if ($file->run_id === null) {
                continue;
            }

            foreach (DB::table('import_sheets')->where('import_run_id', $file->run_id)->pluck('source_headers') as $sheetHeaders) {
                $sheetHeaders = is_string($sheetHeaders) ? json_decode($sheetHeaders, true) : $sheetHeaders;
                foreach ((array) $sheetHeaders as $header) {
                    $headers[(string) $header] = true;
                }
            }
        }

        $apiFiles = $files->map(fn ($file): array => [
            'id' => (string) $file->id,
            'name' => (string) $file->original_name,
            'size' => (int) $file->size_bytes,
            'detectedDate' => $file->report_date,
            'manualDate' => (bool) $file->report_date_is_manual,
            'recordCount' => (int) ($file->accepted_rows_count ?? 0),
            'duplicateCount' => (int) ($file->duplicate_rows_count ?? 0),
            'rejectedCount' => (int) ($file->rejected_rows_count ?? 0),
            'uploadedAt' => $file->created_at === null ? 0 : Carbon::parse($file->created_at)->getTimestampMs(),
            'sheetsCount' => $file->run_id === null ? 0 : DB::table('import_sheets')->where('import_run_id', $file->run_id)->count(),
            'source' => 'mysql',
        ])->all();

        foreach ($legacy as $file) {
            $apiFiles[] = [
                'id' => (string) $file->id,
                'name' => (string) $file->original_name,
                'size' => (int) $file->size_bytes,
                'detectedDate' => $file->detected_date,
                'manualDate' => (bool) $file->manual_date,
                'recordCount' => (int) $file->record_count,
                'duplicateCount' => (int) $file->duplicate_count,
                'rejectedCount' => 0,
                'uploadedAt' => $file->uploaded_at === null ? 0 : Carbon::parse($file->uploaded_at)->getTimestampMs(),
                'sheetsCount' => (int) $file->sheets_count,
                'source' => 'legacy-migrated',
            ];
        }

        usort($apiFiles, fn (array $a, array $b): int => $b['uploadedAt'] <=> $a['uploadedAt']);
        $hubLabels = array_values(array_filter(array_keys($headers), fn (string $label): bool => preg_match('/hub|facility|warehouse|intransitto/i', ImportIngestionService::normalizeLabel($label)) === 1));

        return $this->success([
            'files' => $apiFiles,
            'all_headers' => array_keys($headers),
            'hub_labels' => $hubLabels,
        ]);
    }

    public function shipments(Request $request, string $organization, HubAccessService $hubAccess, AuthorizationService $authorization): JsonResponse
    {
        $user = $request->user();
        abort_unless(
            $authorization->hasPermission($user, 'shipments.view_all')
                || $authorization->hasPermission($user, 'shipments.view_assigned'),
            403,
        );

        $perPage = min(max((int) $request->query('per_page', 500), 1), 1000);
        $source = $request->query('source', 'published');

        if ($source === 'legacy') {
            abort_unless($authorization->hasPermission($user, 'shipments.view_all'), 403);

            $records = DB::table('legacy_import_records as records')
                ->join('legacy_import_files as files', function ($join): void {
                    $join->on('files.id', '=', 'records.legacy_import_file_id')
                        ->on('files.organization_id', '=', 'records.organization_id');
                })
                ->where('records.organization_id', $this->context->requireId())
                ->whereNull('files.archived_at')
                ->select([
                    'records.id as record_id', 'records.shipment_date', 'records.tracking', 'records.items',
                    'records.business', 'records.ship_type', 'records.package_type', 'records.package_size',
                    'records.pickup_city', 'records.drop_city', 'records.pickup_zone', 'records.assigned_hub',
                    'records.hubs', 'records.raw_date', 'files.id as file_id', 'files.original_name as file_name',
                ])
                ->orderBy('records.id')
                ->cursorPaginate($perPage)
                ->through(fn ($row): array => $this->legacyShipmentPayload($row));

            return $this->success([
                'shipments' => $records->items(),
                'pagination' => ['next_cursor' => $records->nextCursor()?->encode()],
            ]);
        }

        abort_unless($source === 'published', 422, 'Unknown shipment source.');

        $query = $hubAccess->scopeShipmentSnapshots(ShipmentSnapshot::query(), $user)
            ->join('import_runs as runs', function ($join): void {
                $join->on('runs.id', '=', 'shipment_snapshots.import_run_id')
                    ->on('runs.organization_id', '=', 'shipment_snapshots.organization_id')
                    ->where('runs.status', '=', 'published')
                    ->whereNotNull('runs.published_at');
            })
            ->join('import_files as files', function ($join): void {
                $join->on('files.id', '=', 'runs.import_file_id')
                    ->on('files.organization_id', '=', 'runs.organization_id')
                    ->on('files.active_run_id', '=', 'runs.id')
                    ->whereNull('files.archived_at');
            })
            ->leftJoin('shipment_snapshot_parties as parties', function ($join): void {
                $join->on('parties.shipment_snapshot_id', '=', 'shipment_snapshots.id')
                    ->on('parties.organization_id', '=', 'shipment_snapshots.organization_id');
            })
            ->leftJoin('shipment_snapshot_routing as routing', function ($join): void {
                $join->on('routing.shipment_snapshot_id', '=', 'shipment_snapshots.id')
                    ->on('routing.organization_id', '=', 'shipment_snapshots.organization_id');
            })
            ->select([
                'shipment_snapshots.id as snapshot_id', 'runs.report_date', 'files.id as file_id',
                'files.original_name as file_name', 'shipment_snapshots.tracking_number', 'shipment_snapshots.items',
                'shipment_snapshots.business_name', 'shipment_snapshots.shipment_type',
                'shipment_snapshots.package_type', 'shipment_snapshots.package_size',
                'parties.pickup_city', 'parties.dropoff_city', 'parties.pickup_zone',
                'routing.current_hub_name', 'routing.assigned_hub_name', 'routing.auto_assigned_hub_name',
                'routing.first_hub_name', 'routing.last_dispatch_hub_name', 'routing.loss_liable_hub_name',
            ])
            ->orderBy('shipment_snapshots.id')
            ->cursorPaginate($perPage)
            ->through(fn ($row): array => $this->shipmentPayload($row));

        return $this->success([
            'shipments' => $query->items(),
            'pagination' => ['next_cursor' => $query->nextCursor()?->encode()],
        ]);
    }

    public function store(Request $request, string $organization, AuditLogService $audit): JsonResponse
    {
        $validated = $request->validate([
            'file' => ['required', 'file', 'extensions:xlsx,xls', 'max:32768'],
            'report_date' => ['required', 'date_format:Y-m-d'],
            'manual_date' => ['sometimes', 'boolean'],
            'sheets' => ['required', 'string', 'max:1000000'],
            'column_overrides' => ['sometimes', 'string', 'max:10000'],
        ]);

        $sheets = json_decode($validated['sheets'], true, 512, JSON_THROW_ON_ERROR);
        if (! is_array($sheets) || $sheets === [] || count($sheets) > 100) {
            throw ValidationException::withMessages(['sheets' => 'The workbook must include between 1 and 100 sheets.']);
        }
        foreach ($sheets as $sheet) {
            if (! is_array($sheet)
                || ! is_string($sheet['name'] ?? null)
                || ! is_array($sheet['headers'] ?? null)
                || count($sheet['headers']) > 512) {
                throw ValidationException::withMessages(['sheets' => 'A sheet name or header list is invalid.']);
            }
        }

        $overrides = [];
        if (! empty($validated['column_overrides'])) {
            $overrides = json_decode($validated['column_overrides'], true, 512, JSON_THROW_ON_ERROR);
            if (! is_array($overrides)) {
                throw ValidationException::withMessages(['column_overrides' => 'Column overrides must be an object.']);
            }
        }

        $uploaded = $request->file('file');
        $name = basename(str_replace('\\', '/', $uploaded->getClientOriginalName()));
        $sha256 = hash_file('sha256', $uploaded->getRealPath());
        $identityHash = hash('sha256', mb_strtolower(trim($name)));
        $organizationId = $this->context->requireId();
        $userId = (int) $request->user()->id;
        $result = DB::transaction(function () use ($uploaded, $name, $sha256, $identityHash, $organizationId, $userId, $validated, $sheets, $overrides): array {
            $file = DB::table('import_files')->where('organization_id', $organizationId)
                ->where('identity_hash', $identityHash)->lockForUpdate()->first();

            if ($file && hash_equals((string) $file->sha256, $sha256)) {
                $completedRun = DB::table('import_runs')->where('import_file_id', $file->id)
                    ->where('organization_id', $organizationId)->where('report_date', $validated['report_date'])
                    ->where('status', 'published')->orderByDesc('revision')->first();
                if ($completedRun) {
                    return [
                        'already_imported' => true,
                        'file_id' => (string) $file->id,
                        'run_id' => (string) $completedRun->id,
                        'sheet_ids' => [],
                        'revision' => (int) $completedRun->revision,
                        'counts' => [
                            'accepted' => (int) $completedRun->accepted_rows_count,
                            'duplicates' => (int) $completedRun->duplicate_rows_count,
                            'rejected' => (int) $completedRun->rejected_rows_count,
                        ],
                    ];
                }
            }

            $now = now();
            $fileId = $file?->id ? (string) $file->id : (string) Str::ulid();
            $fileValues = [
                'organization_id' => $organizationId,
                'original_name' => $name,
                'media_type' => $uploaded->getClientMimeType(),
                'size_bytes' => (int) $uploaded->getSize(),
                'sha256' => $sha256,
                'identity_hash' => $identityHash,
                'storage_disk' => 'mysql',
                'storage_path' => 'import_file_contents',
                'archived_at' => null,
                'updated_at' => $now,
            ];
            if ($file) {
                DB::table('import_files')->where('id', $fileId)->update($fileValues);
            } else {
                DB::table('import_files')->insert(array_merge($fileValues, [
                    'id' => $fileId,
                    'active_run_id' => null,
                    'created_at' => $now,
                ]));
            }

            $revision = (int) DB::table('import_runs')->where('import_file_id', $fileId)->max('revision') + 1;
            $runId = (string) Str::ulid();
            DB::table('import_runs')->insert([
                'id' => $runId,
                'organization_id' => $organizationId,
                'import_file_id' => $fileId,
                'uploaded_by' => $userId,
                'revision' => $revision,
                'mapping_version' => 1,
                'duplicate_policy' => 'preserve_and_mark',
                'report_date' => $validated['report_date'],
                'report_date_is_manual' => (bool) ($validated['manual_date'] ?? false),
                'report_timezone' => config('app.timezone'),
                'status' => 'importing',
                'source_rows_count' => 0,
                'accepted_rows_count' => 0,
                'duplicate_rows_count' => 0,
                'rejected_rows_count' => 0,
                'issues_count' => 0,
                'started_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            DB::table('import_file_contents')->insert([
                'id' => (string) Str::ulid(),
                'organization_id' => $organizationId,
                'import_file_id' => $fileId,
                'import_run_id' => $runId,
                'media_type' => $uploaded->getClientMimeType(),
                'sha256' => $sha256,
                'contents' => file_get_contents($uploaded->getRealPath()),
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            $sheetIds = [];
            foreach (array_values($sheets) as $index => $sheet) {
                $sheetId = (string) Str::ulid();
                $headers = array_map(fn ($header): string => mb_substr(trim((string) $header), 0, 500), $sheet['headers']);
                DB::table('import_sheets')->insert([
                    'id' => $sheetId,
                    'organization_id' => $organizationId,
                    'import_run_id' => $runId,
                    'source_sheet_index' => (int) ($sheet['index'] ?? $index),
                    'source_sheet_name' => mb_substr((string) $sheet['name'], 0, 500),
                    'source_headers' => json_encode($headers, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE),
                    'header_row_number' => max(1, (int) ($sheet['header_row_number'] ?? 1)),
                    'data_rows_count' => 0,
                    'detected_columns_count' => count($headers),
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
                $sheetIds[(int) ($sheet['index'] ?? $index)] = $sheetId;
            }

            foreach ($overrides as $role => $label) {
                if (is_string($label)) {
                    $this->storeColumnMapping($organizationId, (string) $role, $label, $userId, $now);
                }
            }

            return [
                'already_imported' => false,
                'file_id' => $fileId,
                'run_id' => $runId,
                'sheet_ids' => $sheetIds,
                'revision' => $revision,
                'counts' => ['accepted' => 0, 'duplicates' => 0, 'rejected' => 0],
            ];
        }, 3);

        if (! $result['already_imported']) {
            $audit->record($request->user(), 'import.started', 'import_file', $result['file_id'], [
                'status' => 'importing',
            ]);
        }

        return $this->success($result);
    }

    public function appendChunk(
        Request $request,
        string $organization,
        string $importFile,
        string $run,
        string $sheet,
        ImportIngestionService $ingestion,
    ): JsonResponse {
        $validated = $request->validate([
            'chunk_index' => ['required', 'integer', 'min:0', 'max:1000000'],
            'rows' => ['required', 'array', 'min:1', 'max:500'],
            'rows.*.source_row_number' => ['required', 'integer', 'min:1'],
            'rows.*.values' => ['required', 'array', 'max:512'],
            'rows.*.dashboard_record' => ['sometimes', 'nullable', 'array'],
            'column_overrides' => ['sometimes', 'array'],
        ]);

        return $this->success($ingestion->ingestChunk(
            $this->context->requireId(),
            $importFile,
            $run,
            $sheet,
            (int) $validated['chunk_index'],
            $validated['rows'],
            $validated['column_overrides'] ?? [],
        ));
    }

    public function publish(Request $request, string $organization, string $importFile, string $run, AuditLogService $audit): JsonResponse
    {
        $organizationId = $this->context->requireId();
        $result = DB::transaction(function () use ($organizationId, $importFile, $run): array {
            $importRun = DB::table('import_runs')
                ->where('id', $run)->where('import_file_id', $importFile)->where('organization_id', $organizationId)
                ->lockForUpdate()->first();
            abort_unless($importRun && $importRun->status === 'importing', 409, 'This import run cannot be published.');

            $incomplete = DB::table('import_chunks')->where('import_run_id', $run)->where('organization_id', $organizationId)
                ->where('status', '!=', 'completed')->exists();
            abort_if($incomplete, 409, 'Some import chunks are incomplete.');
            abort_if((int) $importRun->accepted_rows_count === 0, 422, 'The workbook has no acceptable shipment rows.');

            $now = now();
            DB::table('import_runs')->where('id', $run)->update([
                'status' => 'published',
                'finished_at' => $now,
                'published_at' => $now,
                'updated_at' => $now,
            ]);
            DB::table('import_files')->where('id', $importFile)->where('organization_id', $organizationId)->update([
                'active_run_id' => $run,
                'archived_at' => null,
                'updated_at' => $now,
            ]);

            return [
                'file_id' => $importFile,
                'run_id' => $run,
                'revision' => (int) $importRun->revision,
                'counts' => [
                    'source' => (int) $importRun->source_rows_count,
                    'accepted' => (int) $importRun->accepted_rows_count,
                    'duplicates' => (int) $importRun->duplicate_rows_count,
                    'rejected' => (int) $importRun->rejected_rows_count,
                    'issues' => (int) $importRun->issues_count,
                ],
            ];
        }, 3);

        $audit->record($request->user(), 'import.published', 'import_file', $importFile, [
            'status' => 'published',
        ]);

        return $this->success($result);
    }

    public function updateDate(Request $request, string $organization, string $importFile, AuditLogService $audit): JsonResponse
    {
        $validated = $request->validate([
            'report_date' => ['required', 'date_format:Y-m-d'],
        ]);
        $organizationId = $this->context->requireId();
        $file = DB::table('import_files')->where('organization_id', $organizationId)->where('id', $importFile)->first();
        abort_unless($file && $file->active_run_id, 404);
        $run = DB::table('import_runs')->where('organization_id', $organizationId)->where('id', $file->active_run_id)->first();
        $previousDate = $run?->report_date;
        DB::table('import_runs')->where('id', $file->active_run_id)->update([
            'report_date' => $validated['report_date'],
            'report_date_is_manual' => true,
            'updated_at' => now(),
        ]);
        $audit->record($request->user(), 'import.report_date_updated', 'import_file', $importFile, [
            'previous_report_date' => $previousDate,
            'report_date' => $validated['report_date'],
        ]);

        return $this->success(['updated' => true, 'report_date' => $validated['report_date']]);
    }

    public function archive(Request $request, string $organization, string $importFile, AuditLogService $audit): JsonResponse
    {
        $organizationId = $this->context->requireId();
        $file = DB::table('import_files')->where('organization_id', $organizationId)->where('id', $importFile)
            ->whereNull('archived_at')->first();
        if ($file) {
            DB::table('import_files')->where('id', $importFile)->update([
                'active_run_id' => null,
                'archived_at' => now(),
                'updated_at' => now(),
            ]);
            $audit->record($request->user(), 'import.archived', 'import_file', $importFile);
        } else {
            $legacy = DB::table('legacy_import_files')->where('organization_id', $organizationId)
                ->where('id', $importFile)->whereNull('archived_at')->first();
            abort_unless($legacy, 404);
            DB::table('legacy_import_files')->where('id', $importFile)->update(['archived_at' => now(), 'updated_at' => now()]);
            $audit->record($request->user(), 'import.legacy_archived', 'legacy_import_file', $importFile);
        }

        return $this->success(['archived' => true]);
    }

    public function archiveAll(Request $request, string $organization, AuditLogService $audit): JsonResponse
    {
        $organizationId = $this->context->requireId();
        $now = now();
        $count = DB::table('import_files')->where('organization_id', $organizationId)->whereNull('archived_at')->update([
            'active_run_id' => null,
            'archived_at' => $now,
            'updated_at' => $now,
        ]);
        $legacyCount = DB::table('legacy_import_files')->where('organization_id', $organizationId)->whereNull('archived_at')->update([
            'archived_at' => $now,
            'updated_at' => $now,
        ]);
        $audit->record($request->user(), 'import.archived_all', null, null, ['status' => 'archived']);

        return $this->success(['archived_count' => $count + $legacyCount]);
    }

    public function settings(string $organization): JsonResponse
    {
        $settings = DB::table('organization_settings')->where('organization_id', $this->context->requireId())
            ->whereIn('setting_key', ['hubBasis', 'columnOverrides'])->get(['setting_key', 'setting_value'])
            ->mapWithKeys(fn ($row): array => [$row->setting_key => is_string($row->setting_value) ? json_decode($row->setting_value, true) : $row->setting_value])
            ->all();

        return $this->success(['settings' => $settings]);
    }

    public function saveSetting(Request $request, string $organization, string $key): JsonResponse
    {
        abort_unless(in_array($key, ['hubBasis', 'columnOverrides'], true), 404);
        $validated = $request->validate(['value' => ['present']]);
        $organizationId = $this->context->requireId();
        $now = now();
        $settingValue = json_encode($validated['value'], JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE);
        DB::table('organization_settings')->insertOrIgnore([
            'organization_id' => $organizationId,
            'setting_key' => $key,
            'setting_value' => $settingValue,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        DB::table('organization_settings')->where('organization_id', $organizationId)
            ->where('setting_key', $key)->update(['setting_value' => $settingValue, 'updated_at' => $now]);

        return $this->success(['saved' => true]);
    }

    private function shipmentPayload(object $row): array
    {
        $hubs = array_filter([
            'Current Hub' => $row->current_hub_name,
            'Assigned Hub' => $row->assigned_hub_name,
            'Auto Assigned Hub' => $row->auto_assigned_hub_name,
            'First Hub' => $row->first_hub_name,
            'Last Dispatch Hub' => $row->last_dispatch_hub_name,
            'Loss Liable Hub Name' => $row->loss_liable_hub_name,
        ], fn ($value): bool => $value !== null && $value !== '');

        $shipmentDate = $row->report_date === null ? '' : (string) $row->report_date;

        return [
            'id' => (string) $row->file_id.'_'.$row->snapshot_id,
            'fileId' => (string) $row->file_id,
            'fileName' => (string) $row->file_name,
            'shipmentDate' => $shipmentDate,
            'dateMs' => $shipmentDate === '' ? 0 : Carbon::parse($shipmentDate)->startOfDay()->getTimestampMs(),
            'tracking' => (string) ($row->tracking_number ?? ''),
            'items' => $row->items === null ? 1 : (float) $row->items,
            'business' => $row->business_name,
            'shipType' => $row->shipment_type,
            'packageType' => $row->package_type,
            'packageSize' => $row->package_size,
            'pickupCity' => $row->pickup_city,
            'dropCity' => $row->dropoff_city,
            'pickupZone' => $row->pickup_zone,
            'assignedHub' => $row->assigned_hub_name,
            'hubs' => $hubs,
            'rawDate' => null,
        ];
    }

    private function legacyShipmentPayload(object $row): array
    {
        $hubs = is_string($row->hubs) ? json_decode($row->hubs, true) : (array) $row->hubs;
        $shipmentDate = $row->shipment_date === null ? '' : (string) $row->shipment_date;

        return [
            'id' => (string) $row->file_id.'_'.$row->record_id,
            'fileId' => (string) $row->file_id,
            'fileName' => (string) $row->file_name,
            'shipmentDate' => $shipmentDate,
            'dateMs' => $shipmentDate === '' ? 0 : Carbon::parse($shipmentDate)->startOfDay()->getTimestampMs(),
            'tracking' => (string) ($row->tracking ?? ''),
            'items' => $row->items === null ? 1 : (float) $row->items,
            'business' => $row->business,
            'shipType' => $row->ship_type,
            'packageType' => $row->package_type,
            'packageSize' => $row->package_size,
            'pickupCity' => $row->pickup_city,
            'dropCity' => $row->drop_city,
            'pickupZone' => $row->pickup_zone,
            'assignedHub' => $row->assigned_hub,
            'hubs' => $hubs,
            'rawDate' => $row->raw_date,
        ];
    }

    private function storeColumnMapping(string $organizationId, string $role, string $label, int $userId, mixed $now): void
    {
        $targets = [
            'tracking' => ['shipment_snapshots', 'tracking_number'],
            'items' => ['shipment_snapshots', 'items'],
            'business' => ['shipment_snapshots', 'business_name'],
            'shipType' => ['shipment_snapshots', 'shipment_type'],
            'packageType' => ['shipment_snapshots', 'package_type'],
            'packageSize' => ['shipment_snapshots', 'package_size'],
            'pickupCity' => ['shipment_snapshot_parties', 'pickup_city'],
            'dropCity' => ['shipment_snapshot_parties', 'dropoff_city'],
            'pickupZone' => ['shipment_snapshot_parties', 'pickup_zone'],
        ];
        if (! isset($targets[$role])) {
            return;
        }

        [$targetTable, $targetColumn] = $targets[$role];
        $sourceIndex = (int) DB::table('column_mappings')->where('organization_id', $organizationId)
            ->where('mapping_version', 1)->max('source_column_index') + 1;
        $sourceColumnNumber = (int) DB::table('column_mappings')->where('organization_id', $organizationId)
            ->where('mapping_version', 1)->max('source_column_number') + 1;
        DB::table('column_mappings')->insert([
            'organization_id' => $organizationId,
            'mapping_version' => 1,
            'source_column_number' => $sourceColumnNumber,
            'source_column_index' => $sourceIndex,
            'source_label' => mb_substr($label, 0, 1000),
            'target_table' => $targetTable,
            'target_column' => $targetColumn,
            'provisional_type' => 'string(191)',
            'is_enabled' => true,
            'created_by' => $userId,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }
}
