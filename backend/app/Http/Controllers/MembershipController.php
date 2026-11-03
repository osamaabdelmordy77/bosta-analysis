<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Security\AuditLogService;
use App\Security\AuthorizationService;
use App\Security\SecurityEventLogger;
use App\Tenancy\OrganizationContext;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpKernel\Exception\HttpException;

class MembershipController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', User::class);
        $organizationId = app(OrganizationContext::class)->requireId();
        $validated = $request->validate(['per_page' => ['sometimes', 'integer', 'min:1', 'max:100']]);
        $perPage = (int) ($validated['per_page'] ?? 50);

        $members = DB::table('organization_user')
            ->join('users', 'users.id', '=', 'organization_user.user_id')
            ->leftJoin('roles', function ($join): void {
                $join->on('roles.id', '=', 'organization_user.role_id')
                    ->on('roles.organization_id', '=', 'organization_user.organization_id');
            })
            ->where('organization_user.organization_id', $organizationId)
            ->orderBy('users.id')
            ->cursorPaginate($perPage, [
                'users.id', 'users.name', 'users.email',
                'organization_user.status', 'organization_user.role_id',
                'organization_user.created_at as joined_at',
                'roles.name as role_name', 'roles.slug as role_slug',
            ])
            ->through(fn ($member): array => [
                'id' => (int) $member->id,
                'name' => $member->name,
                'email' => $member->email,
                'status' => $member->status,
                'joined_at' => $member->joined_at,
                'role' => $member->role_id === null ? null : [
                    'id' => (int) $member->role_id,
                    'name' => $member->role_name,
                    'slug' => $member->role_slug,
                ],
            ]);

        return $this->success([
            'members' => $members->items(),
            'pagination' => [
                'next_cursor' => $members->nextCursor()?->encode(),
                'previous_cursor' => $members->previousCursor()?->encode(),
                'per_page' => $members->perPage(),
            ],
        ]);
    }

    public function store(
        Request $request,
        AuthorizationService $authorization,
        AuditLogService $auditLog,
        SecurityEventLogger $securityEvents,
    ): JsonResponse {
        Gate::authorize('create', User::class);
        $organizationId = app(OrganizationContext::class)->requireId();
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'string', 'email:rfc', 'max:254'],
            'role_id' => ['required', 'integer', Rule::exists('roles', 'id')->where('organization_id', $organizationId)],
        ]);
        $roleId = (int) $validated['role_id'];

        if (! $authorization->mayAssignRole($request->user(), $roleId, $organizationId)) {
            throw new AuthorizationException('Forbidden.');
        }

        $email = mb_strtolower(trim($validated['email']));
        $wasCreated = false;
        $member = DB::transaction(function () use ($request, $organizationId, $validated, $roleId, $email, &$wasCreated, $auditLog): User {
            $roleExists = DB::table('roles')
                ->where('organization_id', $organizationId)
                ->where('id', $roleId)
                ->lockForUpdate()
                ->exists();
            abort_unless($roleExists, 404, 'Not found.');

            $member = User::query()->where('email', $email)->lockForUpdate()->first();
            if (! $member) {
                $member = User::query()->create([
                    'name' => trim($validated['name']),
                    'email' => $email,
                    'password' => Str::random(48),
                ]);
                $wasCreated = true;
            }

            $membership = DB::table('organization_user')
                ->where('organization_id', $organizationId)
                ->where('user_id', $member->id)
                ->lockForUpdate()
                ->first();

            if ($membership) {
                throw new HttpException(409, 'This user is already a member of the organization.');
            }

            DB::table('organization_user')->insert([
                'organization_id' => $organizationId,
                'user_id' => $member->id,
                'role_id' => $roleId,
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $auditLog->record($request->user(), 'membership.created', 'user', (string) $member->id, [
                'role_id' => $roleId,
                'status' => 'active',
            ]);

            return $member;
        });

        if ($wasCreated) {
            try {
                Password::sendResetLink(['email' => $email]);
            } catch (\Throwable) {
                $securityEvents->record('security.member_invite_delivery_failed', (int) $member->id, $request);
            }
        }

        return $this->success([
            'member' => [
                'id' => (int) $member->id,
                'name' => $member->name,
                'email' => $member->email,
                'status' => 'active',
                'role_id' => $roleId,
            ],
            'password_setup_email_requested' => $wasCreated,
        ], 201);
    }

    public function updateRole(
        Request $request,
        string $organization,
        int $user,
        AuthorizationService $authorization,
        AuditLogService $auditLog,
    ): JsonResponse {
        $organizationId = app(OrganizationContext::class)->requireId();
        $validated = $request->validate([
            'role_id' => ['required', 'integer', Rule::exists('roles', 'id')->where('organization_id', $organizationId)],
        ]);
        $roleId = (int) $validated['role_id'];
        $member = $this->findMember($organizationId, $user);
        Gate::authorize('assignRole', [$member, $roleId]);

        $previousRoleId = DB::transaction(function () use ($organizationId, $member, $roleId, $request, $auditLog): ?int {
            DB::table('organizations')->where('id', $organizationId)->lockForUpdate()->first();
            $membership = DB::table('organization_user')
                ->where('organization_id', $organizationId)
                ->where('user_id', $member->id)
                ->lockForUpdate()
                ->first();
            abort_unless($membership, 404, 'Not found.');

            $previousRoleId = $membership->role_id === null ? null : (int) $membership->role_id;
            if ($previousRoleId !== $roleId) {
                $this->protectLastOrganizationAdmin($organizationId, $member, $previousRoleId, $roleId);
                DB::table('organization_user')
                    ->where('organization_id', $organizationId)
                    ->where('user_id', $member->id)
                    ->update(['role_id' => $roleId, 'updated_at' => now()]);
                $auditLog->record($request->user(), 'membership.role_changed', 'user', (string) $member->id, [
                    'previous_role_id' => $previousRoleId,
                    'role_id' => $roleId,
                ]);
            }

            return $previousRoleId;
        });

        return $this->success([
            'member_id' => (int) $member->id,
            'previous_role_id' => $previousRoleId,
            'role_id' => $roleId,
        ]);
    }

    public function updateStatus(
        Request $request,
        string $organization,
        int $user,
        AuditLogService $auditLog,
    ): JsonResponse {
        $validated = $request->validate([
            'status' => ['required', Rule::in(['active', 'suspended'])],
        ]);
        $organizationId = app(OrganizationContext::class)->requireId();
        $member = $this->findMember($organizationId, $user);
        Gate::authorize('updateStatus', $member);

        $previousStatus = DB::transaction(function () use ($organizationId, $member, $validated, $request, $auditLog): string {
            DB::table('organizations')->where('id', $organizationId)->lockForUpdate()->first();
            $membership = DB::table('organization_user')
                ->where('organization_id', $organizationId)
                ->where('user_id', $member->id)
                ->lockForUpdate()
                ->first();
            abort_unless($membership, 404, 'Not found.');

            $previousStatus = (string) $membership->status;
            if ($previousStatus !== $validated['status']) {
                if ($validated['status'] !== 'active') {
                    $this->protectLastOrganizationAdmin(
                        $organizationId,
                        $member,
                        $membership->role_id === null ? null : (int) $membership->role_id,
                        null,
                    );
                }

                DB::table('organization_user')
                    ->where('organization_id', $organizationId)
                    ->where('user_id', $member->id)
                    ->update(['status' => $validated['status'], 'updated_at' => now()]);
                $auditLog->record($request->user(), 'membership.status_changed', 'user', (string) $member->id, [
                    'previous_status' => $previousStatus,
                    'status' => $validated['status'],
                ]);
            }

            return $previousStatus;
        });

        return $this->success([
            'member_id' => (int) $member->id,
            'previous_status' => $previousStatus,
            'status' => $validated['status'],
        ]);
    }

    public function updateHubAccess(
        Request $request,
        string $organization,
        int $user,
        AuditLogService $auditLog,
    ): JsonResponse {
        $organizationId = app(OrganizationContext::class)->requireId();
        $validated = $request->validate([
            'hub_ids' => ['required', 'array', 'max:1000'],
            'hub_ids.*' => [
                'required', 'string', 'distinct', 'ulid',
                Rule::exists('hubs', 'id')->where('organization_id', $organizationId),
            ],
        ]);
        $member = $this->findMember($organizationId, $user);
        Gate::authorize('updateHubAccess', $member);
        $hubIds = array_values($validated['hub_ids']);

        $change = DB::transaction(function () use ($organizationId, $member, $hubIds, $request, $auditLog): array {
            DB::table('organizations')->where('id', $organizationId)->lockForUpdate()->first();
            $membershipExists = DB::table('organization_user')
                ->where('organization_id', $organizationId)
                ->where('user_id', $member->id)
                ->lockForUpdate()
                ->exists();
            abort_unless($membershipExists, 404, 'Not found.');

            $currentHubIds = DB::table('user_hub_access')
                ->where('organization_id', $organizationId)
                ->where('user_id', $member->id)
                ->orderBy('hub_id')
                ->pluck('hub_id')
                ->map(fn ($hubId): string => (string) $hubId)
                ->all();
            sort($hubIds);
            $added = array_values(array_diff($hubIds, $currentHubIds));
            $removed = array_values(array_diff($currentHubIds, $hubIds));

            if ($added !== [] || $removed !== []) {
                DB::table('user_hub_access')
                    ->where('organization_id', $organizationId)
                    ->where('user_id', $member->id)
                    ->delete();

                foreach (array_chunk($hubIds, 500) as $batch) {
                    DB::table('user_hub_access')->insert(array_map(
                        fn (string $hubId): array => [
                            'organization_id' => $organizationId,
                            'user_id' => (int) $member->id,
                            'hub_id' => $hubId,
                            'created_at' => now(),
                            'updated_at' => now(),
                        ],
                        $batch,
                    ));
                }

                $auditLog->record($request->user(), 'membership.hub_access_changed', 'user', (string) $member->id, [
                    'hub_count' => count($hubIds),
                    'added_count' => count($added),
                    'removed_count' => count($removed),
                ]);
            }

            return ['added_count' => count($added), 'removed_count' => count($removed)];
        });

        return $this->success([
            'member_id' => (int) $member->id,
            'hub_ids' => $hubIds,
            ...$change,
        ]);
    }

    private function findMember(string $organizationId, int $userId): User
    {
        return User::query()
            ->whereExists(function ($query) use ($organizationId): void {
                $query->selectRaw('1')
                    ->from('organization_user')
                    ->whereColumn('organization_user.user_id', 'users.id')
                    ->where('organization_user.organization_id', $organizationId);
            })
            ->whereKey($userId)
            ->firstOrFail();
    }

    private function protectLastOrganizationAdmin(
        string $organizationId,
        User $member,
        ?int $previousRoleId,
        ?int $nextRoleId,
    ): void {
        if ($previousRoleId === null || $previousRoleId === $nextRoleId) {
            return;
        }

        $wasAdmin = DB::table('roles')->where('id', $previousRoleId)->where('slug', 'organization-admin')->exists();
        if (! $wasAdmin) {
            return;
        }

        $remainingAdmins = DB::table('organization_user')
            ->join('roles', function ($join): void {
                $join->on('roles.id', '=', 'organization_user.role_id')
                    ->on('roles.organization_id', '=', 'organization_user.organization_id');
            })
            ->where('organization_user.organization_id', $organizationId)
            ->where('organization_user.status', 'active')
            ->where('roles.slug', 'organization-admin')
            ->where('organization_user.user_id', '!=', $member->id)
            ->exists();

        if (! $remainingAdmins) {
            throw new HttpException(409, 'The organization must retain at least one active Organization Admin.');
        }
    }
}
