<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('import_runs', function (Blueprint $table): void {
            $table->char('mapping_fingerprint', 64)->nullable()->after('mapping_version');
            $table->index(
                ['import_file_id', 'report_date', 'status', 'mapping_fingerprint'],
                'import_runs_retry_lookup_index',
            );
        });
    }

    public function down(): void
    {
        Schema::table('import_runs', function (Blueprint $table): void {
            $table->dropIndex('import_runs_retry_lookup_index');
            $table->dropColumn('mapping_fingerprint');
        });
    }
};
