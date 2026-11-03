<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE import_file_contents MODIFY contents LONGBLOB NULL');

        Schema::create('import_file_content_chunks', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('import_file_content_id')->constrained('import_file_contents')->restrictOnDelete();
            $table->unsignedInteger('chunk_index');
            $table->unsignedBigInteger('byte_offset');
            $table->unsignedInteger('byte_length');
            $table->char('sha256', 64);
            $table->timestamps();
            $table->unique(['import_file_content_id', 'chunk_index'], 'file_content_chunks_content_index_unique');
            $table->index(['import_file_content_id', 'byte_offset'], 'file_content_chunks_offset_index');
        });
        DB::statement('ALTER TABLE import_file_content_chunks ADD contents LONGBLOB NOT NULL AFTER sha256');
    }

    public function down(): void
    {
        if (DB::table('import_file_content_chunks')->exists()) {
            throw new RuntimeException('Cannot remove chunked import file storage while stored source files depend on it.');
        }

        Schema::dropIfExists('import_file_content_chunks');
        DB::statement('ALTER TABLE import_file_contents MODIFY contents LONGBLOB NOT NULL');
    }
};
