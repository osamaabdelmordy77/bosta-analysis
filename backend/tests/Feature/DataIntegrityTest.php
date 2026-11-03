<?php

namespace Tests\Feature;

use App\Models\ImportRun;
use App\Models\PublishedShipmentSnapshot;
use App\Models\Shipment;
use App\Models\ShipmentSnapshot;
use App\Tenancy\OrganizationContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

class DataIntegrityTest extends TestCase
{
    use DatabaseTransactions;

    private string $organizationId;

    private string $shipmentId;

    private string $runId;

    private string $sheetId;

    private string $chunkId;

    private string $sourceRowId;

    private string $snapshotId;

    private string $now;

    private array $sourceRow;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'mysql' || ! Schema::hasTable('shipment_snapshots')) {
            self::markTestSkipped('Run this integration test against the migrated MySQL test database.');
        }

        $this->now = now()->toDateTimeString();
        $this->organizationId = $this->createOrganization('data-integrity-a');
        $this->createMember($this->organizationId, 'data-integrity-a@example.test');

        $fileId = (string) Str::ulid();
        DB::table('import_files')->insert([
            'id' => $fileId,
            'organization_id' => $this->organizationId,
            'original_name' => 'synthetic.xlsx',
            'media_type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'size_bytes' => 1024,
            'sha256' => hash('sha256', 'synthetic workbook'),
            'storage_disk' => 'private',
            'storage_path' => 'imports/test/synthetic.xlsx',
            'active_run_id' => null,
            'created_at' => $this->now,
            'updated_at' => $this->now,
        ]);

        $this->runId = (string) Str::ulid();
        DB::table('import_runs')->insert([
            'id' => $this->runId,
            'organization_id' => $this->organizationId,
            'import_file_id' => $fileId,
            'revision' => 1,
            'mapping_version' => 1,
            'duplicate_policy' => 'review',
            'report_date' => '2026-09-28',
            'report_timezone' => 'Africa/Cairo',
            'status' => 'completed',
            'source_rows_count' => 3,
            'accepted_rows_count' => 2,
            'duplicate_rows_count' => 0,
            'rejected_rows_count' => 1,
            'issues_count' => 1,
            'started_at' => $this->now,
            'finished_at' => $this->now,
            'published_at' => null,
            'created_at' => $this->now,
            'updated_at' => $this->now,
        ]);
        DB::table('import_files')->where('id', $fileId)->update(['active_run_id' => $this->runId]);

        $this->sheetId = (string) Str::ulid();
        DB::table('import_sheets')->insert([
            'id' => $this->sheetId,
            'organization_id' => $this->organizationId,
            'import_run_id' => $this->runId,
            'source_sheet_index' => 0,
            'source_sheet_name' => 'Deliveries',
            'header_row_number' => 1,
            'data_rows_count' => 3,
            'detected_columns_count' => 207,
            'created_at' => $this->now,
            'updated_at' => $this->now,
        ]);

        $this->chunkId = (string) Str::ulid();
        DB::table('import_chunks')->insert([
            'id' => $this->chunkId,
            'organization_id' => $this->organizationId,
            'import_run_id' => $this->runId,
            'import_sheet_id' => $this->sheetId,
            'chunk_index' => 0,
            'first_source_row' => 2,
            'last_source_row' => 4,
            'status' => 'completed',
            'attempts' => 1,
            'rows_processed' => 3,
            'issues_count' => 1,
            'started_at' => $this->now,
            'finished_at' => $this->now,
            'created_at' => $this->now,
            'updated_at' => $this->now,
        ]);

        $rawCells = [];
        foreach (config('bosta_columns') as $column) {
            $rawCells[$column['source_number']] = null;
        }
        $rawCells[3] = '00001234';
        $rawCells[5] = '2026-09-28 11:22:33.123456';
        $rawCells[25] = '1234.5678';
        $rawCells[84] = null;
        $this->sourceRow = [
            'id' => (string) Str::ulid(),
            'organization_id' => $this->organizationId,
            'import_run_id' => $this->runId,
            'import_sheet_id' => $this->sheetId,
            'import_chunk_id' => $this->chunkId,
            'source_row_number' => 2,
            'source_values' => json_encode($rawCells, JSON_THROW_ON_ERROR),
            'status' => 'accepted',
            'issues_count' => 0,
            'processed_at' => $this->now,
            'created_at' => $this->now,
            'updated_at' => $this->now,
        ];
        $this->sourceRowId = $this->sourceRow['id'];
        DB::table('import_source_rows')->insert($this->sourceRow);

        $fingerprint = hash_hmac('sha256', $this->organizationId.'|00001234', 'phase01-test-key', true);
        $this->shipmentId = (string) Str::ulid();
        DB::table('shipments')->insert([
            'id' => $this->shipmentId,
            'organization_id' => $this->organizationId,
            'tracking_fingerprint' => $fingerprint,
            'created_at' => $this->now,
            'updated_at' => $this->now,
        ]);

        $this->snapshotId = $this->createSnapshot($this->sourceRowId, $this->shipmentId, '00001234');
    }

    protected function tearDown(): void
    {
        app(OrganizationContext::class)->clear();

        parent::tearDown();
    }

    public function test_source_values_round_trip_tracking_dates_money_and_nulls_and_all_attempt_groups(): void
    {
        $snapshot = DB::table('shipment_snapshots')->where('id', $this->snapshotId)->first();
        self::assertSame('00001234', $snapshot->tracking_number);
        self::assertSame('2026-09-28 11:22:33.123456', $snapshot->source_created_at);
        self::assertNull($snapshot->items);

        $rawValues = json_decode(DB::table('import_source_rows')->where('id', $this->sourceRowId)->value('source_values'), true, 512, JSON_THROW_ON_ERROR);
        self::assertCount(211, $rawValues);
        self::assertSame('00001234', $rawValues[3]);
        self::assertSame('2026-09-28 11:22:33.123456', $rawValues[5]);
        self::assertSame('1234.5678', $rawValues[25]);
        self::assertNull($rawValues[84]);

        DB::table('shipment_snapshot_financials')->insert([
            'id' => (string) Str::ulid(),
            'organization_id' => $this->organizationId,
            'shipment_snapshot_id' => $this->snapshotId,
            'cod_amount' => '1234.5678',
            'created_at' => $this->now,
            'updated_at' => $this->now,
        ]);
        $amount = DB::table('shipment_snapshot_financials')->where('shipment_snapshot_id', $this->snapshotId)->value('cod_amount');
        self::assertSame('1234.5678', rtrim(rtrim((string) $amount, '0'), '.'));

        foreach (range(0, 8) as $attemptIndex) {
            DB::table('delivery_attempts')->insert([
                'id' => (string) Str::ulid(),
                'organization_id' => $this->organizationId,
                'shipment_snapshot_id' => $this->snapshotId,
                'attempt_index' => $attemptIndex,
                'created_at' => $this->now,
                'updated_at' => $this->now,
            ]);
        }

        self::assertSame(9, DB::table('delivery_attempts')->where('shipment_snapshot_id', $this->snapshotId)->count());

        $this->expectException(QueryException::class);
        DB::table('delivery_attempts')->insert([
            'id' => (string) Str::ulid(),
            'organization_id' => $this->organizationId,
            'shipment_snapshot_id' => $this->snapshotId,
            'attempt_index' => 9,
            'created_at' => $this->now,
            'updated_at' => $this->now,
        ]);
    }

    public function test_idempotency_keys_allow_repeated_tracking_but_reject_replayed_source_rows(): void
    {
        $duplicateRow = $this->sourceRow;
        $duplicateRow['id'] = (string) Str::ulid();

        try {
            DB::table('import_source_rows')->insert($duplicateRow);
            self::fail('A repeated run/sheet/row must be rejected by the idempotency constraint.');
        } catch (QueryException) {
            self::assertTrue(true);
        }

        $secondRow = $this->sourceRow;
        $secondRow['id'] = (string) Str::ulid();
        $secondRow['source_row_number'] = 3;
        DB::table('import_source_rows')->insert($secondRow);
        $secondSnapshotId = $this->createSnapshot($secondRow['id'], $this->shipmentId, '00001234');

        self::assertSame(2, DB::table('shipment_snapshots')->where('shipment_id', $this->shipmentId)->count());
        self::assertSame('00001234', DB::table('shipment_snapshots')->where('id', $secondSnapshotId)->value('tracking_number'));
    }

    public function test_incomplete_or_inactive_runs_are_not_visible_in_the_official_report_view(): void
    {
        self::assertSame(0, DB::table('published_shipment_snapshots')->count());

        DB::table('import_runs')->where('id', $this->runId)->update([
            'status' => 'published',
            'published_at' => $this->now,
        ]);
        self::assertSame(1, DB::table('published_shipment_snapshots')->count());
        app(OrganizationContext::class)->set($this->organizationId);
        self::assertSame(1, PublishedShipmentSnapshot::query()->count());
        app(OrganizationContext::class)->clear();
        self::assertSame(0, PublishedShipmentSnapshot::query()->count());

        DB::table('import_files')->where('active_run_id', $this->runId)->update(['active_run_id' => null]);
        self::assertSame(0, DB::table('published_shipment_snapshots')->count());
    }

    public function test_eloquent_relations_preserve_the_import_to_historical_snapshot_chain(): void
    {
        app(OrganizationContext::class)->set($this->organizationId);

        $snapshot = ShipmentSnapshot::with(['shipment', 'run.file', 'sourceRow.sheet'])->findOrFail($this->snapshotId);

        self::assertSame($this->shipmentId, $snapshot->shipment->id);
        self::assertSame($this->runId, $snapshot->run->id);
        self::assertSame('synthetic.xlsx', $snapshot->run->file->original_name);
        self::assertSame($this->sourceRowId, $snapshot->sourceRow->id);
        self::assertSame($this->sheetId, $snapshot->sourceRow->sheet->id);
        self::assertSame(1, ImportRun::with('sheets')->findOrFail($this->runId)->sheets->count());
    }

    public function test_tenant_scope_fails_closed_and_foreign_keys_reject_cross_organization_links(): void
    {
        $tenantB = $this->createOrganization('data-integrity-b');
        $fingerprint = hash_hmac('sha256', $tenantB.'|00001234', 'phase01-test-key', true);
        $shipmentB = (string) Str::ulid();
        DB::table('shipments')->insert([
            'id' => $shipmentB,
            'organization_id' => $tenantB,
            'tracking_fingerprint' => $fingerprint,
            'created_at' => $this->now,
            'updated_at' => $this->now,
        ]);

        $anotherSourceRow = $this->sourceRow;
        $anotherSourceRow['id'] = (string) Str::ulid();
        $anotherSourceRow['source_row_number'] = 4;
        DB::table('import_source_rows')->insert($anotherSourceRow);

        try {
            $this->createSnapshot($anotherSourceRow['id'], $shipmentB, '00001234');
            self::fail('A snapshot must not point at another organization\'s shipment identity.');
        } catch (QueryException) {
            self::assertTrue(true);
        }

        app(OrganizationContext::class)->clear();
        self::assertSame(0, Shipment::query()->count());

        app(OrganizationContext::class)->set($this->organizationId);
        self::assertSame(1, Shipment::query()->count());
        self::assertSame(1, ShipmentSnapshot::query()->count());
    }

    public function test_identical_hub_aliases_cannot_be_inserted_twice_for_one_hub(): void
    {
        $hubId = (string) Str::ulid();
        DB::table('hubs')->insert([
            'id' => $hubId,
            'organization_id' => $this->organizationId,
            'canonical_name' => 'Synthetic Hub',
            'canonical_name_hash' => hash_hmac('sha256', 'synthetic hub', 'phase01-test-key', true),
            'external_code' => 'HUB-01',
            'external_code_hash' => hash_hmac('sha256', 'HUB-01', 'phase01-test-key', true),
            'created_at' => $this->now,
            'updated_at' => $this->now,
        ]);

        $alias = [
            'organization_id' => $this->organizationId,
            'hub_id' => $hubId,
            'source_name' => 'Warehouse North',
            'source_name_hash' => hash_hmac('sha256', 'warehouse north', 'phase01-test-key', true),
            'created_at' => $this->now,
            'updated_at' => $this->now,
        ];
        DB::table('hub_aliases')->insert($alias);

        $this->expectException(QueryException::class);
        DB::table('hub_aliases')->insert($alias);
    }

    private function createSnapshot(string $sourceRowId, string $shipmentId, string $trackingNumber): string
    {
        $snapshotId = (string) Str::ulid();
        DB::table('shipment_snapshots')->insert([
            'id' => $snapshotId,
            'organization_id' => $this->organizationId,
            'shipment_id' => $shipmentId,
            'import_run_id' => $this->runId,
            'import_source_row_id' => $sourceRowId,
            'tracking_number' => $trackingNumber,
            'business_name' => 'Synthetic Shop',
            'source_created_at' => '2026-09-28 11:22:33.123456',
            'delivered_at' => '2026-09-29 08:00:00.000000',
            'items' => null,
            'created_at' => $this->now,
            'updated_at' => $this->now,
        ]);

        return $snapshotId;
    }

    private function createOrganization(string $slug): string
    {
        $organizationId = (string) Str::ulid();
        DB::table('organizations')->insert([
            'id' => $organizationId,
            'name' => 'Synthetic Test Organization',
            'slug' => $slug,
            'timezone' => 'Africa/Cairo',
            'created_at' => $this->now ?? now()->toDateTimeString(),
            'updated_at' => $this->now ?? now()->toDateTimeString(),
        ]);

        return $organizationId;
    }

    private function createMember(string $organizationId, string $email): void
    {
        $userId = DB::table('users')->insertGetId([
            'name' => 'Synthetic Test User',
            'email' => $email,
            'password' => Hash::make('test-password'),
            'created_at' => $this->now,
            'updated_at' => $this->now,
        ]);

        DB::table('organization_user')->insert([
            'organization_id' => $organizationId,
            'user_id' => $userId,
            'role_id' => null,
            'status' => 'active',
            'created_at' => $this->now,
            'updated_at' => $this->now,
        ]);
    }
}
