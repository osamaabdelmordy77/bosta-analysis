<?php

use App\Http\Middleware\ClearOrganizationContext;
use App\Http\Middleware\ExpireStaleDatabaseSession;
use App\Http\Middleware\RejectOrganizationOverride;
use App\Http\Middleware\RequirePermission;
use App\Http\Middleware\ResolveOrganization;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Session\TokenMismatchException;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->statefulApi();
        $middleware->redirectGuestsTo(
            fn (Request $request): ?string => $request->is('api/*') ? null : route('login'),
        );
        $middleware->prepend(ClearOrganizationContext::class);
        $middleware->prependToPriorityList(
            AuthenticatesRequests::class,
            ExpireStaleDatabaseSession::class,
        );
        $middleware->alias([
            'permission' => RequirePermission::class,
            'organization.override' => RejectOrganizationOverride::class,
            'organization.resolve' => ResolveOrganization::class,
            'session.expiry' => ExpireStaleDatabaseSession::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request, Throwable $exception): bool => $request->is('api/*') || $request->expectsJson()
        );

        $exceptions->render(function (AuthenticationException $exception, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            return response()->json([
                'message' => 'Unauthenticated.',
                'error' => ['code' => 'unauthenticated'],
            ], 401);
        });

        $exceptions->render(function (AuthorizationException $exception, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            return response()->json([
                'message' => 'Forbidden.',
                'error' => ['code' => 'forbidden'],
            ], 403);
        });

        $exceptions->render(function (TokenMismatchException $exception, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            return response()->json([
                'message' => 'Your session has expired. Refresh the CSRF token and try again.',
                'error' => ['code' => 'csrf_token_mismatch'],
            ], 419);
        });

        $exceptions->render(function (HttpExceptionInterface $exception, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            $status = $exception->getStatusCode();
            $code = match ($status) {
                401 => 'unauthenticated',
                403 => 'forbidden',
                404 => 'not_found',
                409 => 'conflict',
                419 => 'csrf_token_mismatch',
                422 => 'validation_failed',
                429 => 'rate_limited',
                default => 'request_failed',
            };
            $message = match ($status) {
                401 => 'Unauthenticated.',
                403 => 'Forbidden.',
                404 => 'Not found.',
                409 => 'The request conflicts with the current resource state.',
                419 => 'Your session has expired. Refresh the CSRF token and try again.',
                422 => 'The request is not valid.',
                429 => 'Too many requests.',
                default => 'The request could not be completed.',
            };

            return response()->json([
                'message' => $message,
                'error' => ['code' => $code],
            ], $status, $exception->getHeaders());
        });

        $exceptions->render(function (Throwable $exception, Request $request) {
            if (! $request->is('api/*') || $exception instanceof ValidationException || $exception instanceof HttpExceptionInterface) {
                return null;
            }

            report($exception);

            return response()->json([
                'message' => 'The request could not be completed.',
                'error' => ['code' => 'internal_error'],
            ], 500);
        });
    })->create();
