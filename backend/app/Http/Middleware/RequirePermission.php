<?php

namespace App\Http\Middleware;

use App\Security\AuthorizationService;
use Closure;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequirePermission
{
    public function handle(Request $request, Closure $next, string $permission): Response
    {
        if (! $request->user() || ! app(AuthorizationService::class)->hasPermission($request->user(), $permission)) {
            throw new AuthorizationException('Forbidden.');
        }

        return $next($request);
    }
}
