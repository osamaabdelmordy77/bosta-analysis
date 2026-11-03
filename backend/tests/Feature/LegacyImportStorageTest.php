<?php

namespace Tests\Feature;

use App\Models\User;
use App\Security\RoleCatalog;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

class LegacyImportStorageTest extends TestCase
{
    use DatabaseTransactions;

    public function test_legacy_rows_are_retry_safe_and_verified_before_marking_migration_complete(): void
    {
        if (DB::connection()->getDriverName() !== 'mysql' || ! Schema::hasTable('legacy_import_records')) {
            self::markTestSkipped('Run legacy import integration tests against the migrated MySQL test database.');
        }

        $organizationId = (string) Str::ulid();
        $now = now();
        $slug = 'legacy-import-'.Str::lower(Str::random(8));
        DB::table('organizations')->insert([
            'id' => $organizationId,
            'name' => 'Synthetic Legacy Import Test',
            'slug' => $slug,
            'timezone' => 'Africa/Cairo',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        app(RoleCatalog::class)->syncOrganization($organizationId);

        $user = User::query()->create([
            'name' => 'Synthetic Legacy Admin',
            'email' => 'legacy-'.Str::lower(Str::random(10)).'@example.test',
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

        $base = '/api/organizations/'.$slug.'/legacy-import-files';
        $metadata = [
            'legacy_key' => hash('sha256', 'synthetic-legacy-file'),
            'original_name' => 'legacy-summary.xlsx',
            'size_bytes' => 1200,
            'detected_date' => '2026-10-31',
            'manual_date' => false,
            'record_count' => 2,
            'duplicate_count' => 1,
            'sheets_count' => 1,
            'uploaded_at_ms' => now()->getTimestampMs(),
        ];
        $start = $this->postJson($base, $metadata)->assertOk()
            ->assertJsonPath('data.migration_status', 'migrating');
        $fileId = $start->json('data.id');
        $this->postJson($base, $metadata)->assertOk()->assertJsonPath('data.id', $fileId);

        $this->postJson($base.'/'.$fileId.'/chunks/0', [
            'records' => [
                ['id' => 'old-file-tracking-1', 'shipmentDate' => '2026-10-31', 'tracking' => 'TRACK-OLD-1', 'items' => 2],
                ['id' => 'old-file-tracking-2', 'shipmentDate' => '2026-10-31', 'tracking' => 'TRACK-OLD-2', 'items' => 1],
            ],
        ])->assertOk()->assertJsonPath('data.received', 2)->assertJsonPath('data.inserted', 2);
        $this->postJson($base.'/'.$fileId.'/chunks/0', [
            'records' => [
                ['id' => 'old-file-tracking-1', 'shipmentDate' => '2026-10-31', 'tracking' => 'TRACK-OLD-1', 'items' => 2],
                ['id' => 'old-file-tracking-2', 'shipmentDate' => '2026-10-31', 'tracking' => 'TRACK-OLD-2', 'items' => 1],
            ],
        ])->assertOk()->assertJsonPath('data.inserted', 0);

        $this->postJson($base.'/'.$fileId.'/complete', [])->assertOk()
            ->assertJsonPath('data.migration_status', 'completed')
            ->assertJsonPath('data.records', 2);
        $this->getJson('/api/organizations/'.$slug.'/imports/shipments?source=legacy')
            ->assertOk()->assertJsonCount(2, 'data.shipments');
        $this->assertDatabaseHas('legacy_import_files', [
            'id' => $fileId,
            'organization_id' => $organizationId,
            'migration_status' => 'completed',
            'record_count' => 2,
        ]);
    }
}
