<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('audit_logs', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignId('actor_id')->nullable();
            $table->string('action', 100);
            $table->string('subject_type', 100)->nullable();
            $table->char('subject_id', 26)->nullable();
            $table->json('metadata')->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->index(['organization_id', 'created_at'], 'audit_org_time_index');
            $table->index(['organization_id', 'subject_type', 'subject_id', 'created_at'], 'audit_subject_time_index');
            $table->index(['organization_id', 'actor_id', 'created_at'], 'audit_actor_time_index');
            $table->foreign(['organization_id', 'actor_id'], 'audit_actor_org_fk')
                ->references(['organization_id', 'user_id'])->on('organization_user')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_logs');
    }
};
