<?php

namespace Database\Seeders;

use App\Models\Organization;
use App\Models\User;
use App\Security\AuditLogService;
use App\Tenancy\OrganizationContext;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

class LocalOsamaUserSeeder extends Seeder
{
    private const EMAIL = 'osama@gmail.com';
    private const PASSWORD = '20012001';

    public function run(AuditLogService $auditLog, OrganizationContext $organizationContext): void
    {
        if (! app()->environment('local') || ! config('local_seed.enabled')) {
            throw new RuntimeException('The local login seeder requires the enabled local workspace.');
        }

        DB::transaction(function () use ($auditLog, $organizationContext): void {
            $organization = Organization::query()
                ->where('slug', config('local_seed.organization_slug'))
                ->firstOrFail();

            $roleId = (int) DB::table('roles')
                ->where('organization_id', $organization->id)
                ->where('slug', 'organization-admin')
                ->value('id');

            if ($roleId === 0) {
                throw new RuntimeException('The local organization admin role does not exist.');
            }

            $user = User::query()->where('email', self::EMAIL)->lockForUpdate()->first()
                ?? new User(['email' => self::EMAIL]);
            $user->fill(['name' => 'Osama', 'password' => self::PASSWORD])->save();

            $membership = DB::table('organization_user')
                ->where('organization_id', $organization->id)
                ->where('user_id', $user->id)
                ->lockForUpdate()
                ->first();
            $membershipChanged = ! $membership
                || (int) $membership->role_id !== $roleId
                || $membership->status !== 'active';

            DB::table('organization_user')->updateOrInsert(
                ['organization_id' => $organization->id, 'user_id' => $user->id],
                [
                    'role_id' => $roleId,
                    'status' => 'active',
                    'created_at' => $membership?->created_at ?? now(),
                    'updated_at' => now(),
                ],
            );

            if ($membershipChanged) {
                $organizationContext->set((string) $organization->id, (int) $user->id, $roleId);
                try {
                    $auditLog->record($user, 'membership.bootstrap_admin', 'user', (string) $user->id, [
                        'role_id' => $roleId,
                        'previous_role_id' => $membership?->role_id,
                        'status' => 'active',
                        'previous_status' => $membership?->status,
                    ]);
                } finally {
                    $organizationContext->clear();
                }
            }
        });
    }
}
