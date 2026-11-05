<?php

namespace Tests\Feature;

use App\Models\User;
use App\Imports\ImportIngestionService;
use App\Security\RoleCatalog;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

class ImportStorageTest extends TestCase
{
    use DatabaseTransactions;

    public function test_server_upload_is_queued_processed_published_and_safe_to_reopen_or_repeat(): void
    {
        if (DB::connection()->getDriverName() !== 'mysql' || ! DB::getSchemaBuilder()->hasTable('import_file_contents')) {
            self::markTestSkipped('Run import worker integration tests against the isolated migrated MariaDB test database.');
        }

        config([
            'queue.default' => 'database',
            'queue.connections.database.after_commit' => false,
            'filesystems.disks.imports_private.root' => storage_path('app/private/phase3-tests/imports'),
            'app.timezone' => 'Africa/Cairo',
        ]);
        Storage::forgetDisk('imports_private');

        $organizationId = (string) Str::ulid();
        $slug = 'worker-test-'.Str::lower(Str::random(8));
        $now = now();
        DB::table('organizations')->insert([
            'id' => $organizationId,
            'name' => 'Server Workbook Test',
            'slug' => $slug,
            'timezone' => 'Africa/Cairo',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        app(RoleCatalog::class)->syncOrganization($organizationId);

        $user = User::query()->create([
            'name' => 'Workbook Test Admin',
            'email' => 'worker-'.Str::lower(Str::random(10)).'@example.test',
            'password' => Hash::make(Str::random(40)),
        ]);
        $roleId = (int) DB::table('roles')->where('organization_id', $organizationId)
            ->where('slug', 'organization-admin')->value('id');
        DB::table('organization_user')->insert([
            'organization_id' => $organizationId,
            'user_id' => $user->id,
            'role_id' => $roleId,
            'status' => 'active',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $this->actingAs($user, 'web');

        $manifest = collect(config('bosta_columns'))->sortBy('source_number')->values();
        self::assertCount(211, $manifest);
        $headers = $manifest->pluck('source_label')->all();
        $trackingIndex = $manifest->search(fn (array $column): bool => $column['table'] === 'shipment_snapshots'
            && $column['physical_column'] === 'tracking_number');
        $moneyIndex = $manifest->search(fn (array $column): bool => $column['table'] === 'shipment_snapshot_financials'
            && $column['physical_column'] === 'cod_amount');
        self::assertIsInt($trackingIndex);
        self::assertIsInt($moneyIndex);

        $first = array_fill(0, 211, '');
        $first[$trackingIndex] = '00001234';
        $first[$moneyIndex] = '1234.5678000001';
        $second = $first;
        $sourceRows = [$first, $second];
        $stream = fopen('php://temp', 'w+b');
        fputcsv($stream, $headers, ',', '"', '\\');
        foreach ($sourceRows as $sourceRow) {
            fputcsv($stream, $sourceRow, ',', '"', '\\');
        }
        rewind($stream);
        $csvBytes = stream_get_contents($stream);
        fclose($stream);
        self::assertIsString($csvBytes);

        $testDirectory = storage_path('app/private/phase3-tests/input');
        if (! is_dir($testDirectory)) {
            mkdir($testDirectory, 0700, true);
        }
        $testPath = $testDirectory.'/'.Str::ulid().'.csv';
        $partialPath = null;
        $revisionPaths = [];
        file_put_contents($testPath, $csvBytes);

        try {
            $upload = new UploadedFile($testPath, 'worker-source.csv', 'text/csv', null, true);
            $start = $this->post('/api/organizations/'.$slug.'/imports', [
                'file' => $upload,
                'report_date' => '2026-11-05',
                'manual_date' => '0',
                'column_overrides' => '{}',
            ]);
            $start->assertStatus(202)->assertJsonPath('data.already_imported', false)->assertJsonPath('data.state', 'queued');
            $fileId = $start->json('data.file_id');
            $runId = $start->json('data.run_id');

            self::assertSame(1, DB::table('jobs')->where('queue', 'imports')->count());
            $content = DB::table('import_file_contents')->where('import_run_id', $runId)->first();
            self::assertNotNull($content);
            self::assertNull($content->contents);
            self::assertSame(hash('sha256', $csvBytes), $content->sha256);
            self::assertSame('imports_private', $content->storage_disk);
            self::assertSame(strlen($csvBytes), (int) DB::table('import_files')->where('id', $fileId)->value('size_bytes'));
            self::assertTrue(Storage::disk('imports_private')->exists($content->storage_path));
            self::assertSame($csvBytes, Storage::disk('imports_private')->get($content->storage_path));

            // A fresh page can recover the job state without posting parsed rows again.
            $this->getJson('/api/organizations/'.$slug.'/imports/jobs')
                ->assertOk()->assertJsonPath('data.jobs.0.run_id', $runId)->assertJsonPath('data.jobs.0.state', 'queued');

            $this->artisan('queue:work', [
                'connection' => 'database',
                '--queue' => 'imports',
                '--once' => true,
                '--tries' => 1,
                '--timeout' => 3600,
            ])->assertExitCode(0);

            $run = DB::table('import_runs')->where('id', $runId)->first();
            self::assertSame('completed', $run->processing_state);
            self::assertSame('published', $run->status);
            self::assertSame(2, (int) $run->source_rows_count);
            self::assertSame(1, (int) $run->accepted_rows_count);
            self::assertSame(1, (int) $run->duplicate_rows_count);
            self::assertSame(2, (int) $run->processed_source_rows);
            self::assertSame(2, (int) $run->total_source_rows);
            self::assertSame($runId, DB::table('import_files')->where('id', $fileId)->value('active_run_id'));

            $stored = DB::table('import_source_rows')->where('import_run_id', $runId)->orderBy('source_row_number')->get();
            self::assertCount(2, $stored);
            self::assertSame([2, 3], $stored->pluck('source_row_number')->map(fn ($row): int => (int) $row)->all());
            self::assertSame(['accepted', 'duplicate'], $stored->pluck('status')->all());
            $raw = json_decode($stored[0]->source_values, true, 512, JSON_THROW_ON_ERROR);
            self::assertCount(211, $raw);
            self::assertSame('00001234', $raw[$trackingIndex]);
            self::assertSame('1234.5678000001', $raw[$moneyIndex]);
            self::assertSame(1, DB::table('shipment_snapshots')->where('import_run_id', $runId)->count());
            self::assertSame('completed', DB::table('import_runs')->where('id', $runId)->value('processing_state'));
            $this->getJson('/api/organizations/'.$slug.'/imports/jobs')
                ->assertOk()->assertJsonPath('data.jobs.0.state', 'completed')
                ->assertJsonPath('data.jobs.0.processed_rows', 2);
            $this->getJson('/api/organizations/'.$slug.'/imports/shipments?source=published')
                ->assertOk()->assertJsonPath('data.shipments.0.tracking', '00001234');

            $this->post('/api/organizations/'.$slug.'/imports', [
                'file' => new UploadedFile($testPath, 'worker-source.csv', 'text/csv', null, true),
                'report_date' => '2026-11-05',
                'manual_date' => '0',
                'column_overrides' => '{}',
            ])->assertOk()->assertJsonPath('data.already_imported', true)->assertJsonPath('data.run_id', $runId);
            self::assertSame(0, DB::table('jobs')->where('queue', 'imports')->count());

            $routes = collect(app('router')->getRoutes())->map(fn ($route): string => $route->uri());
            self::assertFalse($routes->contains('api/organizations/{organization}/imports/{importFile}/runs/{run}/sheets/{sheet}/chunks'));
            self::assertFalse($routes->contains('api/organizations/{organization}/imports/{importFile}/runs/{run}/publish'));

            // Commit chunk 0, simulate a worker dying before acknowledgement,
            // restart the queued import, and verify that chunk 0 is replayed once.
            $partialStream = fopen('php://temp', 'w+b');
            fputcsv($partialStream, $headers, ',', '"', '\\');
            for ($rowNumber = 1; $rowNumber <= 401; $rowNumber++) {
                $values = array_fill(0, 211, '');
                $values[$trackingIndex] = sprintf('RETRY-%06d', $rowNumber);
                fputcsv($partialStream, $values, ',', '"', '\\');
            }
            rewind($partialStream);
            $partialBytes = stream_get_contents($partialStream);
            fclose($partialStream);
            self::assertIsString($partialBytes);
            $partialPath = $testDirectory.'/'.Str::ulid().'.csv';
            file_put_contents($partialPath, $partialBytes);
            config(['import_ingestion.worker_tries' => 1]);
            $partialStart = $this->post('/api/organizations/'.$slug.'/imports', [
                'file' => new UploadedFile($partialPath, 'partial-retry.csv', 'text/csv', null, true),
                'report_date' => '2026-11-06',
                'manual_date' => '0',
                'column_overrides' => '{}',
            ]);
            $partialStart->assertStatus(202)->assertJsonPath('data.state', 'queued');
            $partialFileId = $partialStart->json('data.file_id');
            $partialRunId = $partialStart->json('data.run_id');
            $realIngestion = app(ImportIngestionService::class);
            app()->instance(ImportIngestionService::class, new FailAfterFirstCommittedImportChunk());

            $this->artisan('queue:work', [
                'connection' => 'database',
                '--queue' => 'imports',
                '--once' => true,
                '--tries' => 1,
                '--timeout' => 3600,
            ])->assertExitCode(0);

            self::assertSame('failed', DB::table('import_runs')->where('id', $partialRunId)->value('processing_state'));
            self::assertSame(400, (int) DB::table('import_runs')->where('id', $partialRunId)->value('source_rows_count'));
            self::assertSame(400, DB::table('import_source_rows')->where('import_run_id', $partialRunId)->count());
            self::assertSame(1, DB::table('import_chunks')->where('import_run_id', $partialRunId)->where('status', 'completed')->count());

            $this->postJson('/api/organizations/'.$slug.'/imports/'.$partialFileId.'/runs/'.$partialRunId.'/retry', [])
                ->assertStatus(202)->assertJsonPath('data.state', 'queued');
            app()->instance(ImportIngestionService::class, $realIngestion);
            $this->artisan('queue:work', [
                'connection' => 'database',
                '--queue' => 'imports',
                '--once' => true,
                '--tries' => 3,
                '--timeout' => 3600,
            ])->assertExitCode(0);

            self::assertSame('completed', DB::table('import_runs')->where('id', $partialRunId)->value('processing_state'));
            self::assertSame('published', DB::table('import_runs')->where('id', $partialRunId)->value('status'));
            self::assertSame(401, (int) DB::table('import_runs')->where('id', $partialRunId)->value('source_rows_count'));
            self::assertSame(401, (int) DB::table('import_runs')->where('id', $partialRunId)->value('accepted_rows_count'));
            self::assertSame(401, DB::table('import_source_rows')->where('import_run_id', $partialRunId)->count());
            self::assertSame(401, DB::table('shipment_snapshots')->where('import_run_id', $partialRunId)->count());
            self::assertSame(2, DB::table('import_chunks')->where('import_run_id', $partialRunId)->where('status', 'completed')->count());
            self::assertSame($partialRunId, DB::table('import_files')->where('id', $partialFileId)->value('active_run_id'));

            // Queue two different revisions for the same filename. Process the
            // newer revision first, then prove the older worker cannot replace it.
            $revisionStarts = [];
            foreach (['REVISION-OLDER', 'REVISION-NEWER'] as $tracking) {
                $revisionValues = array_fill(0, 211, '');
                $revisionValues[$trackingIndex] = $tracking;
                $revisionStream = fopen('php://temp', 'w+b');
                fputcsv($revisionStream, $headers, ',', '"', '\\');
                fputcsv($revisionStream, $revisionValues, ',', '"', '\\');
                rewind($revisionStream);
                $revisionBytes = stream_get_contents($revisionStream);
                fclose($revisionStream);
                self::assertIsString($revisionBytes);
                $revisionPath = $testDirectory.'/'.Str::ulid().'.csv';
                $revisionPaths[] = $revisionPath;
                file_put_contents($revisionPath, $revisionBytes);
                $revisionStarts[] = $this->post('/api/organizations/'.$slug.'/imports', [
                    'file' => new UploadedFile($revisionPath, 'same-revision.csv', 'text/csv', null, true),
                    'report_date' => '2026-11-07',
                    'manual_date' => '0',
                    'column_overrides' => '{}',
                ])->assertStatus(202);
            }

            $olderRevision = $revisionStarts[0]->json('data');
            $newerRevision = $revisionStarts[1]->json('data');
            self::assertSame($olderRevision['file_id'], $newerRevision['file_id']);
            self::assertNotSame($olderRevision['run_id'], $newerRevision['run_id']);
            self::assertSame(1, $olderRevision['revision']);
            self::assertSame(2, $newerRevision['revision']);
            self::assertSame(2, DB::table('jobs')->where('queue', 'imports')->count());

            app(\App\Imports\ImportWorkbookProcessor::class)->process($organizationId, $newerRevision['file_id'], $newerRevision['run_id']);
            self::assertSame('completed', DB::table('import_runs')->where('id', $newerRevision['run_id'])->value('processing_state'));
            self::assertSame($newerRevision['run_id'], DB::table('import_files')->where('id', $newerRevision['file_id'])->value('active_run_id'));

            try {
                app(\App\Imports\ImportWorkbookProcessor::class)->process($organizationId, $olderRevision['file_id'], $olderRevision['run_id']);
                self::fail('An older revision must not publish after a newer revision has completed.');
            } catch (HttpException $exception) {
                self::assertSame(409, $exception->getStatusCode());
            }
            self::assertSame('importing', DB::table('import_runs')->where('id', $olderRevision['run_id'])->value('status'));
            self::assertSame($newerRevision['run_id'], DB::table('import_files')->where('id', $newerRevision['file_id'])->value('active_run_id'));
        } finally {
            @unlink($testPath);
            if ($partialPath !== null) {
                @unlink($partialPath);
            }
            foreach ($revisionPaths as $revisionPath) {
                @unlink($revisionPath);
            }
            Storage::disk('imports_private')->deleteDirectory($organizationId);
            Storage::forgetDisk('imports_private');
        }
    }
}

class FailAfterFirstCommittedImportChunk extends ImportIngestionService
{
    private bool $failedOnce = false;

    public function ingestChunk(
        string $organizationId,
        string $fileId,
        string $runId,
        string $sheetId,
        int $chunkIndex,
        array $rows,
        array $columnOverrides = [],
    ): array {
        $result = parent::ingestChunk($organizationId, $fileId, $runId, $sheetId, $chunkIndex, $rows, $columnOverrides);
        if (! $this->failedOnce) {
            $this->failedOnce = true;
            throw new \RuntimeException('Synthetic worker crash after a committed import chunk.');
        }

        return $result;
    }
}
