<?php

namespace App\Http\Middleware;

use App\Models\Organization;
use App\Security\SystemAdministratorService;
use App\Tenancy\OrganizationContext;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

class ResolveOrganization
{
    public function handle(Request $request, Closure $next): Response
    {
        $actor = $request->user();
        abort_unless($actor, 401, 'Unauthenticated.');

        $routeValue = (string) $request->route('organization');
        $organization = Organization::query()
            ->where('id', $routeValue)
            ->orWhere('slug', $routeValue)
            ->first();

        abort_unless($organization, 404, 'Not found.');

        $membership = DB::table('organization_user')
            ->where('organization_id', $organization->id)
            ->where('user_id', $actor->id)
            ->where('status', 'active')
            ->first();

        $isSystemAdministrator = app(SystemAdministratorService::class)->isActive($actor->id);
        abort_unless($membership || $isSystemAdministrator, 404, 'Not found.');

        app(OrganizationContext::class)->set(
            (string) $organization->id,
            (int) $actor->id,
            $membership ? (int) $membership->role_id : null,
        );

        $request->attributes->set('organization', $organization);
        $request->attributes->set('organization_membership', $membership);

        return $next($request);
    }
}
