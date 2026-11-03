<?php

namespace App\Http\Middleware;

use App\Tenancy\OrganizationContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ClearOrganizationContext
{
    public function handle(Request $request, Closure $next): Response
    {
        $context = app(OrganizationContext::class);
        $context->clear();

        try {
            return $next($request);
        } finally {
            $context->clear();
        }
    }
}
