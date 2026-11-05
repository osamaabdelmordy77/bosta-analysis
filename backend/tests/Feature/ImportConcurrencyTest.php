<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

class ImportConcurrencyTest extends TestCase
{
    public function test_two_files_concurrently_resolve_the_same_shipment_business_and_hub(): void
    {
        if (! function_exists('proc_open') || DB::connection()->getDriverName() !== 'mysql'
            || ! Schema::hasColumn('import_chunks', 'payload_sha256')) {
            self::markTestSkipped('The concurrent import smoke test requires the migrated isolated MariaDB test database and proc_open.');
        }
        self::assertStringEndsWith('_test', DB::connection()->getDatabaseName(), 'Concurrent import writes must stay on a dedicated test database.');

        $organizationId = (string) Str::ulid();
        $now = now();
        DB::table('organizations')->insert([
            'id' => $organizationId,
            'name' => 'Synthetic Concurrent Import Test',
            'slug' => 'synthetic-concurrent-'.Str::lower(Str::random(10)),
            'timezone' => 'Africa/Cairo',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $headers = ['Tracking Number', 'Business', 'Business ID', 'Current Hub'];
        $imports = [];
        foreach (['a', 'b'] as $suffix) {
            $fileId = (string) Str::ulid();
            $fileName = "concurrent-$suffix.xlsx";
            DB::table('import_files')->insert([
                'id' => $fileId,
                'organization_id' => $organizationId,
                'original_name' => $fileName,
                'media_type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'size_bytes' => 1,
                'sha256' => hash('sha256', $fileName),
                'identity_hash' => hash('sha256', $fileName),
                'storage_disk' => 'private',
                'storage_path' => "synthetic/$fileName",
                'active_run_id' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            $runId = (string) Str::ulid();
            DB::table('import_runs')->insert([
                'id' => $runId,
                'organization_id' => $organizationId,
                'import_file_id' => $fileId,
                'revision' => 1,
                'mapping_version' => 1,
                'mapping_fingerprint' => hash('sha256', 'concurrent-map-'.$suffix),
                'duplicate_policy' => 'preserve_and_mark',
                'report_date' => '2026-11-05',
                'report_timezone' => 'Africa/Cairo',
                'status' => 'importing',
                'started_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            $sheetId = (string) Str::ulid();
            DB::table('import_sheets')->insert([
                'id' => $sheetId,
                'organization_id' => $organizationId,
                'import_run_id' => $runId,
                'source_sheet_index' => 0,
                'source_sheet_name' => 'Synthetic concurrent sheet',
                'source_headers' => json_encode($headers, JSON_THROW_ON_ERROR),
                'header_row_number' => 1,
                'data_rows_count' => 0,
                'detected_columns_count' => count($headers),
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            $imports[] = ['file' => $fileId, 'run' => $runId, 'sheet' => $sheetId];
        }

        $barrier = base_path('.local/import-concurrency/'.Str::lower(Str::random(20)));
        if (! is_dir($barrier) && ! mkdir($barrier, 0777, true) && ! is_dir($barrier)) {
            self::fail('Could not create the isolated E-drive concurrency barrier directory.');
        }

        $workerPath = base_path('tests/Fixtures/import_concurrency_worker.php');
        $temporaryDirectory = base_path('.local/phase2-mariadb/tmp');
        $processes = [];
        foreach ($imports as $index => $import) {
            $worker = $index === 0 ? 'a' : 'b';
            $command = [
                PHP_BINARY,
                '-d',
                'sys_temp_dir='.$temporaryDirectory,
                $workerPath,
                $organizationId,
                $import['file'],
                $import['run'],
                $import['sheet'],
                $barrier,
                $worker,
            ];
            $pipes = [];
            $process = proc_open($command, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, base_path());
            self::assertIsResource($process, 'Could not start an isolated concurrent import worker.');
            fclose($pipes[0]);
            $processes[] = ['process' => $process, 'pipes' => $pipes];
        }

        $readyDeadline = microtime(true) + 30;
        while ((! is_file($barrier.'/ready-a') || ! is_file($barrier.'/ready-b')) && microtime(true) < $readyDeadline) {
            usleep(10000);
        }
        $bothWorkersReady = is_file($barrier.'/ready-a') && is_file($barrier.'/ready-b');
        file_put_contents($barrier.'/start', 'start');
        self::assertTrue($bothWorkersReady, 'Both isolated import workers must reach the start barrier.');

        $workerResults = [];
        foreach ($processes as $entry) {
            $stdout = stream_get_contents($entry['pipes'][1]);
            $stderr = stream_get_contents($entry['pipes'][2]);
            fclose($entry['pipes'][1]);
            fclose($entry['pipes'][2]);
            $exitCode = proc_close($entry['process']);
            self::assertSame(0, $exitCode, trim((string) $stderr));
            $decoded = json_decode(trim((string) $stdout), true);
            self::assertSame(JSON_ERROR_NONE, json_last_error(), 'Worker returned invalid JSON: '.trim((string) $stdout).' '.trim((string) $stderr));
            $workerResults[] = $decoded;
        }

        foreach ($workerResults as $result) {
            self::assertSame(1, $result['accepted']);
            self::assertSame(0, $result['duplicates']);
            self::assertFalse($result['already_processed']);
        }

        self::assertSame(1, DB::table('shipments')->where('organization_id', $organizationId)->count());
        self::assertSame(1, DB::table('businesses')->where('organization_id', $organizationId)->count());
        self::assertSame(1, DB::table('hubs')->where('organization_id', $organizationId)->count());
        self::assertSame(1, DB::table('hub_aliases')->where('organization_id', $organizationId)->count());
        self::assertSame(2, DB::table('shipment_snapshots')->where('organization_id', $organizationId)->count());
        self::assertSame(2, DB::table('import_source_rows')->where('organization_id', $organizationId)->count());
    }
}
