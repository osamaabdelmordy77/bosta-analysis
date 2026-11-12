<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('legacy_import_records', function (Blueprint $table): void {
            $table->longText('received_time')->nullable();
            $table->longText('first_receiving_by')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('legacy_import_records', function (Blueprint $table): void {
            $table->dropColumn(['received_time', 'first_receiving_by']);
        });
    }
};
