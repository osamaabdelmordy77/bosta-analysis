<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

class ExpireStaleDatabaseSession
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->hasSession() || config('session.driver') !== 'database') {
            return $next($request);
        }

        $sessionId = (string) $request->session()->getId();
        $session = DB::table(config('session.table'))
            ->where('id', $sessionId)
            ->first(['user_id', 'last_activity']);

        $expiresAt = (int) ($session?->last_activity ?? 0)
            + ((int) config('session.lifetime') * 60);

        if ($session && $expiresAt <= now()->getTimestamp()) {
            DB::table(config('session.table'))->where('id', $sessionId)->delete();
            Auth::guard('web')->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();

            throw new AuthenticationException('Unauthenticated.');
        }

        return $next($request);
    }
}
