<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            CREATE OR REPLACE SQL SECURITY INVOKER VIEW published_shipment_snapshots AS
            SELECT snapshots.*
            FROM shipment_snapshots AS snapshots
            INNER JOIN import_runs AS runs
                ON runs.id = snapshots.import_run_id
                AND runs.organization_id = snapshots.organization_id
            INNER JOIN import_files AS files
                ON files.id = runs.import_file_id
                AND files.organization_id = runs.organization_id
                AND files.active_run_id = runs.id
            WHERE runs.status = 'published'
                AND runs.published_at IS NOT NULL
            SQL);
    }

    public function down(): void
    {
        DB::statement('DROP VIEW IF EXISTS published_shipment_snapshots');
    }
};
