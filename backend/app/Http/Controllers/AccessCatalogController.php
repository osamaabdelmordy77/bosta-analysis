<?php

namespace App\Http\Controllers;

use App\Models\Role;
use App\Security\AuthorizationService;
use App\Security\RoleCatalog;
use App\Tenancy\OrganizationContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class AccessCatalogController extends Controller
{
    public function roles(Request $request, AuthorizationService $authorization): JsonResponse
    {
        Gate::authorize('viewAny', Role::class);
        $organizationId = app(OrganizationContext::class)->requireId();

        $roles = DB::table('roles')
            ->where('organization_id', $organizationId)
            ->orderBy('id')
            ->get(['id', 'name', 'slug'])
            ->map(fn ($role): array => [
                'id' => (int) $role->id,
                'name' => $role->name,
                'slug' => $role->slug,
                'scope' => 'organization',
                'assignable' => true,
                'permissions' => $authorization->permissionNamesForRole((int) $role->id, $organizationId),
            ])
            ->all();

        if ($request->user()->isSystemAdministrator()) {
            array_unshift($roles, [
                'id' => null,
                'name' => 'Super Admin',
                'slug' => 'super-admin',
                'scope' => 'system',
                'assignable' => false,
                'permissions' => ['*'],
            ]);
        }

        return $this->success(['roles' => $roles]);
    }

    public function permissions(): JsonResponse
    {
        Gate::authorize('viewAny', Role::class);

        $permissions = DB::table('permissions')
            ->whereIn('name', array_keys(RoleCatalog::PERMISSIONS))
            ->orderBy('name')
            ->get(['name', 'description'])
            ->map(fn ($permission): array => [
                'name' => $permission->name,
                'description' => $permission->description,
            ])
            ->all();

        return $this->success(['permissions' => $permissions]);
    }
}
