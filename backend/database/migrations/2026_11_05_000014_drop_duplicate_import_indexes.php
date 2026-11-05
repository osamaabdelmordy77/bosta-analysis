<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('businesses', function (Blueprint $table): void {
            $table->dropIndex('businesses_organization_id_external_id_hash_index');
        });

        Schema::table('shipment_snapshots', function (Blueprint $table): void {
            $table->dropIndex('snapshots_shipment_history_index');
        });
    }

    public function down(): void
    {
        Schema::table('shipment_snapshots', function (Blueprint $table): void {
            $table->index(['organization_id', 'shipment_id', 'import_run_id'], 'snapshots_shipment_history_index');
        });

        Schema::table('businesses', function (Blueprint $table): void {
            $table->index(['organization_id', 'external_id_hash'], 'businesses_organization_id_external_id_hash_index');
        });
    }
};
