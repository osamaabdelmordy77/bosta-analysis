<?php

use App\Http\Controllers\AccessCatalogController;
use App\Http\Controllers\AuditLogController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\HubController;
use App\Http\Controllers\ImportController;
use App\Http\Controllers\LegacyImportController;
use App\Http\Controllers\MembershipController;
use App\Http\Controllers\OrganizationController;
use Illuminate\Support\Facades\Route;

Route::prefix('auth')->group(function (): void {
    Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:auth-login');
    Route::post('/forgot-password', [AuthController::class, 'requestPasswordReset'])->middleware('throttle:auth-password');
    Route::post('/reset-password', [AuthController::class, 'resetPassword'])->middleware('throttle:auth-password');

    Route::middleware(['session.expiry', 'auth:sanctum'])->group(function (): void {
        Route::post('/logout', [AuthController::class, 'logout']);
        Route::get('/user', [AuthController::class, 'current']);
    });
});

Route::middleware(['import.benchmark', 'session.expiry', 'auth:sanctum'])->group(function (): void {
    Route::get('/organizations', [OrganizationController::class, 'index']);

    Route::get('/auth/sessions', [AuthController::class, 'sessions']);
    Route::delete('/auth/sessions/others', [AuthController::class, 'revokeOtherSessions']);
    Route::delete('/auth/sessions/{reference}', [AuthController::class, 'revokeSession'])
        ->where('reference', '[a-f0-9]{64}');

    Route::prefix('organizations/{organization}')
        ->middleware(['organization.override', 'organization.resolve'])
        ->group(function (): void {
            Route::get('/members', [MembershipController::class, 'index'])->middleware('permission:members.view');
            Route::post('/members', [MembershipController::class, 'store'])->middleware('permission:members.manage');
            Route::patch('/members/{user}/role', [MembershipController::class, 'updateRole'])
                ->whereNumber('user')
                ->middleware('permission:roles.assign');
            Route::patch('/members/{user}/status', [MembershipController::class, 'updateStatus'])
                ->whereNumber('user')
                ->middleware('permission:members.manage');
            Route::put('/members/{user}/hubs', [MembershipController::class, 'updateHubAccess'])
                ->whereNumber('user')
                ->middleware('permission:hubs.manage_access');

            Route::get('/roles', [AccessCatalogController::class, 'roles'])->middleware('permission:roles.view');
            Route::get('/permissions', [AccessCatalogController::class, 'permissions'])->middleware('permission:roles.view');
            Route::get('/hubs', [HubController::class, 'index']);
            Route::get('/hubs/{hub}', [HubController::class, 'show']);
            Route::get('/audit-logs', [AuditLogController::class, 'index'])->middleware('permission:audit.view');

            Route::get('/imports', [ImportController::class, 'index']);
            Route::get('/imports/jobs', [ImportController::class, 'jobs'])->middleware('permission:imports.manage');
            Route::get('/imports/shipments', [ImportController::class, 'shipments']);
            Route::get('/settings', [ImportController::class, 'settings']);
            Route::put('/settings/{key}', [ImportController::class, 'saveSetting'])->whereIn('key', ['hubBasis', 'columnOverrides']);
            Route::post('/imports', [ImportController::class, 'store'])->middleware('permission:imports.manage');
            Route::post('/legacy-import-files', [LegacyImportController::class, 'start'])->middleware('permission:imports.manage');
            Route::post('/legacy-import-files/{legacyFile}/chunks/{chunk}', [LegacyImportController::class, 'appendChunk'])
                ->whereNumber('chunk')->middleware('permission:imports.manage');
            Route::post('/legacy-import-files/{legacyFile}/complete', [LegacyImportController::class, 'complete'])
                ->middleware('permission:imports.manage');
            Route::post('/imports/{importFile}/runs/{run}/retry', [ImportController::class, 'retry'])
                ->middleware('permission:imports.manage');
            Route::patch('/imports/{importFile}/date', [ImportController::class, 'updateDate'])
                ->middleware('permission:imports.manage');
            Route::delete('/imports/{importFile}', [ImportController::class, 'archive'])
                ->middleware('permission:imports.manage');
            Route::delete('/imports', [ImportController::class, 'archiveAll'])->middleware('permission:data.manage');
        });
});
