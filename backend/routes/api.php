<?php

use App\Http\Controllers\AccessCatalogController;
use App\Http\Controllers\AuditLogController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\BostaMissScanController;
use App\Http\Controllers\CarsSheetController;
use App\Http\Controllers\HubController;
use App\Http\Controllers\ImportController;
use App\Http\Controllers\LegacyImportController;
use App\Http\Controllers\LoadingManifestController;
use App\Http\Controllers\MembershipController;
use App\Http\Controllers\OrganizationController;
use App\Http\Controllers\ReceiveVolumeExportController;
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
            Route::get('/loading/cars', [CarsSheetController::class, 'show']);
            Route::prefix('loading/manifests')->middleware('permission:shipments.view_all')->group(function (): void {
                Route::get('/cars', [LoadingManifestController::class, 'cars']);
                Route::get('/', [LoadingManifestController::class, 'index']);
                Route::post('/', [LoadingManifestController::class, 'store'])->middleware(['permission:imports.manage', 'throttle:10,1']);
                Route::get('/{date}/{id}', [LoadingManifestController::class, 'show'])
                    ->where('date', '\d{4}-\d{2}-\d{2}')->whereUlid('id');
            });
            Route::prefix('miss-scan')->middleware('permission:shipments.view_all')->group(function (): void {
                Route::get('/connection', [BostaMissScanController::class, 'status']);
                Route::post('/connection', [BostaMissScanController::class, 'connect'])->middleware('throttle:auth-login');
                Route::delete('/connection', [BostaMissScanController::class, 'disconnect']);
                Route::get('/hubs', [BostaMissScanController::class, 'hubs']);
                Route::get('/seals/pages/{page}', [BostaMissScanController::class, 'sealsPage'])->whereNumber('page');
                Route::get('/master-seals/pages/{page}', [BostaMissScanController::class, 'masterSealsPage'])->whereNumber('page');
                Route::get('/master-seals/{sealNumber}/manifest', [BostaMissScanController::class, 'masterSealManifest']);
                Route::get('/count', [BostaMissScanController::class, 'count']);
                Route::get('/pages/{page}', [BostaMissScanController::class, 'page'])->whereNumber('page');
                Route::get('/deliveries/{deliveryId}', [BostaMissScanController::class, 'details']);
                Route::post('/history/count', [BostaMissScanController::class, 'historyCount']);
                Route::post('/history/pages/{page}', [BostaMissScanController::class, 'historyPage'])->whereNumber('page');
                Route::post('/history/details', [BostaMissScanController::class, 'historyDetails']);
                Route::post('/history/lookup', [BostaMissScanController::class, 'historyLookup']);
            });
            Route::get('/hubs/{hub}', [HubController::class, 'show']);
            Route::get('/audit-logs', [AuditLogController::class, 'index'])->middleware('permission:audit.view');

            Route::get('/imports', [ImportController::class, 'index']);
            Route::get('/imports/jobs', [ImportController::class, 'jobs'])->middleware('permission:imports.upload');
            Route::get('/imports/shipments', [ImportController::class, 'shipments']);
            Route::post('/receive/volume/export', ReceiveVolumeExportController::class)->middleware('throttle:10,1');
            Route::get('/settings', [ImportController::class, 'settings']);
            Route::put('/settings/{key}', [ImportController::class, 'saveSetting'])->whereIn('key', ['hubBasis', 'columnOverrides']);
            Route::post('/imports', [ImportController::class, 'store'])->middleware('permission:imports.upload');
            Route::post('/legacy-import-files', [LegacyImportController::class, 'start'])->middleware('permission:imports.upload');
            Route::post('/legacy-import-files/{legacyFile}/chunks/{chunk}', [LegacyImportController::class, 'appendChunk'])
                ->whereNumber('chunk')->middleware('permission:imports.upload');
            Route::post('/legacy-import-files/{legacyFile}/complete', [LegacyImportController::class, 'complete'])
                ->middleware('permission:imports.upload');
            Route::post('/imports/{importFile}/runs/{run}/retry', [ImportController::class, 'retry'])
                ->middleware('permission:imports.manage');
            Route::patch('/imports/{importFile}/date', [ImportController::class, 'updateDate'])
                ->middleware('permission:imports.manage');
            Route::delete('/imports/{importFile}', [ImportController::class, 'archive']);
            Route::delete('/imports', [ImportController::class, 'archiveAll'])->middleware('permission:data.manage');
        });
});
