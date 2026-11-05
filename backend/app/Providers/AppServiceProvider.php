<?php

namespace App\Providers;

use App\Imports\ImportBenchmarkMetrics;
use App\Models\AuditLog;
use App\Models\Hub;
use App\Models\Role;
use App\Models\User;
use App\Policies\AuditLogPolicy;
use App\Policies\HubPolicy;
use App\Policies\RolePolicy;
use App\Policies\UserPolicy;
use App\Tenancy\OrganizationContext;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->scoped(OrganizationContext::class);
        $this->app->scoped(ImportBenchmarkMetrics::class);
    }

    public function boot(): void
    {
        if (config('import_benchmark.enabled')) {
            DB::listen(function ($query): void {
                app(ImportBenchmarkMetrics::class)->recordQuery((float) $query->time);
            });
        }

        Gate::policy(AuditLog::class, AuditLogPolicy::class);
        Gate::policy(Hub::class, HubPolicy::class);
        Gate::policy(Role::class, RolePolicy::class);
        Gate::policy(User::class, UserPolicy::class);

        RateLimiter::for('auth-login', function (Request $request): array {
            $key = (string) (config('auth.session_reference_key') ?: config('app.key'));
            $email = mb_strtolower(trim((string) $request->input('email')));
            $ip = (string) $request->ip();

            return [
                Limit::perMinute(10)->by('login:ip:'.hash('sha256', $ip)),
                Limit::perMinute(5)->by('login:account:'.hash_hmac('sha256', $email, $key)),
            ];
        });

        RateLimiter::for('auth-password', function (Request $request): array {
            $key = (string) (config('auth.session_reference_key') ?: config('app.key'));
            $email = mb_strtolower(trim((string) $request->input('email')));
            $ip = (string) $request->ip();

            return [
                Limit::perMinute(5)->by('password:ip:'.hash('sha256', $ip)),
                Limit::perMinute(3)->by('password:account:'.hash_hmac('sha256', $email, $key)),
            ];
        });

        ResetPassword::createUrlUsing(function (User $user, string $token): string {
            return rtrim((string) config('app.frontend_url'), '/').'/reset-password?'.http_build_query([
                'token' => $token,
                'email' => $user->email,
            ]);
        });
    }
}
