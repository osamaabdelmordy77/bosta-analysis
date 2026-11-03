<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('businesses', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('organization_id')->constrained()->restrictOnDelete();
            $table->longText('name');
            $table->longText('external_id')->nullable();
            $table->binary('external_id_hash', 32)->nullable();
            $table->timestamps();
            $table->unique(['id', 'organization_id'], 'businesses_id_org_unique');
            $table->index(['organization_id', 'external_id_hash']);
        });

        Schema::create('hubs', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('organization_id')->constrained()->restrictOnDelete();
            $table->longText('canonical_name');
            $table->binary('canonical_name_hash', 32)->nullable();
            $table->longText('external_code')->nullable();
            $table->binary('external_code_hash', 32)->nullable();
            $table->timestamps();
            $table->unique(['id', 'organization_id'], 'hubs_id_org_unique');
            $table->index(['organization_id', 'canonical_name_hash']);
            $table->index(['organization_id', 'external_code_hash']);
        });

        Schema::create('hub_aliases', function (Blueprint $table): void {
            $table->id();
            $table->foreignUlid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUlid('hub_id');
            $table->longText('source_name');
            $table->binary('source_name_hash', 32);
            $table->timestamps();
            $table->index(['organization_id', 'source_name_hash']);
            $table->unique(['organization_id', 'hub_id', 'source_name_hash'], 'hub_aliases_org_hub_hash_unique');
            $table->foreign(['hub_id', 'organization_id'], 'hub_aliases_hub_org_fk')
                ->references(['id', 'organization_id'])->on('hubs')->restrictOnDelete();
        });

        Schema::create('locations', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('organization_id')->constrained()->restrictOnDelete();
            $table->string('kind', 32);
            $table->longText('source_name');
            $table->binary('source_name_hash', 32)->nullable();
            $table->longText('external_code')->nullable();
            $table->timestamps();
            $table->index(['organization_id', 'kind', 'source_name_hash']);
        });

        Schema::create('user_hub_access', function (Blueprint $table): void {
            $table->id();
            $table->foreignUlid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignId('user_id');
            $table->foreignUlid('hub_id');
            $table->timestamps();
            $table->unique(['organization_id', 'user_id', 'hub_id']);
            $table->index(['organization_id', 'hub_id', 'user_id']);
            $table->foreign(['organization_id', 'user_id'], 'user_hub_access_member_org_fk')
                ->references(['organization_id', 'user_id'])->on('organization_user')->restrictOnDelete();
            $table->foreign(['hub_id', 'organization_id'], 'user_hub_access_hub_org_fk')
                ->references(['id', 'organization_id'])->on('hubs')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_hub_access');
        Schema::dropIfExists('locations');
        Schema::dropIfExists('hub_aliases');
        Schema::dropIfExists('hubs');
        Schema::dropIfExists('businesses');
    }
};
