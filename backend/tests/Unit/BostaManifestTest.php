<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

class BostaManifestTest extends TestCase
{
    public function test_manifest_and_migration_mapping_cover_all_211_columns(): void
    {
        $backend = dirname(__DIR__, 2);
        $root = dirname($backend);
        $manifest = json_decode(file_get_contents($root.'/docs/phase-00/bosta_211_column_manifest.json'), true, 512, JSON_THROW_ON_ERROR);
        $migrationMapping = json_decode(file_get_contents($backend.'/database/schema/bosta_columns_v1.json'), true, 512, JSON_THROW_ON_ERROR);
        $runtimeMapping = json_decode(file_get_contents($backend.'/config/bosta_columns.json'), true, 512, JSON_THROW_ON_ERROR);

        self::assertCount(211, $manifest);
        self::assertSame($manifest, $migrationMapping);
        self::assertSame($manifest, $runtimeMapping);
        self::assertCount(211, array_unique(array_column($manifest, 'source_number')));
        self::assertCount(211, array_unique(array_column($manifest, 'source_label')));

        $counts = [];
        foreach ($manifest as $column) {
            $counts[$column['table']] = ($counts[$column['table']] ?? 0) + 1;
        }

        self::assertSame([
            'shipment_snapshots' => 49,
            'shipment_snapshot_parties' => 22,
            'shipment_snapshot_financials' => 24,
            'shipment_snapshot_routing' => 22,
            'shipment_snapshot_service' => 22,
            'delivery_attempts' => 72,
        ], $counts);
    }

    public function test_attempt_fields_define_nine_complete_groups(): void
    {
        $mapping = json_decode(file_get_contents(dirname(__DIR__, 2).'/database/schema/bosta_columns_v1.json'), true, 512, JSON_THROW_ON_ERROR);
        $attempts = array_values(array_filter($mapping, fn (array $column): bool => $column['table'] === 'delivery_attempts'));
        $groups = [];

        foreach ($attempts as $column) {
            $groups[$column['group']][] = $column['physical_column'];
        }

        self::assertSame(range(0, 8), array_keys($groups));
        foreach ($groups as $fields) {
            self::assertCount(8, $fields);
            self::assertCount(8, array_unique($fields));
        }

        self::assertCount(8, array_unique(array_column($attempts, 'physical_column')));
    }

    public function test_golden_dataset_keeps_duplicate_and_empty_items_policies_explicit(): void
    {
        $golden = json_decode(file_get_contents(dirname(dirname(__DIR__, 2)).'/docs/phase-00/golden_dataset.json'), true, 512, JSON_THROW_ON_ERROR);

        self::assertSame(7, $golden['identityFacts']['validTrackedSourceOccurrences']);
        self::assertSame(4, $golden['identityFacts']['uniqueTrackingValuesAcrossReports']);
        self::assertSame(7, $golden['goldenMetricsByExplicitPolicy']['countEveryTrackedSourceOccurrence']['reportObservations']);
        self::assertSame(5, $golden['goldenMetricsByExplicitPolicy']['firstOccurrencePerImportRun']['reportObservations']);
        self::assertContains('Items', $golden['edgeCases']['missingValues']);
    }
}
