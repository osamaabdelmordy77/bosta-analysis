<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Security\SecurityEventLogger;
use App\Security\SystemAdministratorService;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;

class AuthController extends Controller
{
    public function login(
        Request $request,
        SecurityEventLogger $securityEvents,
        SystemAdministratorService $systemAdministrators,
    ): JsonResponse {
        $validated = $request->validate([
            'email' => ['required', 'string', 'email:rfc', 'max:254'],
            'password' => ['required', 'string', 'max:1024'],
        ]);

        $email = mb_strtolower(trim($validated['email']));
        $user = User::query()->where('email', $email)->first();
        $passwordMatches = Hash::check(
            $validated['password'],
            $user?->getAuthPassword() ?? (string) config('auth.dummy_password_hash'),
        );

        $hasActiveOrganization = $user && DB::table('organization_user')
            ->where('user_id', $user->id)
            ->where('status', 'active')
            ->exists();

        $mayLogin = $user
            && $passwordMatches
            && ($hasActiveOrganization || $systemAdministrators->isActive((int) $user->id));

        if (! $mayLogin) {
            $securityEvents->record('auth.login_failed', $user?->id, $request, [
                'reason' => 'invalid_credentials_or_inactive_membership',
            ]);

            return response()->json([
                'message' => 'Invalid email or password.',
                'error' => ['code' => 'invalid_credentials'],
            ], 401);
        }

        Auth::guard('web')->login($user, false);
        $request->session()->regenerate();
        $securityEvents->record('auth.login_succeeded', (int) $user->id, $request);

        return $this->success(['user' => $this->userPayload($user)]);
    }

    public function logout(Request $request, SecurityEventLogger $securityEvents): JsonResponse
    {
        $userId = (int) $request->user()->id;
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();
        $securityEvents->record('auth.logout', $userId, $request);

        return $this->success(['message' => 'Signed out.']);
    }

    public function current(Request $request): JsonResponse
    {
        return $this->success(['user' => $this->userPayload($request->user())]);
    }

    public function sessions(Request $request): JsonResponse
    {
        $userId = (int) $request->user()->id;
        $cutoff = now()->subMinutes((int) config('session.lifetime'))->getTimestamp();

        $sessions = DB::table('sessions')
            ->where('user_id', $userId)
            ->where('last_activity', '>=', $cutoff)
            ->orderByDesc('last_activity')
            ->orderByDesc('id')
            ->cursorPaginate(50, ['id', 'user_agent', 'last_activity'])
            ->through(fn ($session): array => [
                'reference' => $this->sessionReference((string) $session->id),
                'current' => hash_equals((string) $request->session()->getId(), (string) $session->id),
                'user_agent' => $this->safeUserAgent($session->user_agent),
                'last_activity_at' => now()->setTimestamp((int) $session->last_activity)->toISOString(),
            ]);

        return $this->success([
            'sessions' => $sessions->items(),
            'pagination' => [
                'next_cursor' => $sessions->nextCursor()?->encode(),
                'previous_cursor' => $sessions->previousCursor()?->encode(),
            ],
        ]);
    }

    public function revokeSession(Request $request, string $reference, SecurityEventLogger $securityEvents): JsonResponse
    {
        if (! preg_match('/\A[a-f0-9]{64}\z/', $reference)) {
            return response()->json([
                'message' => 'The session reference is invalid.',
                'error' => ['code' => 'invalid_session_reference'],
            ], 422);
        }

        $currentId = (string) $request->session()->getId();
        $cutoff = now()->subMinutes((int) config('session.lifetime'))->getTimestamp();
        $sessionIds = DB::table('sessions')
            ->select('id')
            ->where('user_id', $request->user()->id)
            ->where('last_activity', '>=', $cutoff)
            ->cursor();

        foreach ($sessionIds as $sessionId) {
            $sessionId = (string) $sessionId->id;

            if (! hash_equals($this->sessionReference($sessionId), $reference)) {
                continue;
            }

            if (hash_equals($currentId, $sessionId)) {
                return response()->json([
                    'message' => 'Use the sign-out endpoint to revoke the current session.',
                    'error' => ['code' => 'current_session'],
                ], 409);
            }

            DB::table('sessions')
                ->where('user_id', $request->user()->id)
                ->where('id', $sessionId)
                ->delete();
            $securityEvents->record('auth.session_revoked', (int) $request->user()->id, $request);

            return $this->success(['revoked' => true]);
        }

        return response()->json([
            'message' => 'Session not found.',
            'error' => ['code' => 'session_not_found'],
        ], 404);
    }

    public function revokeOtherSessions(Request $request, SecurityEventLogger $securityEvents): JsonResponse
    {
        $deleted = DB::table('sessions')
            ->where('user_id', $request->user()->id)
            ->where('id', '!=', $request->session()->getId())
            ->delete();
        $securityEvents->record('auth.other_sessions_revoked', (int) $request->user()->id, $request, [
            'revoked_count' => $deleted,
        ]);

        return $this->success(['revoked_count' => $deleted]);
    }

    public function requestPasswordReset(Request $request, SecurityEventLogger $securityEvents): JsonResponse
    {
        $validated = $request->validate([
            'email' => ['required', 'string', 'email:rfc', 'max:254'],
        ]);
        $email = mb_strtolower(trim($validated['email']));
        $status = Password::sendResetLink(['email' => $email]);

        $securityEvents->record(
            'auth.password_reset_requested',
            User::query()->where('email', $email)->value('id'),
            $request,
            ['result' => $status],
        );

        return response()->json([
            'data' => ['message' => 'If an eligible account exists, password reset instructions will be sent.'],
        ], 202);
    }

    public function resetPassword(Request $request, SecurityEventLogger $securityEvents): JsonResponse
    {
        $validated = $request->validate([
            'token' => ['required', 'string', 'max:512'],
            'email' => ['required', 'string', 'email:rfc', 'max:254'],
            'password' => ['required', 'string', 'min:12', 'max:128', 'confirmed'],
        ]);
        $email = mb_strtolower(trim($validated['email']));

        $status = Password::reset(
            [
                'email' => $email,
                'password' => $validated['password'],
                'password_confirmation' => $validated['password_confirmation'],
                'token' => $validated['token'],
            ],
            function (User $user, string $password): void {
                $user->forceFill([
                    'password' => $password,
                    'remember_token' => Str::random(60),
                ])->save();

                DB::table('sessions')->where('user_id', $user->id)->delete();
                event(new PasswordReset($user));
            },
        );

        if ($status !== Password::PASSWORD_RESET) {
            $securityEvents->record('auth.password_reset_failed', null, $request, ['result' => $status]);

            return response()->json([
                'message' => 'The password reset link is invalid or expired.',
                'error' => ['code' => 'password_reset_invalid'],
            ], 422);
        }

        $securityEvents->record(
            'auth.password_reset_succeeded',
            User::query()->where('email', $email)->value('id'),
            $request,
        );

        return $this->success(['message' => 'Password reset successfully.']);
    }

    /**
     * @return array<string, mixed>
     */
    private function userPayload(User $user): array
    {
        $memberships = DB::table('organization_user')
            ->join('organizations', 'organizations.id', '=', 'organization_user.organization_id')
            ->leftJoin('roles', function ($join): void {
                $join->on('roles.id', '=', 'organization_user.role_id')
                    ->on('roles.organization_id', '=', 'organization_user.organization_id');
            })
            ->where('organization_user.user_id', $user->id)
            ->where('organization_user.status', 'active')
            ->orderBy('organizations.name')
            ->get([
                'organizations.id as organization_id',
                'organizations.name as organization_name',
                'organizations.slug as organization_slug',
                'roles.id as role_id',
                'roles.name as role_name',
                'roles.slug as role_slug',
            ])
            ->map(fn ($membership): array => [
                'organization' => [
                    'id' => $membership->organization_id,
                    'name' => $membership->organization_name,
                    'slug' => $membership->organization_slug,
                ],
                'role' => $membership->role_id === null ? null : [
                    'id' => (int) $membership->role_id,
                    'name' => $membership->role_name,
                    'slug' => $membership->role_slug,
                ],
            ])
            ->all();

        return [
            'id' => (int) $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'is_system_administrator' => $user->isSystemAdministrator(),
            'memberships' => $memberships,
        ];
    }

    private function sessionReference(string $sessionId): string
    {
        $key = (string) (config('auth.session_reference_key') ?: config('app.key'));

        return hash_hmac('sha256', $sessionId, $key);
    }

    private function safeUserAgent(?string $userAgent): ?string
    {
        if ($userAgent === null) {
            return null;
        }

        $sanitized = preg_replace('/[\x00-\x1F\x7F]/u', '', $userAgent) ?? '';

        return mb_substr($sanitized, 0, 180);
    }
}
