<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('organizations', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->string('name', 191);
            $table->string('slug', 100)->unique();
            $table->string('timezone', 64)->nullable();
            $table->timestamps();
        });

        Schema::create('roles', function (Blueprint $table): void {
            $table->id();
            $table->foreignUlid('organization_id')->constrained()->restrictOnDelete();
            $table->string('name', 100);
            $table->string('slug', 64);
            $table->timestamps();
            $table->unique(['organization_id', 'slug']);
            $table->unique(['id', 'organization_id'], 'roles_id_org_unique');
        });

        Schema::create('permissions', function (Blueprint $table): void {
            $table->id();
            $table->string('name', 120)->unique();
            $table->string('description', 255)->nullable();
            $table->timestamps();
        });

        Schema::create('permission_role', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('role_id')->constrained()->restrictOnDelete();
            $table->foreignId('permission_id')->constrained()->restrictOnDelete();
            $table->timestamps();
            $table->unique(['role_id', 'permission_id']);
        });

        Schema::create('organization_user', function (Blueprint $table): void {
            $table->id();
            $table->foreignUlid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignId('user_id')->constrained()->restrictOnDelete();
            $table->foreignId('role_id')->nullable();
            $table->string('status', 24)->default('active');
            $table->timestamps();
            $table->unique(['organization_id', 'user_id']);
            $table->index(['organization_id', 'status', 'user_id']);
            $table->foreign(['role_id', 'organization_id'], 'organization_user_role_org_fk')
                ->references(['id', 'organization_id'])->on('roles')->restrictOnDelete();
        });

        Schema::create('organization_settings', function (Blueprint $table): void {
            $table->id();
            $table->foreignUlid('organization_id')->constrained()->restrictOnDelete();
            $table->string('setting_key', 120);
            $table->json('setting_value')->nullable();
            $table->timestamps();
            $table->unique(['organization_id', 'setting_key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('organization_settings');
        Schema::dropIfExists('organization_user');
        Schema::dropIfExists('permission_role');
        Schema::dropIfExists('permissions');
        Schema::dropIfExists('roles');
        Schema::dropIfExists('organizations');
    }
};
