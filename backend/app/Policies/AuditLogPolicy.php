<?php

namespace App\Policies;

use App\Models\AuditLog;
use App\Models\User;
use App\Security\AuthorizationService;
use App\Tenancy\OrganizationContext;

class AuditLogPolicy
{
    public function viewAny(User $actor): bool
    {
        return app(AuthorizationService::class)->hasPermission($actor, 'audit.view');
    }

    public function view(User $actor, AuditLog $auditLog): bool
    {
        return app(AuthorizationService::class)->hasPermission($actor, 'audit.view')
            && (string) $auditLog->organization_id === app(OrganizationContext::class)->requireId();
    }
}
