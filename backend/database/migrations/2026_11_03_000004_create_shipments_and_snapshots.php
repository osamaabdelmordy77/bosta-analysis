<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shipments', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('organization_id')->constrained()->restrictOnDelete();
            $table->binary('tracking_fingerprint', 32)->nullable();
            $table->timestamps();
            $table->unique(['id', 'organization_id'], 'shipments_id_org_unique');
            $table->index(['organization_id', 'tracking_fingerprint'], 'shipments_tracking_lookup_index');
        });

        Schema::create('shipment_snapshots', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('organization_id');
            $table->foreignUlid('shipment_id');
            $table->foreignUlid('import_run_id');
            $table->foreignUlid('import_source_row_id');
            $table->foreignUlid('business_id')->nullable();
            $table->foreignUlid('current_hub_id')->nullable();
            $table->foreignUlid('assigned_hub_id')->nullable();
            $table->foreignUlid('auto_assigned_hub_id')->nullable();
            $table->foreignUlid('first_hub_id')->nullable();
            $table->foreignUlid('last_dispatch_hub_id')->nullable();
            $table->foreignUlid('loss_liable_hub_id')->nullable();
            $table->binary('delivery_state_fingerprint', 32)->nullable();

            $definitions = json_decode(
                file_get_contents(database_path('schema/bosta_columns_v1.json')),
                true,
                512,
                JSON_THROW_ON_ERROR,
            );

            foreach ($definitions as $column) {
                if ($column['table'] !== 'shipment_snapshots') {
                    continue;
                }

                self::addSourceColumn($table, $column['physical_column'], $column['provisional_type']);
            }

            $table->timestamps();
            $table->unique(['id', 'organization_id'], 'shipment_snapshots_id_org_unique');
            $table->unique(['import_source_row_id'], 'shipment_snapshots_source_row_unique');
            $table->index(['organization_id', 'shipment_id', 'import_run_id'], 'snapshots_shipment_history_index');
            $table->index(['organization_id', 'import_run_id'], 'snapshots_run_index');
            $table->index(['organization_id', 'business_id', 'import_run_id'], 'snapshots_business_run_index');
            $table->index(['organization_id', 'current_hub_id', 'import_run_id'], 'snapshots_current_hub_run_index');
            $table->index(['organization_id', 'assigned_hub_id', 'import_run_id'], 'snapshots_assigned_hub_run_index');
            $table->index(['organization_id', 'delivery_state_fingerprint', 'import_run_id'], 'snapshots_state_run_index');

            $table->foreign(['shipment_id', 'organization_id'], 'snapshots_shipment_org_fk')
                ->references(['id', 'organization_id'])->on('shipments')->restrictOnDelete();
            $table->foreign(['import_run_id', 'organization_id'], 'snapshots_run_org_fk')
                ->references(['id', 'organization_id'])->on('import_runs')->restrictOnDelete();
            $table->foreign(['import_source_row_id', 'import_run_id', 'organization_id'], 'snapshots_source_run_org_fk')
                ->references(['id', 'import_run_id', 'organization_id'])->on('import_source_rows')->restrictOnDelete();
            $table->foreign(['business_id', 'organization_id'], 'snapshots_business_org_fk')
                ->references(['id', 'organization_id'])->on('businesses')->restrictOnDelete();

            foreach (['current_hub_id', 'assigned_hub_id', 'auto_assigned_hub_id', 'first_hub_id', 'last_dispatch_hub_id', 'loss_liable_hub_id'] as $hubColumn) {
                $table->foreign([$hubColumn, 'organization_id'], 'snapshots_'.$hubColumn.'_org_fk')
                    ->references(['id', 'organization_id'])->on('hubs')->restrictOnDelete();
            }
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shipment_snapshots');
        Schema::dropIfExists('shipments');
    }

    private static function addSourceColumn(Blueprint $table, string $name, string $provisionalType): void
    {
        match (true) {
            $provisionalType === 'boolean' => $table->boolean($name)->nullable(),
            $provisionalType === 'dateTime' => $table->dateTime($name, 6)->nullable(),
            $provisionalType === 'unsignedInteger' => $table->unsignedBigInteger($name)->nullable(),
            str_starts_with($provisionalType, 'decimal(') => $table->decimal($name, 65, 30)->nullable(),
            str_starts_with($provisionalType, 'string('), $provisionalType === 'text' => $table->longText($name)->nullable(),
            default => throw new InvalidArgumentException("Unsupported Bosta source type: {$provisionalType}"),
        };
    }
};
