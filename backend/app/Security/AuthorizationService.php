<?php

namespace App\Security;

use App\Models\User;
use App\Tenancy\OrganizationContext;
use Illuminate\Support\Facades\DB;

class AuthorizationService
{
    public function __construct(
        private readonly OrganizationContext $context,
        private readonly SystemAdministratorService $systemAdministrators,
    ) {}

    public function hasPermission(User $user, string $permission): bool
    {
        if ($this->systemAdministrators->isActive((int) $user->id)) {
            return true;
        }

        $organizationId = $this->context->id();
        $roleId = $this->context->roleId();

        if ($organizationId === null || $roleId === null || $this->context->userId() !== (int) $user->id) {
            return false;
        }

        return DB::table('permission_role')
            ->join('permissions', 'permissions.id', '=', 'permission_role.permission_id')
            ->join('roles', 'roles.id', '=', 'permission_role.role_id')
            ->where('roles.id', $roleId)
            ->where('roles.organization_id', $organizationId)
            ->where('permissions.name', $permission)
            ->exists();
    }

    /**
     * @return list<string>
     */
    public function permissionNamesForRole(int $roleId, string $organizationId): array
    {
        return DB::table('permission_role')
            ->join('permissions', 'permissions.id', '=', 'permission_role.permission_id')
            ->join('roles', 'roles.id', '=', 'permission_role.role_id')
            ->where('roles.id', $roleId)
            ->where('roles.organization_id', $organizationId)
            ->orderBy('permissions.name')
            ->pluck('permissions.name')
            ->all();
    }

    public function mayAssignRole(User $actor, int $roleId, string $organizationId): bool
    {
        if ($this->systemAdministrators->isActive((int) $actor->id)) {
            return DB::table('roles')
                ->where('id', $roleId)
                ->where('organization_id', $organizationId)
                ->exists();
        }

        if (! $this->hasPermission($actor, 'roles.assign')) {
            return false;
        }

        $targetPermissions = $this->permissionNamesForRole($roleId, $organizationId);
        if ($targetPermissions === []) {
            return false;
        }

        $actorPermissions = $this->context->roleId()
            ? $this->permissionNamesForRole($this->context->roleId(), $organizationId)
            : [];

        return array_diff($targetPermissions, $actorPermissions) === [];
    }
}
