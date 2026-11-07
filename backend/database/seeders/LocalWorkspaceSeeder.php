<?php

namespace Database\Seeders;

use App\Models\Organization;
use App\Models\User;
use App\Security\AuditLogService;
use App\Security\RoleCatalog;
use App\Tenancy\OrganizationContext;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use RuntimeException;

class LocalWorkspaceSeeder extends Seeder
{
    public function run(
        RoleCatalog $roleCatalog,
        AuditLogService $auditLog,
        OrganizationContext $organizationContext,
    ): void {
        if (! app()->environment('local')) {
            throw new RuntimeException('The local workspace seeder may only run in the local environment.');
        }

        if (! config('local_seed.enabled')) {
            throw new RuntimeException('Set LOCAL_WORKSPACE_SEED_ENABLED=true before running the local workspace seeder.');
        }

        $organizationName = trim((string) config('local_seed.organization_name'));
        $organizationSlug = mb_strtolower(trim((string) config('local_seed.organization_slug')));
        $adminName = trim((string) config('local_seed.admin_name'));
        $adminEmail = mb_strtolower(trim((string) config('local_seed.admin_email')));
        $adminPassword = (string) config('local_seed.admin_password');
        $roleSlug = (string) config('local_seed.role');

        if ($organizationName === '' || mb_strlen($organizationName) > 191
            || ! preg_match('/\A[a-z0-9]+(?:-[a-z0-9]+)*\z/', $organizationSlug)
            || mb_strlen($organizationSlug) > 100) {
            throw new InvalidArgumentException('Provide a valid local workspace organization name and slug.');
        }

        if ($adminName === '' || mb_strlen($adminName) > 255
            || filter_var($adminEmail, FILTER_VALIDATE_EMAIL) === false
            || mb_strlen($adminEmail) > 254
            || $adminPassword === '') {
            throw new InvalidArgumentException('Provide a valid local workspace administrator name, email, and password.');
        }

        if (! isset(RoleCatalog::ROLES[$roleSlug])) {
            throw new InvalidArgumentException('The configured local workspace role does not exist in the role catalog.');
        }

        DB::transaction(function () use (
            $roleCatalog,
            $auditLog,
            $organizationContext,
            $organizationName,
            $organizationSlug,
            $adminName,
            $adminEmail,
            $adminPassword,
            $roleSlug,
        ): void {
            $organization = Organization::query()->firstOrCreate(
                ['slug' => $organizationSlug],
                ['name' => $organizationName],
            );
            $roleCatalog->syncOrganization((string) $organization->id);

            $roleId = (int) DB::table('roles')
                ->where('organization_id', $organization->id)
                ->where('slug', $roleSlug)
                ->value('id');

            if ($roleId === 0) {
                throw new RuntimeException('The configured local workspace role could not be created.');
            }

            $user = User::query()->where('email', $adminEmail)->lockForUpdate()->first();
            if (! $user) {
                $user = User::query()->create([
                    'name' => $adminName,
                    'email' => $adminEmail,
                    'password' => $adminPassword,
                ]);
            } else {
                $user->fill(['name' => $adminName, 'password' => $adminPassword])->save();
            }

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
