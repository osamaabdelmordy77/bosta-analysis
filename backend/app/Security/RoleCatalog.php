<?php

namespace App\Security;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class RoleCatalog
{
    /**
     * Fixed tenant roles. System Super Admin is a separately audited system principal,
     * not a tenant role and cannot be assigned through an organization API.
     *
     * @var array<string, array{name: string, permissions: list<string>}>
     */
    public const ROLES = [
        'organization-admin' => [
            'name' => 'Organization Admin',
            'permissions' => [
                'members.view', 'members.manage', 'roles.view', 'roles.assign',
                'hubs.view_all', 'hubs.manage_access',
                'hubs.view_assigned', 'hubs.manage_assigned',
                'shipments.view_all', 'imports.manage', 'imports.upload', 'imports.archive', 'analytics.view_all',
                'shipments.view_assigned', 'analytics.view_assigned',
                'analytics.export', 'audit.view', 'audit.export', 'data.manage',
            ],
        ],
        'data-manager' => [
            'name' => 'Data Manager',
            'permissions' => [
                'members.view', 'roles.view', 'hubs.view_all', 'shipments.view_all',
                'imports.manage', 'imports.upload', 'imports.archive', 'analytics.view_all', 'analytics.export', 'data.manage',
            ],
        ],
        'analyst' => [
            'name' => 'Analyst',
            'permissions' => [
                'members.view', 'roles.view', 'hubs.view_all', 'shipments.view_all',
                'imports.upload', 'imports.archive', 'analytics.view_all', 'analytics.export',
            ],
        ],
        'hub-manager' => [
            'name' => 'Hub Manager',
            'permissions' => [
                'hubs.view_assigned', 'hubs.manage_assigned',
                'shipments.view_assigned', 'analytics.view_assigned',
            ],
        ],
        'viewer' => [
            'name' => 'Viewer',
            'permissions' => [
                'hubs.view_assigned', 'shipments.view_assigned', 'analytics.view_assigned',
            ],
        ],
        'auditor' => [
            'name' => 'Auditor',
            'permissions' => [
                'members.view', 'roles.view', 'hubs.view_all', 'shipments.view_all',
                'analytics.view_all', 'audit.view', 'audit.export',
            ],
        ],
    ];

    /**
     * @var array<string, string>
     */
    public const PERMISSIONS = [
        'members.view' => 'View organization membership records.',
        'members.manage' => 'Create and update organization membership records.',
        'roles.view' => 'View the fixed organization role and permission catalog.',
        'roles.assign' => 'Assign a role no more privileged than the actor role.',
        'hubs.view_all' => 'View every hub in the current organization.',
        'hubs.view_assigned' => 'View hubs explicitly assigned to the current user.',
        'hubs.manage_assigned' => 'Manage assigned hub operations when hub management APIs are enabled.',
        'hubs.manage_access' => 'Manage hub assignments for organization members.',
        'shipments.view_all' => 'View shipment data for every hub in the organization.',
        'shipments.view_assigned' => 'View shipment data in explicitly assigned hubs.',
        'imports.manage' => 'Manage data imports when import APIs are enabled.',
        'imports.upload' => 'Upload shipment reports and view their processing status.',
        'imports.archive' => 'Archive one shipment report from the active dashboard while preserving its history.',
        'analytics.view_all' => 'View organization-wide analytics when analytics APIs are enabled.',
        'analytics.view_assigned' => 'View analytics limited to explicitly assigned hubs.',
        'analytics.export' => 'Export analytics when export APIs are enabled.',
        'audit.view' => 'View organization security and audit records.',
        'audit.export' => 'Export organization audit records when export APIs are enabled.',
        'data.manage' => 'Manage organization data when data management APIs are enabled.',
    ];

    public function syncOrganization(string $organizationId): void
    {
        DB::transaction(function () use ($organizationId): void {
            $now = now();

            foreach (self::PERMISSIONS as $name => $description) {
                DB::table('permissions')->upsert(
                    [['name' => $name, 'description' => $description, 'created_at' => $now, 'updated_at' => $now]],
                    ['name'],
                    ['description', 'updated_at'],
                );
            }

            $permissionIds = DB::table('permissions')
                ->whereIn('name', array_keys(self::PERMISSIONS))
                ->pluck('id', 'name');

            foreach (self::ROLES as $slug => $definition) {
                DB::table('roles')->upsert(
                    [[
                        'organization_id' => $organizationId,
                        'slug' => $slug,
                        'name' => $definition['name'],
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]],
                    ['organization_id', 'slug'],
                    ['name', 'updated_at'],
                );

                $roleId = (int) DB::table('roles')
                    ->where('organization_id', $organizationId)
                    ->where('slug', $slug)
                    ->value('id');

                DB::table('permission_role')->where('role_id', $roleId)->delete();
                $rows = [];

                foreach ($definition['permissions'] as $permission) {
                    $rows[] = [
                        'role_id' => $roleId,
                        'permission_id' => (int) $permissionIds[$permission],
                        'created_at' => $now,
                        'updated_at' => $now,
                    ];
                }

                DB::table('permission_role')->insert($rows);
            }
        });

        Log::channel('security')->notice('security.role_catalog_synchronized', [
            'organization_id' => $organizationId,
            'role_count' => count(self::ROLES),
            'permission_count' => count(self::PERMISSIONS),
        ]);
    }

    public function syncAllOrganizations(): int
    {
        $count = 0;
        foreach (DB::table('organizations')->select('id')->orderBy('id')->cursor() as $organization) {
            $this->syncOrganization((string) $organization->id);
            $count++;
        }

        return $count;
    }
}
