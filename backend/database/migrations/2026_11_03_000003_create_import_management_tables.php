<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('import_files', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('organization_id')->constrained()->restrictOnDelete();
            $table->longText('original_name');
            $table->string('media_type', 120)->nullable();
            $table->unsignedBigInteger('size_bytes');
            $table->char('sha256', 64);
            $table->string('storage_disk', 64)->default('private');
            $table->longText('storage_path');
            $table->ulid('active_run_id')->nullable();
            $table->timestamps();
            $table->unique(['id', 'organization_id'], 'import_files_id_org_unique');
            $table->index(['organization_id', 'sha256']);
            $table->index(['organization_id', 'created_at']);
            $table->index(['active_run_id', 'id', 'organization_id'], 'import_files_active_run_fk_index');
        });

        Schema::create('import_runs', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('organization_id');
            $table->foreignUlid('import_file_id');
            $table->unsignedInteger('revision');
            $table->unsignedInteger('mapping_version')->default(1);
            $table->string('duplicate_policy', 32)->default('review');
            $table->date('report_date')->nullable();
            $table->string('report_timezone', 64)->nullable();
            $table->string('status', 24)->default('pending');
            $table->unsignedBigInteger('source_rows_count')->default(0);
            $table->unsignedBigInteger('accepted_rows_count')->default(0);
            $table->unsignedBigInteger('duplicate_rows_count')->default(0);
            $table->unsignedBigInteger('rejected_rows_count')->default(0);
            $table->unsignedBigInteger('issues_count')->default(0);
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamp('published_at')->nullable();
            $table->timestamps();
            $table->unique(['import_file_id', 'revision']);
            $table->unique(['id', 'organization_id'], 'import_runs_id_org_unique');
            $table->unique(['id', 'import_file_id', 'organization_id'], 'import_runs_id_file_org_unique');
            $table->index(['organization_id', 'status', 'created_at']);
            $table->index(['organization_id', 'report_date', 'status']);
            $table->foreign(['import_file_id', 'organization_id'], 'import_runs_file_org_fk')
                ->references(['id', 'organization_id'])->on('import_files')->restrictOnDelete();
        });

        Schema::table('import_files', function (Blueprint $table): void {
            $table->foreign(['active_run_id', 'id', 'organization_id'], 'import_files_active_run_org_fk')
                ->references(['id', 'import_file_id', 'organization_id'])->on('import_runs')->restrictOnDelete();
        });

        Schema::create('import_sheets', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('organization_id');
            $table->foreignUlid('import_run_id');
            $table->unsignedSmallInteger('source_sheet_index');
            $table->longText('source_sheet_name');
            $table->unsignedInteger('header_row_number')->nullable();
            $table->unsignedBigInteger('data_rows_count')->default(0);
            $table->unsignedSmallInteger('detected_columns_count')->default(0);
            $table->timestamps();
            $table->unique(['import_run_id', 'source_sheet_index']);
            $table->unique(['id', 'import_run_id', 'organization_id'], 'import_sheets_id_run_org_unique');
            $table->index(['organization_id', 'import_run_id']);
            $table->foreign(['import_run_id', 'organization_id'], 'import_sheets_run_org_fk')
                ->references(['id', 'organization_id'])->on('import_runs')->restrictOnDelete();
        });

        Schema::create('import_chunks', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('organization_id');
            $table->foreignUlid('import_run_id');
            $table->foreignUlid('import_sheet_id');
            $table->unsignedInteger('chunk_index');
            $table->unsignedBigInteger('first_source_row');
            $table->unsignedBigInteger('last_source_row');
            $table->string('status', 24)->default('pending');
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->unsignedInteger('rows_processed')->default(0);
            $table->unsignedInteger('issues_count')->default(0);
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();
            $table->unique(['import_run_id', 'import_sheet_id', 'chunk_index']);
            $table->unique(['id', 'import_run_id', 'import_sheet_id', 'organization_id'], 'import_chunks_id_run_sheet_org_unique');
            $table->index(['organization_id', 'import_run_id', 'status']);
            $table->foreign(['import_run_id', 'organization_id'], 'import_chunks_run_org_fk')
                ->references(['id', 'organization_id'])->on('import_runs')->restrictOnDelete();
            $table->foreign(['import_sheet_id', 'import_run_id', 'organization_id'], 'import_chunks_sheet_run_org_fk')
                ->references(['id', 'import_run_id', 'organization_id'])->on('import_sheets')->restrictOnDelete();
        });

        Schema::create('import_source_rows', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('organization_id');
            $table->foreignUlid('import_run_id');
            $table->foreignUlid('import_sheet_id');
            $table->foreignUlid('import_chunk_id')->nullable();
            $table->unsignedBigInteger('source_row_number');
            $table->json('source_values');
            $table->string('status', 24)->default('pending');
            $table->unsignedSmallInteger('issues_count')->default(0);
            $table->timestamp('processed_at')->nullable();
            $table->timestamps();
            $table->unique(['import_run_id', 'import_sheet_id', 'source_row_number'], 'source_rows_idempotency_unique');
            $table->unique(['id', 'import_run_id', 'organization_id'], 'source_rows_id_run_org_unique');
            $table->index(['organization_id', 'import_run_id', 'status']);
            $table->foreign(['import_sheet_id', 'import_run_id', 'organization_id'], 'source_rows_sheet_run_org_fk')
                ->references(['id', 'import_run_id', 'organization_id'])->on('import_sheets')->restrictOnDelete();
            $table->foreign(['import_chunk_id', 'import_run_id', 'import_sheet_id', 'organization_id'], 'source_rows_chunk_run_sheet_org_fk')
                ->references(['id', 'import_run_id', 'import_sheet_id', 'organization_id'])->on('import_chunks')->restrictOnDelete();
        });

        Schema::create('import_issues', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('organization_id');
            $table->foreignUlid('import_run_id');
            $table->foreignUlid('import_source_row_id')->nullable();
            $table->unsignedSmallInteger('source_sheet_index')->nullable();
            $table->unsignedBigInteger('source_row_number')->nullable();
            $table->unsignedSmallInteger('source_column_number')->nullable();
            $table->longText('source_column_label')->nullable();
            $table->string('issue_code', 64);
            $table->string('severity', 16);
            $table->string('safe_message', 500);
            $table->timestamps();
            $table->index(['organization_id', 'import_run_id', 'severity']);
            $table->index(['import_source_row_id', 'issue_code']);
            $table->foreign(['import_run_id', 'organization_id'], 'import_issues_run_org_fk')
                ->references(['id', 'organization_id'])->on('import_runs')->restrictOnDelete();
            $table->foreign(['import_source_row_id', 'import_run_id', 'organization_id'], 'import_issues_source_run_org_fk')
                ->references(['id', 'import_run_id', 'organization_id'])->on('import_source_rows')->restrictOnDelete();
        });

        Schema::create('column_mappings', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('organization_id')->constrained()->restrictOnDelete();
            $table->unsignedInteger('mapping_version');
            $table->unsignedSmallInteger('source_column_number')->nullable();
            $table->unsignedSmallInteger('source_column_index')->nullable();
            $table->longText('source_label');
            $table->string('target_table', 64)->nullable();
            $table->string('target_column', 128)->nullable();
            $table->string('provisional_type', 32)->nullable();
            $table->boolean('is_enabled')->default(true);
            $table->foreignId('created_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestamps();
            $table->unique(['organization_id', 'mapping_version', 'source_column_number'], 'column_mappings_version_number_unique');
            $table->index(['organization_id', 'mapping_version', 'is_enabled']);
        });

        Schema::create('report_exports', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('organization_id');
            $table->foreignId('requested_by');
            $table->string('status', 24)->default('pending');
            $table->json('filter_snapshot');
            $table->string('storage_disk', 64)->nullable();
            $table->longText('storage_path')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();
            $table->index(['organization_id', 'status', 'created_at']);
            $table->foreign(['organization_id', 'requested_by'], 'report_exports_requester_org_fk')
                ->references(['organization_id', 'user_id'])->on('organization_user')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('report_exports');
        Schema::dropIfExists('column_mappings');
        Schema::dropIfExists('import_issues');
        Schema::dropIfExists('import_source_rows');
        Schema::dropIfExists('import_chunks');
        Schema::dropIfExists('import_sheets');
        Schema::table('import_files', function (Blueprint $table): void {
            $table->dropForeign('import_files_active_run_org_fk');
        });
        Schema::dropIfExists('import_runs');
        Schema::dropIfExists('import_files');
    }
};
