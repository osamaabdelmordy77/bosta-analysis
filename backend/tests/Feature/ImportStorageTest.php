<?php

namespace Tests\Feature;

use App\Models\User;
use App\Security\RoleCatalog;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

class ImportStorageTest extends TestCase
{
    use DatabaseTransactions;

    public function test_original_workbook_and_all_source_values_are_stored_in_mysql_and_published_once(): void
    {
        if (DB::connection()->getDriverName() !== 'mysql' || ! Schema::hasTable('import_file_contents')) {
            self::markTestSkipped('Run import storage integration tests against the migrated MySQL test database.');
        }

        $organizationId = (string) Str::ulid();
        $now = now();
        DB::table('organizations')->insert([
            'id' => $organizationId,
            'name' => 'Synthetic Import Test',
            'slug' => 'synthetic-import-'.Str::lower(Str::random(8)),
            'timezone' => 'Africa/Cairo',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        app(RoleCatalog::class)->syncOrganization($organizationId);

        $user = User::query()->create([
            'name' => 'Synthetic Import Admin',
            'email' => 'import-'.Str::lower(Str::random(10)).'@example.test',
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
        $trackingIndex = array_search('Tracking Number', $headers, true);
        self::assertNotFalse($trackingIndex);

        $firstRow = array_fill(0, 211, null);
        $firstRow[$trackingIndex] = 'TRACK-TEST-0001';
        $secondRow = array_fill(0, 211, null);
        $secondRow[$trackingIndex] = 'TRACK-TEST-0001';
        $workbookBytes = "PK\x03\x04synthetic-xlsx-payload";
        $file = UploadedFile::fake()->createWithContent('synthetic-bosta.xlsx', $workbookBytes)
            ->mimeType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        $organizationSlug = DB::table('organizations')->where('id', $organizationId)->value('slug');
        $start = $this->post('/api/organizations/'.$organizationSlug.'/imports', [
            'file' => $file,
            'report_date' => '2026-11-02',
            'manual_date' => '0',
            'sheets' => json_encode([[
                'index' => 0,
                'name' => 'Deliveries',
                'header_row_number' => 1,
                'headers' => $headers,
            ]], JSON_THROW_ON_ERROR),
            'column_overrides' => '{}',
        ]);
        $start->assertOk()->assertJsonPath('data.already_imported', false);
        $fileId = $start->json('data.file_id');
        $runId = $start->json('data.run_id');
        $sheetId = $start->json('data.sheet_ids.0');

        $this->assertDatabaseHas('import_file_contents', [
            'organization_id' => $organizationId,
            'import_file_id' => $fileId,
            'import_run_id' => $runId,
            'sha256' => hash('sha256', $workbookBytes),
        ]);
        self::assertSame($workbookBytes, DB::table('import_file_contents')->where('import_run_id', $runId)->value('contents'));

        $chunk = [
            'chunk_index' => 0,
            'rows' => [
                ['source_row_number' => 2, 'values' => $firstRow],
                ['source_row_number' => 3, 'values' => $secondRow],
            ],
            'column_overrides' => [],
        ];
        $chunkPath = '/api/organizations/'.$organizationSlug.'/imports/'.$fileId.'/runs/'.$runId.'/sheets/'.$sheetId.'/chunks';
        $this->postJson($chunkPath, $chunk)->assertOk()
            ->assertJsonPath('data.rows_processed', 2)
            ->assertJsonPath('data.accepted', 1)
            ->assertJsonPath('data.duplicates', 1);
        $this->postJson($chunkPath, $chunk)->assertOk()->assertJsonPath('data.already_processed', true);

        self::assertSame(211, count(json_decode(
            DB::table('import_source_rows')->where('import_run_id', $runId)->where('source_row_number', 2)->value('source_values'),
            true,
            512,
            JSON_THROW_ON_ERROR,
        )));
        self::assertSame('duplicate', DB::table('import_source_rows')->where('import_run_id', $runId)->where('source_row_number', 3)->value('status'));
        self::assertSame(1, DB::table('shipment_snapshots')->where('import_run_id', $runId)->count());

        $this->postJson('/api/organizations/'.$organizationSlug.'/imports/'.$fileId.'/runs/'.$runId.'/publish', [])
            ->assertOk()->assertJsonPath('data.counts.accepted', 1)->assertJsonPath('data.counts.duplicates', 1);
        $this->getJson('/api/organizations/'.$organizationSlug.'/imports/shipments?source=published')
            ->assertOk()->assertJsonPath('data.shipments.0.tracking', 'TRACK-TEST-0001');

        $sameFile = UploadedFile::fake()->createWithContent('synthetic-bosta.xlsx', $workbookBytes)
            ->mimeType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        $retry = $this->post('/api/organizations/'.$organizationSlug.'/imports', [
            'file' => $sameFile,
            'report_date' => '2026-11-02',
            'manual_date' => '0',
            'sheets' => json_encode([['index' => 0, 'name' => 'Deliveries', 'headers' => $headers]], JSON_THROW_ON_ERROR),
        ]);
        $retry->assertOk()->assertJsonPath('data.already_imported', true)->assertJsonPath('data.file_id', $fileId);
    }
}
