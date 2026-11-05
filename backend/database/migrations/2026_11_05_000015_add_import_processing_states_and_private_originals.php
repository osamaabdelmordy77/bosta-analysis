<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('import_file_contents', function (Blueprint $table): void {
            $table->string('storage_disk', 64)->nullable()->after('sha256');
            $table->longText('storage_path')->nullable()->after('storage_disk');
        });

        Schema::table('import_runs', function (Blueprint $table): void {
            $table->string('processing_state', 24)->default('completed')->after('status');
            $table->json('processing_options')->nullable()->after('mapping_fingerprint');
            $table->unsignedBigInteger('processed_source_rows')->default(0)->after('issues_count');
            $table->unsignedBigInteger('total_source_rows')->nullable()->after('processed_source_rows');
            $table->timestamp('queued_at')->nullable()->after('started_at');
            $table->timestamp('processing_started_at')->nullable()->after('queued_at');
            $table->timestamp('finalizing_at')->nullable()->after('processing_started_at');
            $table->timestamp('processing_completed_at')->nullable()->after('finalizing_at');
            $table->string('processing_error_code', 64)->nullable()->after('processing_completed_at');
            $table->text('processing_error')->nullable()->after('processing_error_code');
            $table->json('processing_metrics')->nullable()->after('processing_error');
            $table->index(['organization_id', 'processing_state', 'updated_at'], 'import_runs_processing_state_index');
        });

        DB::table('import_runs')->where('status', 'published')->update([
            'processing_state' => 'completed',
            'processing_completed_at' => DB::raw('COALESCE(processing_completed_at, published_at, finished_at, updated_at)'),
        ]);

        DB::table('import_runs')->where('status', 'importing')->update([
            'processing_state' => 'failed',
            'processing_error_code' => 'legacy_run_requires_restart',
            'processing_error' => 'This pre-worker import is incomplete. Re-upload the original workbook to start a new safe revision.',
        ]);
    }

    public function down(): void
    {
        if (DB::table('import_file_contents')->whereNotNull('storage_path')->exists()) {
            throw new RuntimeException('Cannot remove private original references while imports depend on stored files.');
        }

        Schema::table('import_runs', function (Blueprint $table): void {
            $table->dropIndex('import_runs_processing_state_index');
            $table->dropColumn([
                'processing_state', 'processed_source_rows', 'total_source_rows', 'queued_at',
                'processing_options',
                'processing_started_at', 'finalizing_at', 'processing_completed_at',
                'processing_error_code', 'processing_error', 'processing_metrics',
            ]);
        });

        Schema::table('import_file_contents', function (Blueprint $table): void {
            $table->dropColumn(['storage_disk', 'storage_path']);
        });
    }
};
