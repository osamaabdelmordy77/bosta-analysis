<?php

namespace App\Http\Controllers;

use App\Imports\ImportFileContentStorage;
use App\Imports\ImportIngestionService;
use App\Jobs\ProcessImportWorkbook;
use App\Models\ShipmentSnapshot;
use App\Security\AuditLogService;
use App\Security\AuthorizationService;
use App\Security\HubAccessService;
use App\Tenancy\OrganizationContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class ImportController extends Controller
{
    /** @var array<string,int> */
    private array $dateMilliseconds = [];

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

        $perPage = min(max((int) $request->query('per_page', 500), 1), 10000);
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
                    'records.id', 'records.id as record_id', 'records.shipment_date', 'records.tracking', 'records.items',
                    'records.business', 'records.ship_type', 'records.package_type', 'records.package_size',
                    'records.pickup_city', 'records.drop_city', 'records.pickup_zone', 'records.assigned_hub',
                    'records.hubs', 'records.raw_date', 'files.id as file_id', 'files.original_name as file_name',
                ])
                ->orderBy('records.id')
                ->cursorPaginate($perPage);
            $nextCursor = $records->nextCursor()?->encode();
            $shipments = $records->through(fn ($row): array => $this->legacyShipmentPayload($row))->items();

            return $this->success([
                'shipments' => $shipments,
                'pagination' => ['next_cursor' => $nextCursor],
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
            ->leftJoin('import_source_rows as source_rows', function ($join): void {
                $join->on('source_rows.id', '=', 'shipment_snapshots.import_source_row_id')
                    ->on('source_rows.import_run_id', '=', 'shipment_snapshots.import_run_id')
                    ->on('source_rows.organization_id', '=', 'shipment_snapshots.organization_id');
            })
            ->leftJoin('import_sheets as source_sheets', function ($join): void {
                $join->on('source_sheets.id', '=', 'source_rows.import_sheet_id')
                    ->on('source_sheets.import_run_id', '=', 'source_rows.import_run_id')
                    ->on('source_sheets.organization_id', '=', 'source_rows.organization_id');
            })
            ->select([
                'shipment_snapshots.id', 'shipment_snapshots.id as snapshot_id', 'runs.report_date', 'files.id as file_id',
                'files.original_name as file_name', 'shipment_snapshots.tracking_number', 'shipment_snapshots.items',
                'shipment_snapshots.business_name', 'shipment_snapshots.shipment_type',
                'shipment_snapshots.package_type', 'shipment_snapshots.package_size',
                'parties.pickup_city', 'parties.dropoff_city', 'parties.pickup_zone',
                'routing.current_hub_name', 'routing.assigned_hub_name', 'routing.auto_assigned_hub_name',
                'routing.first_hub_name', 'routing.last_dispatch_hub_name', 'routing.loss_liable_hub_name',
                DB::raw("JSON_UNQUOTE(JSON_EXTRACT(source_rows.source_values, JSON_UNQUOTE(JSON_SEARCH(source_sheets.source_headers, 'one', 'Picked-Up Date')))) as picked_up_date"),
                DB::raw("JSON_UNQUOTE(JSON_EXTRACT(source_rows.source_values, JSON_UNQUOTE(JSON_SEARCH(source_sheets.source_headers, 'one', 'Received Time')))) as received_time"),
            ])
            ->orderBy('shipment_snapshots.id')
            ->toBase()->cursorPaginate($perPage);
        $nextCursor = $query->nextCursor()?->encode();
        $shipments = $query->through(fn ($row): array => $this->shipmentPayload($row))->items();

        return $this->success([
            'shipments' => $shipments,
            'pagination' => ['next_cursor' => $nextCursor],
        ]);
    }

    public function store(
        Request $request,
        string $organization,
        AuditLogService $audit,
        ImportFileContentStorage $contentStorage,
    ): JsonResponse {
        $validated = $request->validate([
            'file' => ['required', 'file', 'max:40960'],
            'report_date' => ['required', 'date_format:Y-m-d'],
            'manual_date' => ['sometimes', 'boolean'],
            'column_overrides' => ['sometimes', 'string', 'max:10000'],
        ]);
        if (config('queue.default') !== 'database' || (bool) config('queue.connections.database.after_commit', false)) {
            abort(503, 'Workbook imports require the transactional database queue connection.');
        }

        $overrides = [];
        if (isset($validated['column_overrides']) && $validated['column_overrides'] !== '') {
            try {
                $overrides = json_decode($validated['column_overrides'], true, 512, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                throw ValidationException::withMessages(['column_overrides' => 'Column overrides must be valid JSON.']);
            }
            if (! is_array($overrides)) {
                throw ValidationException::withMessages(['column_overrides' => 'Column overrides must be an object.']);
            }
        }
        foreach ($overrides as $role => $label) {
            if (! is_string($role) || ! is_string($label) || mb_strlen($label) > 500) {
                throw ValidationException::withMessages(['column_overrides' => 'Column overrides must contain short text role names and labels.']);
            }
        }
        ksort($overrides);

        $uploaded = $request->file('file');
        $this->assertSupportedImportFile($uploaded);
        $sourcePath = $uploaded->getRealPath();
        $sha256 = hash_file('sha256', $sourcePath);
        if (! is_string($sha256)) {
            throw ValidationException::withMessages(['file' => 'The uploaded workbook could not be fingerprinted.']);
        }
        $name = mb_substr(basename(str_replace('\\', '/', $uploaded->getClientOriginalName())), 0, 1000);
        $identityHash = hash('sha256', mb_strtolower(trim($name)));
        $organizationId = $this->context->requireId();
        $userId = (int) $request->user()->id;
        $manualDate = (bool) ($validated['manual_date'] ?? false);
        $correlationId = (string) $request->header('X-Import-Correlation-Id', '');
        if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $correlationId) !== 1) {
            $correlationId = (string) Str::uuid();
        }
        $options = [
            'column_overrides' => $overrides,
            // Persist the boundary so a worker restart cannot regroup committed chunks.
            'source_chunk_rows' => max(100, min(2000, (int) config('import_ingestion.source_chunk_rows', 1000))),
            'correlation_id' => $correlationId,
            'upload_request_bytes' => max(0, (int) $request->server('CONTENT_LENGTH', 0)),
        ];
        $optionsJson = json_encode($options, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE);
        $privateOriginal = null;

        try {
            $result = DB::transaction(function () use (
                $uploaded, $sourcePath, $sha256, $identityHash, $name, $organizationId, $userId,
                $validated, $manualDate, $overrides, $optionsJson, $correlationId, $contentStorage, &$privateOriginal,
            ): array {
                $file = DB::table('import_files')->where('organization_id', $organizationId)
                    ->where('identity_hash', $identityHash)->lockForUpdate()->first();
                if (! $file) {
                    $candidateId = (string) Str::ulid();
                    DB::table('import_files')->insertOrIgnore([
                        'id' => $candidateId,
                        'organization_id' => $organizationId,
                        'original_name' => $name,
                        'media_type' => $uploaded->getClientMimeType(),
                        'size_bytes' => (int) $uploaded->getSize(),
                        'sha256' => $sha256,
                        'identity_hash' => $identityHash,
                        'storage_disk' => 'imports_private',
                        'storage_path' => 'pending',
                        'active_run_id' => null,
                        'archived_at' => null,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);
                    $file = DB::table('import_files')->where('organization_id', $organizationId)
                        ->where('identity_hash', $identityHash)->lockForUpdate()->first();
                }
                abort_unless($file, 503, 'The import record could not be initialized.');
                $fileId = (string) $file->id;

                $matchingRuns = DB::table('import_runs as runs')
                    ->join('import_file_contents as contents', 'contents.import_run_id', '=', 'runs.id')
                    ->where('runs.organization_id', $organizationId)->where('runs.import_file_id', $fileId)
                    ->where('runs.report_date', $validated['report_date'])->where('runs.report_date_is_manual', $manualDate)
                    ->where('contents.sha256', $sha256)->orderByDesc('runs.revision')
                    ->get(['runs.id', 'runs.revision', 'runs.status', 'runs.processing_state', 'runs.processing_options',
                        'runs.mapping_fingerprint', 'runs.source_rows_count', 'runs.accepted_rows_count',
                        'runs.duplicate_rows_count', 'runs.rejected_rows_count', 'runs.issues_count']);
                foreach ($matchingRuns as $matchingRun) {
                    $storedOptions = is_string($matchingRun->processing_options)
                        ? json_decode($matchingRun->processing_options, true)
                        : $matchingRun->processing_options;
                    if (($storedOptions['column_overrides'] ?? []) !== $overrides) {
                        continue;
                    }
                    if (in_array($matchingRun->processing_state, ['queued', 'parsing', 'importing', 'finalizing'], true)) {
                        return [
                            'already_imported' => false,
                            'duplicate_upload' => true,
                            'file_id' => $fileId,
                            'run_id' => (string) $matchingRun->id,
                            'revision' => (int) $matchingRun->revision,
                            'state' => (string) $matchingRun->processing_state,
                            'correlation_id' => (string) (($storedOptions['correlation_id'] ?? null) ?: $matchingRun->id),
                            'counts' => ['source' => (int) $matchingRun->source_rows_count, 'accepted' => (int) $matchingRun->accepted_rows_count,
                                'duplicates' => (int) $matchingRun->duplicate_rows_count, 'rejected' => (int) $matchingRun->rejected_rows_count],
                        ];
                    }
                    if ($matchingRun->status === 'published' && $matchingRun->mapping_fingerprint !== null) {
                        return [
                            'already_imported' => true,
                            'duplicate_upload' => true,
                            'file_id' => $fileId,
                            'run_id' => (string) $matchingRun->id,
                            'revision' => (int) $matchingRun->revision,
                            'state' => 'completed',
                            'correlation_id' => (string) (($storedOptions['correlation_id'] ?? null) ?: $matchingRun->id),
                            'counts' => ['source' => (int) $matchingRun->source_rows_count, 'accepted' => (int) $matchingRun->accepted_rows_count,
                                'duplicates' => (int) $matchingRun->duplicate_rows_count, 'rejected' => (int) $matchingRun->rejected_rows_count,
                                'issues' => (int) $matchingRun->issues_count],
                        ];
                    }
                }

                $revision = (int) DB::table('import_runs')->where('import_file_id', $fileId)
                    ->where('organization_id', $organizationId)->max('revision') + 1;
                $runId = (string) Str::ulid();
                $extension = strtolower($uploaded->getClientOriginalExtension());
                $stored = $contentStorage->storePrivateOriginal($sourcePath, $organizationId, $runId, $extension, $sha256);
                $privateOriginal = ['disk' => $stored['disk'], 'path' => $stored['path']];
                $now = now();

                DB::table('import_files')->where('id', $fileId)->where('organization_id', $organizationId)->update([
                    'original_name' => $name,
                    'media_type' => $uploaded->getClientMimeType(),
                    'size_bytes' => $stored['bytes'],
                    'sha256' => $stored['sha256'],
                    'storage_disk' => $stored['disk'],
                    'storage_path' => $stored['path'],
                    'archived_at' => null,
                    'updated_at' => $now,
                ]);
                DB::table('import_runs')->insert([
                    'id' => $runId,
                    'organization_id' => $organizationId,
                    'import_file_id' => $fileId,
                    'uploaded_by' => $userId,
                    'revision' => $revision,
                    'mapping_version' => 1,
                    'mapping_fingerprint' => null,
                    'processing_options' => $optionsJson,
                    'duplicate_policy' => 'preserve_and_mark',
                    'report_date' => $validated['report_date'],
                    'report_date_is_manual' => $manualDate,
                    'report_timezone' => config('app.timezone'),
                    'status' => 'importing',
                    'processing_state' => 'uploaded',
                    'source_rows_count' => 0,
                    'accepted_rows_count' => 0,
                    'duplicate_rows_count' => 0,
                    'rejected_rows_count' => 0,
                    'issues_count' => 0,
                    'processed_source_rows' => 0,
                    'total_source_rows' => null,
                    'queued_at' => null,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
                $contentId = (string) Str::ulid();
                DB::table('import_file_contents')->insert([
                    'id' => $contentId,
                    'organization_id' => $organizationId,
                    'import_file_id' => $fileId,
                    'import_run_id' => $runId,
                    'media_type' => $uploaded->getClientMimeType(),
                    'sha256' => $stored['sha256'],
                    'contents' => null,
                    'storage_disk' => $stored['disk'],
                    'storage_path' => $stored['path'],
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
                ProcessImportWorkbook::dispatch($organizationId, $fileId, $runId)->onQueue('imports');
                DB::table('import_runs')->where('id', $runId)->update([
                    'processing_state' => 'queued',
                    'queued_at' => $now,
                    'updated_at' => $now,
                ]);

                return [
                    'already_imported' => false,
                    'duplicate_upload' => false,
                    'file_id' => $fileId,
                    'run_id' => $runId,
                    'revision' => $revision,
                    'state' => 'queued',
                    'correlation_id' => $correlationId,
                    'counts' => ['source' => 0, 'accepted' => 0, 'duplicates' => 0, 'rejected' => 0],
                ];
            }, 3);
        } catch (\Throwable $exception) {
            if ($privateOriginal !== null) {
                $contentStorage->deletePrivateOriginal($privateOriginal['disk'], $privateOriginal['path']);
            }
            throw $exception;
        }

        if (! $result['duplicate_upload']) {
            $audit->record($request->user(), 'import.started', 'import_file', $result['file_id'], ['status' => $result['state']]);
        }

        return $this->success($result, $result['already_imported'] ? 200 : 202);
    }

    public function jobs(string $organization, AuthorizationService $authorization, Request $request): JsonResponse
    {
        abort_unless($authorization->hasPermission($request->user(), 'imports.manage'), 403);
        $organizationId = $this->context->requireId();
        $runs = DB::table('import_runs as runs')->join('import_files as files', function ($join): void {
            $join->on('files.id', '=', 'runs.import_file_id')->on('files.organization_id', '=', 'runs.organization_id');
        })->where('runs.organization_id', $organizationId)->orderByDesc('runs.created_at')->limit(30)
            ->get(['runs.id', 'runs.import_file_id', 'runs.revision', 'runs.report_date', 'runs.processing_state',
                'runs.processing_error_code', 'runs.processing_error', 'runs.processed_source_rows', 'runs.total_source_rows',
                'runs.source_rows_count', 'runs.accepted_rows_count', 'runs.duplicate_rows_count', 'runs.rejected_rows_count',
                'runs.processing_metrics', 'runs.processing_completed_at', 'runs.created_at', 'files.original_name']);

        return $this->success(['jobs' => $runs->map(static fn ($run): array => [
            'run_id' => (string) $run->id,
            'file_id' => (string) $run->import_file_id,
            'revision' => (int) $run->revision,
            'name' => (string) $run->original_name,
            'report_date' => $run->report_date,
            'state' => (string) $run->processing_state,
            'error_code' => $run->processing_error_code,
            'error' => $run->processing_error,
            'processed_rows' => (int) $run->processed_source_rows,
            'total_rows' => $run->total_source_rows === null ? null : (int) $run->total_source_rows,
            'counts' => ['source' => (int) $run->source_rows_count, 'accepted' => (int) $run->accepted_rows_count,
                'duplicates' => (int) $run->duplicate_rows_count, 'rejected' => (int) $run->rejected_rows_count],
            'metrics' => is_string($run->processing_metrics) ? json_decode($run->processing_metrics, true) : $run->processing_metrics,
            'created_at' => $run->created_at,
            'completed_at' => $run->processing_completed_at,
        ])->all()]);
    }

    public function retry(Request $request, string $organization, string $importFile, string $run): JsonResponse
    {
        abort_unless(config('queue.default') === 'database' && ! (bool) config('queue.connections.database.after_commit', false), 503,
            'Workbook imports require the transactional database queue connection.');
        $organizationId = $this->context->requireId();
        $result = DB::transaction(function () use ($organizationId, $importFile, $run): array {
            $file = DB::table('import_files')->where('id', $importFile)->where('organization_id', $organizationId)->lockForUpdate()->first();
            abort_unless($file, 404, 'Import file not found.');
            $importRun = DB::table('import_runs')->where('id', $run)->where('import_file_id', $importFile)
                ->where('organization_id', $organizationId)->lockForUpdate()->first();
            abort_unless($importRun && $importRun->processing_state === 'failed', 409, 'Only a failed import can be retried.');
            $content = DB::table('import_file_contents')->where('import_run_id', $run)->where('organization_id', $organizationId)->first();
            abort_unless($content, 409, 'The original workbook reference is missing.');
            $contentStorage = app(ImportFileContentStorage::class);
            $resolved = $contentStorage->resolveForProcessing($content);
            if ($resolved['temporary'] && is_file($resolved['path'])) {
                @unlink($resolved['path']);
            }

            $now = now();
            DB::table('import_runs')->where('id', $run)->where('organization_id', $organizationId)->update([
                'processing_state' => 'queued',
                'processing_error_code' => null,
                'processing_error' => null,
                'queued_at' => $now,
                'finished_at' => null,
                'finalizing_at' => null,
                'processing_completed_at' => null,
                'updated_at' => $now,
            ]);
            ProcessImportWorkbook::dispatch($organizationId, $importFile, $run)->onQueue('imports');

            return ['file_id' => $importFile, 'run_id' => $run, 'state' => 'queued'];
        }, 3);

        return $this->success($result, 202);
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
            'dateMs' => $this->shipmentDateMilliseconds($shipmentDate),
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
            'pickedUpDate' => $row->picked_up_date,
            'receivedTime' => $row->received_time,
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
            'dateMs' => $this->shipmentDateMilliseconds($shipmentDate),
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

    private function shipmentDateMilliseconds(string $date): int
    {
        return $date === '' ? 0 : ($this->dateMilliseconds[$date] ??= Carbon::parse($date)->startOfDay()->getTimestampMs());
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
            'id' => (string) Str::ulid(),
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

    private function assertSupportedImportFile(UploadedFile $file): void
    {
        $extension = strtolower($file->getClientOriginalExtension());
        $handle = fopen($file->getRealPath(), 'rb');
        $signature = $handle === false ? '' : (fread($handle, 16) ?: '');
        if ($handle !== false) {
            fclose($handle);
        }

        $isZipWorkbook = str_starts_with($signature, "PK\x03\x04");
        $isLegacyWorkbook = str_starts_with($signature, "\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1");
        $isDelimitedText = ! str_contains($signature, "\0")
            && preg_match('/[,;\t\r\n]/', $signature) === 1;

        $supported = match ($extension) {
            'xlsx' => $isZipWorkbook,
            'xls' => $isLegacyWorkbook,
            // Some Bosta exports are OpenXML workbooks saved with a .csv filename.
            'csv' => $isZipWorkbook || $isLegacyWorkbook || $isDelimitedText,
            default => false,
        };

        if (! $supported) {
            throw ValidationException::withMessages([
                'file' => 'Upload a valid Excel workbook (.xlsx or .xls) or a delimited CSV file.',
            ]);
        }
    }
}
