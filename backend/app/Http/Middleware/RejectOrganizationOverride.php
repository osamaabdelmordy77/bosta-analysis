<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RejectOrganizationOverride
{
    public function handle(Request $request, Closure $next): Response
    {
        $overrideFound = $request->headers->has('X-Organization-ID')
            || $request->headers->has('X-Tenant-ID');
        $input = $request->all();

        array_walk_recursive($input, function (mixed $value, string|int $key) use (&$overrideFound): void {
            if (in_array(strtolower((string) $key), ['organization_id', 'organizationid', 'tenant_id', 'tenantid'], true)) {
                $overrideFound = true;
            }
        });

        if ($overrideFound) {
            return response()->json([
                'message' => 'Organization context is selected by the verified URL and cannot be overridden.',
                'error' => ['code' => 'organization_override_rejected'],
            ], 422);
        }

        return $next($request);
    }
}
