<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('import_chunks', function (Blueprint $table): void {
            $table->char('payload_sha256', 64)->nullable()->after('status');
        });

        Schema::table('import_sheets', function (Blueprint $table): void {
            $table->json('column_mapping_plan')->nullable()->after('source_headers');
        });
    }

    public function down(): void
    {
        Schema::table('import_sheets', function (Blueprint $table): void {
            $table->dropColumn('column_mapping_plan');
        });

        Schema::table('import_chunks', function (Blueprint $table): void {
            $table->dropColumn('payload_sha256');
        });
    }
};
