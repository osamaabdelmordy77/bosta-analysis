<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('system_administrator_events', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->constrained()->restrictOnDelete();
            $table->foreignId('actor_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('action', 16);
            $table->string('source', 24)->default('console');
            $table->timestamp('created_at')->useCurrent();
            $table->index(['user_id', 'id'], 'system_admin_user_event_index');
            $table->index(['created_at', 'id'], 'system_admin_event_time_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('system_administrator_events');
    }
};
