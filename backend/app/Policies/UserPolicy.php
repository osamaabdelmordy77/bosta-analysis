<?php

namespace App\Policies;

use App\Models\User;
use App\Security\AuthorizationService;
use App\Tenancy\OrganizationContext;

class UserPolicy
{
    public function viewAny(User $actor): bool
    {
        return app(AuthorizationService::class)->hasPermission($actor, 'members.view');
    }

    public function create(User $actor): bool
    {
        return app(AuthorizationService::class)->hasPermission($actor, 'members.manage');
    }

    public function assignRole(User $actor, User $target, int $roleId): bool
    {
        return $actor->id !== $target->id
            && app(AuthorizationService::class)->mayAssignRole(
                $actor,
                $roleId,
                app(OrganizationContext::class)->requireId(),
            );
    }

    public function updateStatus(User $actor, User $target): bool
    {
        return $actor->id !== $target->id
            && app(AuthorizationService::class)->hasPermission($actor, 'members.manage');
    }

    public function updateHubAccess(User $actor, User $target): bool
    {
        return $actor->id !== $target->id
            && app(AuthorizationService::class)->hasPermission($actor, 'hubs.manage_access');
    }
}
