<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $now = now();
        DB::table('permissions')->insertOrIgnore([
            'name' => 'imports.archive',
            'description' => 'Archive one shipment report from the active dashboard while preserving its history.',
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $permissionId = DB::table('permissions')->where('name', 'imports.archive')->value('id');
        $roles = DB::table('roles')->whereIn('slug', ['organization-admin', 'data-manager', 'analyst'])->get(['id']);
        foreach ($roles as $role) {
            DB::table('permission_role')->insertOrIgnore([
                'role_id' => $role->id,
                'permission_id' => $permissionId,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }

    public function down(): void
    {
        $permissionId = DB::table('permissions')->where('name', 'imports.archive')->value('id');
        if ($permissionId === null) {
            return;
        }

        DB::table('permission_role')->where('permission_id', $permissionId)->delete();
        DB::table('permissions')->where('id', $permissionId)->delete();
    }
};
