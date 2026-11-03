<?php

namespace App\Policies;

use App\Models\Role;
use App\Models\User;
use App\Security\AuthorizationService;
use App\Tenancy\OrganizationContext;

class RolePolicy
{
    public function viewAny(User $actor): bool
    {
        return app(AuthorizationService::class)->hasPermission($actor, 'roles.view');
    }

    public function assign(User $actor, int $roleId): bool
    {
        return app(AuthorizationService::class)->mayAssignRole(
            $actor,
            $roleId,
            app(OrganizationContext::class)->requireId(),
        );
    }

    public function view(User $actor, Role $role): bool
    {
        return app(AuthorizationService::class)->hasPermission($actor, 'roles.view')
            && (string) $role->organization_id === app(OrganizationContext::class)->requireId();
    }
}
