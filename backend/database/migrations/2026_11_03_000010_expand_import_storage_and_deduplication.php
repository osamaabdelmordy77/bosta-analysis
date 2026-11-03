<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('import_files', function (Blueprint $table): void {
            $table->char('identity_hash', 64)->nullable()->after('sha256');
            $table->timestamp('archived_at')->nullable()->after('active_run_id');
            $table->unique(['organization_id', 'identity_hash'], 'import_files_org_identity_unique');
        });

        Schema::table('import_runs', function (Blueprint $table): void {
            $table->foreignId('uploaded_by')->nullable()->after('import_file_id')->constrained('users')->restrictOnDelete();
            $table->boolean('report_date_is_manual')->default(false)->after('report_date');
        });

        Schema::table('import_sheets', function (Blueprint $table): void {
            $table->json('source_headers')->nullable()->after('source_sheet_name');
        });

        Schema::table('businesses', function (Blueprint $table): void {
            $table->binary('canonical_name_hash', 32)->nullable()->after('name');
            $table->unique(['organization_id', 'canonical_name_hash'], 'businesses_org_name_hash_unique');
            $table->unique(['organization_id', 'external_id_hash'], 'businesses_org_external_hash_unique');
        });

        Schema::table('hubs', function (Blueprint $table): void {
            $table->unique(['organization_id', 'canonical_name_hash'], 'hubs_org_name_hash_unique');
        });
        Schema::table('hubs', function (Blueprint $table): void {
            $table->dropIndex(['organization_id', 'canonical_name_hash']);
        });

        Schema::table('shipments', function (Blueprint $table): void {
            $table->unique(['organization_id', 'tracking_fingerprint'], 'shipments_org_tracking_unique');
        });
        Schema::table('shipments', function (Blueprint $table): void {
            $table->dropIndex('shipments_tracking_lookup_index');
        });

        Schema::table('shipment_snapshots', function (Blueprint $table): void {
            $table->unique(['organization_id', 'shipment_id', 'import_run_id'], 'snapshots_shipment_run_unique');
        });

        Schema::create('import_file_contents', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('organization_id');
            $table->foreignUlid('import_file_id');
            $table->foreignUlid('import_run_id')->unique();
            $table->string('media_type', 120)->nullable();
            $table->char('sha256', 64);
            $table->timestamps();
            $table->index(['organization_id', 'import_file_id']);
            $table->foreign(['import_run_id', 'import_file_id', 'organization_id'], 'import_file_contents_run_file_org_fk')
                ->references(['id', 'import_file_id', 'organization_id'])->on('import_runs')->restrictOnDelete();
        });
        DB::statement('ALTER TABLE import_file_contents ADD contents LONGBLOB NOT NULL AFTER sha256');

        Schema::create('legacy_import_files', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('organization_id')->constrained()->restrictOnDelete();
            $table->char('legacy_key', 64);
            $table->longText('original_name');
            $table->unsignedBigInteger('size_bytes');
            $table->date('detected_date')->nullable();
            $table->boolean('manual_date')->default(false);
            $table->unsignedInteger('record_count')->default(0);
            $table->unsignedInteger('duplicate_count')->default(0);
            $table->unsignedSmallInteger('sheets_count')->default(0);
            $table->timestamp('uploaded_at')->nullable();
            $table->timestamp('archived_at')->nullable();
            $table->string('migration_status', 24)->default('migrating');
            $table->timestamp('migration_completed_at')->nullable();
            $table->timestamps();
            $table->unique(['organization_id', 'legacy_key'], 'legacy_files_org_key_unique');
            $table->unique(['id', 'organization_id'], 'legacy_files_id_org_unique');
            $table->index(['organization_id', 'archived_at', 'uploaded_at'], 'legacy_files_org_archive_upload_idx');
        });

        Schema::create('legacy_import_records', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('organization_id');
            $table->foreignUlid('legacy_import_file_id');
            $table->char('source_record_key', 64);
            $table->date('shipment_date')->nullable();
            $table->longText('tracking')->nullable();
            $table->binary('tracking_hash', 32)->nullable();
            $table->decimal('items', 18, 4)->nullable();
            $table->longText('business')->nullable();
            $table->longText('ship_type')->nullable();
            $table->longText('package_type')->nullable();
            $table->longText('package_size')->nullable();
            $table->longText('pickup_city')->nullable();
            $table->longText('drop_city')->nullable();
            $table->longText('pickup_zone')->nullable();
            $table->longText('assigned_hub')->nullable();
            $table->json('hubs')->nullable();
            $table->longText('raw_date')->nullable();
            $table->timestamps();
            $table->unique(['legacy_import_file_id', 'source_record_key'], 'legacy_records_file_key_unique');
            $table->index(['organization_id', 'shipment_date', 'id']);
            $table->index(['organization_id', 'tracking_hash']);
            $table->foreign(['legacy_import_file_id', 'organization_id'], 'legacy_records_file_org_fk')
                ->references(['id', 'organization_id'])->on('legacy_import_files')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('import_file_contents');
        Schema::dropIfExists('legacy_import_records');
        Schema::dropIfExists('legacy_import_files');

        Schema::table('shipment_snapshots', function (Blueprint $table): void {
            $table->dropUnique('snapshots_shipment_run_unique');
        });

        Schema::table('shipments', function (Blueprint $table): void {
            $table->index(['organization_id', 'tracking_fingerprint'], 'shipments_tracking_lookup_index');
        });
        Schema::table('shipments', function (Blueprint $table): void {
            $table->dropUnique('shipments_org_tracking_unique');
        });

        Schema::table('hubs', function (Blueprint $table): void {
            $table->index(['organization_id', 'canonical_name_hash']);
        });
        Schema::table('hubs', function (Blueprint $table): void {
            $table->dropUnique('hubs_org_name_hash_unique');
        });

        Schema::table('businesses', function (Blueprint $table): void {
            $table->dropUnique('businesses_org_external_hash_unique');
            $table->dropUnique('businesses_org_name_hash_unique');
            $table->dropColumn('canonical_name_hash');
        });

        Schema::table('import_sheets', function (Blueprint $table): void {
            $table->dropColumn('source_headers');
        });

        Schema::table('import_runs', function (Blueprint $table): void {
            $table->dropColumn('report_date_is_manual');
            $table->dropConstrainedForeignId('uploaded_by');
        });

        Schema::table('import_files', function (Blueprint $table): void {
            $table->dropUnique('import_files_org_identity_unique');
            $table->dropColumn(['identity_hash', 'archived_at']);
        });
    }
};
