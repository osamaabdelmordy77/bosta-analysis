<?php

namespace App\Policies;

use App\Models\Hub;
use App\Models\User;
use App\Security\AuthorizationService;
use App\Security\HubAccessService;
use App\Tenancy\OrganizationContext;

class HubPolicy
{
    public function viewAny(User $actor): bool
    {
        $authorization = app(AuthorizationService::class);

        return $authorization->hasPermission($actor, 'hubs.view_all')
            || $authorization->hasPermission($actor, 'hubs.view_assigned');
    }

    public function view(User $actor, Hub $hub): bool
    {
        return (string) $hub->organization_id === app(OrganizationContext::class)->requireId()
            && app(HubAccessService::class)->scopeHubs(Hub::query(), $actor)->whereKey($hub->getKey())->exists();
    }
}
