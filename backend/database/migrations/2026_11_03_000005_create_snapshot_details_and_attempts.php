<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $definitions = json_decode(
            file_get_contents(database_path('schema/bosta_columns_v1.json')),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );

        foreach ([
            'shipment_snapshot_parties',
            'shipment_snapshot_routing',
            'shipment_snapshot_financials',
            'shipment_snapshot_service',
        ] as $tableName) {
            Schema::create($tableName, function (Blueprint $table) use ($definitions, $tableName): void {
                $table->ulid('id')->primary();
                $table->foreignUlid('organization_id');
                $table->foreignUlid('shipment_snapshot_id');

                foreach ($definitions as $column) {
                    if ($column['table'] === $tableName) {
                        self::addSourceColumn($table, $column['physical_column'], $column['provisional_type']);
                    }
                }

                $table->timestamps();
                $table->unique(['organization_id', 'shipment_snapshot_id'], $tableName.'_snapshot_unique');
                $table->foreign(['shipment_snapshot_id', 'organization_id'], $tableName.'_snapshot_org_fk')
                    ->references(['id', 'organization_id'])->on('shipment_snapshots')->restrictOnDelete();
            });
        }

        Schema::create('delivery_attempts', function (Blueprint $table) use ($definitions): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('organization_id');
            $table->foreignUlid('shipment_snapshot_id');
            $table->unsignedTinyInteger('attempt_index');

            $attemptColumns = [];
            foreach ($definitions as $column) {
                if ($column['table'] === 'delivery_attempts') {
                    $attemptColumns[$column['physical_column']] = $column['provisional_type'];
                }
            }

            if (count($attemptColumns) !== 8) {
                throw new RuntimeException('The versioned Bosta manifest must define exactly eight attempt fields.');
            }

            foreach ($attemptColumns as $name => $type) {
                self::addSourceColumn($table, $name, $type);
            }

            $table->timestamps();
            $table->unique(['organization_id', 'shipment_snapshot_id', 'attempt_index'], 'delivery_attempt_group_unique');
            $table->foreign(['shipment_snapshot_id', 'organization_id'], 'attempts_snapshot_org_fk')
                ->references(['id', 'organization_id'])->on('shipment_snapshots')->restrictOnDelete();
        });

        DB::statement('ALTER TABLE delivery_attempts ADD CONSTRAINT delivery_attempts_index_range_check CHECK (attempt_index BETWEEN 0 AND 8)');
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_attempts');
        Schema::dropIfExists('shipment_snapshot_service');
        Schema::dropIfExists('shipment_snapshot_financials');
        Schema::dropIfExists('shipment_snapshot_routing');
        Schema::dropIfExists('shipment_snapshot_parties');
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
