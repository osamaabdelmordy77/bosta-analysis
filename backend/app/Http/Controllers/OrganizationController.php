<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class OrganizationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        $organizations = DB::table('organization_user')
            ->join('organizations', 'organizations.id', '=', 'organization_user.organization_id')
            ->leftJoin('roles', function ($join): void {
                $join->on('roles.id', '=', 'organization_user.role_id')
                    ->on('roles.organization_id', '=', 'organization_user.organization_id');
            })
            ->where('organization_user.user_id', $user->id)
            ->where('organization_user.status', 'active')
            ->orderBy('organizations.name')
            ->get([
                'organizations.id',
                'organizations.name',
                'organizations.slug',
                'roles.id as role_id',
                'roles.name as role_name',
                'roles.slug as role_slug',
            ])
            ->map(fn ($organization): array => [
                'id' => $organization->id,
                'name' => $organization->name,
                'slug' => $organization->slug,
                'role' => $organization->role_id === null ? null : [
                    'id' => (int) $organization->role_id,
                    'name' => $organization->role_name,
                    'slug' => $organization->role_slug,
                ],
            ])
            ->all();

        if ($user->isSystemAdministrator()) {
            $organizations = DB::table('organizations')
                ->orderBy('name')
                ->get(['id', 'name', 'slug'])
                ->map(fn ($organization): array => [
                    'id' => $organization->id,
                    'name' => $organization->name,
                    'slug' => $organization->slug,
                    'role' => ['slug' => 'super-admin', 'name' => 'Super Admin'],
                ])
                ->all();
        }

        return $this->success(['organizations' => $organizations]);
    }
}
