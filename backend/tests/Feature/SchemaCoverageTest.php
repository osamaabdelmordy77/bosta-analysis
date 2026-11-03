<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class SchemaCoverageTest extends TestCase
{
    public function test_mysql_schema_contains_each_manifest_column_once(): void
    {
        if (DB::connection()->getDriverName() !== 'mysql' || ! Schema::hasTable('shipment_snapshots')) {
            self::markTestSkipped('Run this integration test against the migrated MySQL test database.');
        }

        $mapping = config('bosta_columns');
        $expectedCounts = [
            'shipment_snapshots' => 49,
            'shipment_snapshot_parties' => 22,
            'shipment_snapshot_routing' => 22,
            'shipment_snapshot_financials' => 24,
            'shipment_snapshot_service' => 22,
            'delivery_attempts' => 8,
        ];

        foreach ($expectedCounts as $table => $count) {
            $sourceFields = array_values(array_unique(array_column(array_filter(
                $mapping,
                fn (array $column): bool => $column['table'] === $table,
            ), 'physical_column')));

            self::assertCount($count, $sourceFields, $table.' manifest count');
            self::assertSame([], array_values(array_diff($sourceFields, Schema::getColumnListing($table))), $table.' missing fields');
        }
    }

    public function test_only_active_published_runs_are_exposed_for_official_reports(): void
    {
        if (DB::connection()->getDriverName() !== 'mysql' || ! Schema::hasView('published_shipment_snapshots')) {
            self::markTestSkipped('Run this integration test against the migrated MySQL test database.');
        }

        $views = DB::select('SHOW CREATE VIEW published_shipment_snapshots');
        $definition = str_replace('`', '', $views[0]->{'Create View'});
        self::assertStringContainsString("runs.status = 'published'", $definition);
        self::assertStringContainsString('files.active_run_id = runs.id', $definition);
    }
}
