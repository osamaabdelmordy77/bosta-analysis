<?php

namespace Tests\Feature;

use App\Models\Hub;
use App\Models\User;
use App\Security\RoleCatalog;
use App\Tenancy\OrganizationContext;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Request;
use Illuminate\Session\TokenMismatchException;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

class AuthAccessTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'mysql' || ! Schema::hasTable('system_administrator_events')) {
            self::markTestSkipped('Run security integration tests against the migrated MySQL test database.');
        }

        Notification::fake();
    }

    public function test_login_success_and_failures_are_generic_and_current_user_is_scoped(): void
    {
        $organizationId = $this->organization('login');
        $user = $this->member($organizationId, 'organization-admin', 'login@example.test');

        $response = $this->fromSpa()->postJson('/api/auth/login', [
            'email' => $user->email,
            'password' => 'correct horse battery staple',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.user.id', $user->id)
            ->assertJsonPath('data.user.memberships.0.organization.slug', 'login');

        $this->rememberSessionCookie($response);
        $this->fromSpa()->getJson('/api/auth/user')
            ->assertOk()
            ->assertJsonPath('data.user.email', $user->email);

        $wrongPassword = $this->fromSpa()->postJson('/api/auth/login', [
            'email' => $user->email,
            'password' => 'incorrect password',
        ]);
        $missingAccount = $this->fromSpa()->postJson('/api/auth/login', [
            'email' => 'missing@example.test',
            'password' => 'incorrect password',
        ]);

        self::assertSame(401, $wrongPassword->status());
        self::assertSame($wrongPassword->json(), $missingAccount->json());
        self::assertSame('invalid_credentials', $wrongPassword->json('error.code'));
    }

    public function test_repeated_login_failures_are_rate_limited(): void
    {
        $organizationId = $this->organization('login-throttle');
        $user = $this->member($organizationId, 'viewer', 'throttle@example.test');

        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->fromSpa()->postJson('/api/auth/login', [
                'email' => $user->email,
                'password' => 'wrong password',
            ])->assertUnauthorized();
        }

        $this->fromSpa()->postJson('/api/auth/login', [
            'email' => $user->email,
            'password' => 'wrong password',
        ])->assertStatus(429);
    }

    public function test_logout_invalidates_session_and_unauthenticated_requests_return_json_401(): void
    {
        $organizationId = $this->organization('logout');
        $user = $this->member($organizationId, 'organization-admin', 'logout@example.test');

        $login = $this->fromSpa()->postJson('/api/auth/login', [
            'email' => $user->email,
            'password' => 'correct horse battery staple',
        ])->assertOk();
        $this->rememberSessionCookie($login);
        $this->fromSpa()->getJson('/api/auth/user')->assertOk();
        $this->fromSpa()->postJson('/api/auth/logout')->assertOk();
        $this->assertDatabaseMissing('sessions', ['user_id' => $user->id]);
        Auth::forgetGuards();
        $this->fromSpa()->getJson('/api/auth/user')
            ->assertUnauthorized()
            ->assertJsonPath('error.code', 'unauthenticated');
    }

    public function test_csrf_cookie_is_available_and_csrf_mismatch_uses_the_api_error_contract(): void
    {
        $this->fromSpa()->get('/sanctum/csrf-cookie')->assertNoContent()->assertCookie('XSRF-TOKEN');

        Route::post('/api/test/csrf-mismatch', function () {
            throw new TokenMismatchException('token mismatch');
        });

        $this->fromSpa()->postJson('/api/test/csrf-mismatch')
            ->assertStatus(419)
            ->assertJsonPath('error.code', 'csrf_token_mismatch');

        $session = app('session')->driver('array');
        $session->start();
        $session->regenerateToken();
        $request = Request::create('/api/auth/login', 'POST');
        $request->setLaravelSession($session);
        $request->headers->set('X-CSRF-TOKEN', 'incorrect-token');
        $middleware = new StrictCsrfMiddleware(app(), app('encrypter'));

        try {
            $middleware->handle($request, fn () => response()->noContent());
            self::fail('The CSRF middleware accepted a mismatched token.');
        } catch (TokenMismatchException) {
            self::assertTrue(true);
        }
    }

    public function test_expired_sessions_are_not_listed_and_session_references_are_opaque(): void
    {
        $organizationId = $this->organization('sessions');
        $user = $this->member($organizationId, 'organization-admin', 'sessions@example.test');
        $this->authenticateAs($user);

        $this->fromSpa()->getJson('/api/auth/sessions')->assertOk();

        $expiredId = Str::random(40);
        DB::table('sessions')->insert([
            'id' => $expiredId,
            'user_id' => $user->id,
            'ip_address' => '192.0.2.1',
            'user_agent' => 'Synthetic test agent',
            'payload' => 'synthetic-session',
            'last_activity' => now()->subMinutes((int) config('session.lifetime') + 5)->getTimestamp(),
        ]);

        $response = $this->fromSpa()->getJson('/api/auth/sessions')->assertOk();
        self::assertFalse(collect($response->json('data.sessions'))->contains(
            fn (array $session): bool => $session['reference'] === hash_hmac('sha256', $expiredId, (string) config('app.key'))
        ));
        self::assertSame([], array_intersect(['id', 'ip_address', 'payload'], array_keys($response->json('data.sessions.0') ?? [])));
    }

    public function test_expired_database_session_cannot_authenticate_the_next_request(): void
    {
        self::assertSame('database', config('session.driver'));
        $organizationId = $this->organization('session-expiry');
        $user = $this->member($organizationId, 'viewer', 'session-expiry@example.test');

        $login = $this->fromSpa()->postJson('/api/auth/login', [
            'email' => $user->email,
            'password' => 'correct horse battery staple',
        ])->assertOk();
        $this->rememberSessionCookie($login);

        $session = DB::table('sessions')->where('user_id', $user->id)->orderByDesc('last_activity')->first();
        self::assertNotNull($session);
        DB::table('sessions')->where('id', $session->id)->update([
            'last_activity' => now()->subMinutes((int) config('session.lifetime') + 5)->getTimestamp(),
        ]);
        Auth::forgetGuards();

        $this->fromSpa()->getJson('/api/auth/user')
            ->assertUnauthorized()
            ->assertJsonPath('error.code', 'unauthenticated');
    }

    public function test_a_user_can_revoke_only_their_own_opaque_session_reference(): void
    {
        $organizationId = $this->organization('session-revoke');
        $user = $this->member($organizationId, 'viewer', 'session-revoke@example.test');
        $otherUser = $this->member($organizationId, 'viewer', 'other-session-owner@example.test');
        $revokedId = Str::random(40);
        $otherOwnerId = Str::random(40);

        foreach ([[$revokedId, $user->id], [$otherOwnerId, $otherUser->id]] as [$id, $ownerId]) {
            DB::table('sessions')->insert([
                'id' => $id,
                'user_id' => $ownerId,
                'ip_address' => '192.0.2.10',
                'user_agent' => 'Synthetic agent',
                'payload' => 'synthetic-session',
                'last_activity' => now()->getTimestamp(),
            ]);
        }

        $this->authenticateAs($user);
        $reference = hash_hmac('sha256', $revokedId, (string) config('app.key'));

        $this->fromSpa()->deleteJson('/api/auth/sessions/'.$reference)->assertOk();
        $this->assertDatabaseMissing('sessions', ['id' => $revokedId]);
        $this->assertDatabaseHas('sessions', ['id' => $otherOwnerId, 'user_id' => $otherUser->id]);
    }

    public function test_local_vite_origin_receives_credentialed_cors_headers(): void
    {
        $response = $this->call('OPTIONS', '/api/auth/login', [], [], [], [
            'HTTP_ORIGIN' => 'http://localhost:3000',
            'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'POST',
            'HTTP_ACCESS_CONTROL_REQUEST_HEADERS' => 'content-type,x-xsrf-token',
        ]);

        $response->assertNoContent()
            ->assertHeader('access-control-allow-origin', 'http://localhost:3000')
            ->assertHeader('access-control-allow-credentials', 'true');
    }

    public function test_password_reset_requests_do_not_disclose_account_existence(): void
    {
        $organizationId = $this->organization('reset');
        $user = $this->member($organizationId, 'viewer', 'reset@example.test');

        $existing = $this->fromSpa()->postJson('/api/auth/forgot-password', ['email' => $user->email]);
        $missing = $this->fromSpa()->postJson('/api/auth/forgot-password', ['email' => 'absent@example.test']);

        self::assertSame(202, $existing->status());
        self::assertSame($existing->json(), $missing->json());
        Notification::assertSentTo($user, ResetPassword::class);
    }

    public function test_membership_creation_uses_a_reset_link_and_audits_without_personal_data(): void
    {
        $organizationId = $this->organization('member-create');
        $admin = $this->member($organizationId, 'organization-admin', 'member-admin@example.test');
        $this->authenticateAs($admin);

        $response = $this->fromSpa()->postJson('/api/organizations/member-create/members', [
            'name' => 'Synthetic Invite',
            'email' => 'invite@example.test',
            'role_id' => $this->roleId($organizationId, 'viewer'),
        ])->assertCreated()
            ->assertJsonPath('data.member.status', 'active')
            ->assertJsonPath('data.password_setup_email_requested', true);

        $newMemberId = (int) $response->json('data.member.id');
        $this->assertDatabaseHas('organization_user', [
            'organization_id' => $organizationId,
            'user_id' => $newMemberId,
            'status' => 'active',
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'organization_id' => $organizationId,
            'actor_id' => $admin->id,
            'action' => 'membership.created',
        ]);
        Notification::assertSentTo(User::findOrFail($newMemberId), ResetPassword::class);
        $auditMetadata = json_decode((string) DB::table('audit_logs')
            ->where('action', 'membership.created')
            ->where('organization_id', $organizationId)
            ->value('metadata'), true, flags: JSON_THROW_ON_ERROR);
        $metadataKeys = array_keys($auditMetadata);
        sort($metadataKeys);
        self::assertSame(['role_id', 'status'], $metadataKeys);
    }

    public function test_organizations_are_resolved_from_verified_membership_and_context_is_cleared(): void
    {
        $organizationA = $this->organization('tenant-a');
        $organizationB = $this->organization('tenant-b');
        $user = $this->member($organizationA, 'organization-admin', 'tenant-user@example.test');
        $this->authenticateAs($user);

        $this->fromSpa()->getJson('/api/organizations/tenant-a/roles')->assertOk();
        self::assertNull(app(OrganizationContext::class)->id());

        $this->fromSpa()->getJson('/api/organizations/tenant-b/roles')
            ->assertNotFound()
            ->assertJsonPath('error.code', 'not_found');

        $this->fromSpa()->getJson('/api/organizations/'.$organizationB.'/roles')
            ->assertNotFound();

        $this->assertSame(0, Hub::query()->count());
    }

    public function test_missing_or_suspended_membership_is_denied_and_client_cannot_override_tenant(): void
    {
        $organizationId = $this->organization('membership-check');
        $user = $this->member($organizationId, 'viewer', 'suspended@example.test', 'suspended');
        $this->authenticateAs($user);

        $this->fromSpa()->getJson('/api/organizations/membership-check/hubs')->assertNotFound();

        DB::table('organization_user')->where('user_id', $user->id)->update(['status' => 'active']);
        $this->fromSpa()
            ->withHeader('X-Organization-ID', $organizationId)
            ->getJson('/api/organizations/membership-check/hubs')
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'organization_override_rejected');

        $this->fromSpa()->postJson('/api/organizations/membership-check/members', [
            'name' => 'Synthetic',
            'email' => 'other@example.test',
            'role_id' => $this->roleId($organizationId, 'viewer'),
            'organization_id' => $organizationId,
        ])->assertStatus(422);
    }

    public function test_hub_manager_can_only_list_and_fetch_assigned_hubs(): void
    {
        $organizationId = $this->organization('hub-scope');
        $user = $this->member($organizationId, 'hub-manager', 'hub-manager@example.test');
        $assignedHubId = $this->hub($organizationId, 'Assigned Hub');
        $otherHubId = $this->hub($organizationId, 'Other Hub');
        DB::table('user_hub_access')->insert([
            'organization_id' => $organizationId,
            'user_id' => $user->id,
            'hub_id' => $assignedHubId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->actingAs($user);

        $this->fromSpa()->getJson('/api/organizations/hub-scope/hubs')
            ->assertOk()
            ->assertJsonCount(1, 'data.hubs')
            ->assertJsonPath('data.hubs.0.id', $assignedHubId);

        $this->fromSpa()->getJson('/api/organizations/hub-scope/hubs/'.$otherHubId)
            ->assertNotFound();
    }

    public function test_organization_admin_can_manage_other_members_hubs_but_not_promote_themselves(): void
    {
        $organizationId = $this->organization('hub-access-admin');
        $admin = $this->member($organizationId, 'organization-admin', 'hub-access-admin@example.test');
        $member = $this->member($organizationId, 'viewer', 'hub-access-member@example.test');
        $hubId = $this->hub($organizationId, 'Managed Hub');
        $this->authenticateAs($admin);

        $this->fromSpa()->putJson('/api/organizations/hub-access-admin/members/'.$admin->id.'/hubs', [
            'hub_ids' => [$hubId],
        ])->assertForbidden();

        $this->fromSpa()->putJson('/api/organizations/hub-access-admin/members/'.$member->id.'/hubs', [
            'hub_ids' => [$hubId],
        ])->assertOk()->assertJsonPath('data.added_count', 1);

        $this->assertDatabaseHas('user_hub_access', [
            'organization_id' => $organizationId,
            'user_id' => $member->id,
            'hub_id' => $hubId,
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'organization_id' => $organizationId,
            'actor_id' => $admin->id,
            'action' => 'membership.hub_access_changed',
        ]);
    }

    public function test_non_admin_cannot_assign_a_more_privileged_role(): void
    {
        $organizationId = $this->organization('role-guard');
        $analyst = $this->member($organizationId, 'analyst', 'analyst@example.test');
        $viewer = $this->member($organizationId, 'viewer', 'viewer@example.test');
        $this->authenticateAs($analyst);

        $this->fromSpa()->patchJson('/api/organizations/role-guard/members/'.$viewer->id.'/role', [
            'role_id' => $this->roleId($organizationId, 'organization-admin'),
        ])->assertForbidden();

    }

    public function test_admin_can_assign_a_role_and_cannot_change_its_own_role(): void
    {
        $organizationId = $this->organization('admin-role-change');
        $admin = $this->member($organizationId, 'organization-admin', 'admin@example.test');
        $this->authenticateAs($admin);
        $this->fromSpa()->patchJson('/api/organizations/admin-role-change/members/'.$admin->id.'/role', [
            'role_id' => $this->roleId($organizationId, 'viewer'),
        ])->assertForbidden();

        $viewer = $this->member($organizationId, 'viewer', 'role-target@example.test');
        $this->fromSpa()->patchJson('/api/organizations/admin-role-change/members/'.$viewer->id.'/role', [
            'role_id' => $this->roleId($organizationId, 'organization-admin'),
        ])->assertOk();

        $this->assertDatabaseHas('audit_logs', [
            'organization_id' => $organizationId,
            'actor_id' => $admin->id,
            'action' => 'membership.role_changed',
        ]);
    }

    public function test_audit_logs_are_denied_to_roles_without_audit_permission(): void
    {
        $organizationId = $this->organization('audit');
        $analyst = $this->member($organizationId, 'analyst', 'audit-analyst@example.test');
        $this->authenticateAs($analyst);

        $this->fromSpa()->getJson('/api/organizations/audit/audit-logs')->assertForbidden();
    }

    public function test_auditor_can_read_sanitized_audit_records(): void
    {
        $organizationId = $this->organization('audit-readable');
        $auditor = $this->member($organizationId, 'auditor', 'audit-reader@example.test');
        DB::table('audit_logs')->insert([
            'id' => (string) Str::ulid(),
            'organization_id' => $organizationId,
            'actor_id' => null,
            'action' => 'synthetic.event',
            'subject_type' => 'user',
            'subject_id' => '42',
            'metadata' => json_encode(['status' => 'active']),
            'created_at' => now(),
        ]);
        $this->authenticateAs($auditor);
        $this->fromSpa()->getJson('/api/organizations/audit-readable/audit-logs')
            ->assertOk()
            ->assertJsonPath('data.audit_logs.0.action', 'synthetic.event')
            ->assertJsonMissingPath('data.audit_logs.0.email')
            ->assertJsonMissingPath('data.audit_logs.0.ip_address');
    }

    public function test_admin_can_suspend_another_member_and_audit_the_change(): void
    {
        $organizationId = $this->organization('membership-status');
        $admin = $this->member($organizationId, 'organization-admin', 'status-admin@example.test');
        $member = $this->member($organizationId, 'viewer', 'status-member@example.test');
        $this->authenticateAs($admin);

        $this->fromSpa()->patchJson('/api/organizations/membership-status/members/'.$member->id.'/status', [
            'status' => 'suspended',
        ])->assertOk()->assertJsonPath('data.status', 'suspended');

        $this->assertDatabaseHas('organization_user', [
            'organization_id' => $organizationId,
            'user_id' => $member->id,
            'status' => 'suspended',
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'organization_id' => $organizationId,
            'actor_id' => $admin->id,
            'action' => 'membership.status_changed',
        ]);
    }

    public function test_membership_and_access_catalog_endpoints_return_paginated_scoped_data(): void
    {
        $organizationId = $this->organization('catalog-api');
        $admin = $this->member($organizationId, 'organization-admin', 'catalog-admin@example.test');
        $member = $this->member($organizationId, 'viewer', 'catalog-viewer@example.test');
        $this->authenticateAs($admin);

        $this->fromSpa()->getJson('/api/organizations/catalog-api/members?per_page=1')
            ->assertOk()
            ->assertJsonCount(1, 'data.members')
            ->assertJsonPath('data.pagination.per_page', 1);
        $this->fromSpa()->getJson('/api/organizations/catalog-api/roles')
            ->assertOk()
            ->assertJsonPath('data.roles.0.scope', 'organization');
        $this->fromSpa()->getJson('/api/organizations/catalog-api/permissions')
            ->assertOk()
            ->assertJsonPath('data.permissions.0.name', 'analytics.export');

        $this->assertDatabaseHas('organization_user', [
            'organization_id' => $organizationId,
            'user_id' => $member->id,
        ]);
    }

    public function test_public_registration_is_not_exposed_and_system_admin_grants_are_audited(): void
    {
        $this->fromSpa()->postJson('/api/register', [
            'name' => 'No Registration',
            'email' => 'signup@example.test',
            'password' => 'correct horse battery staple',
        ])->assertNotFound();

        $user = User::factory()->create(['email' => 'system-admin@example.test']);
        $this->artisan('security:grant-super-admin', ['email' => $user->email])
            ->expectsConfirmation('Grant global Super Admin access to this user?', 'yes')
            ->assertExitCode(0);

        self::assertTrue($user->fresh()->isSystemAdministrator());
        self::assertDatabaseHas('system_administrator_events', [
            'user_id' => $user->id,
            'action' => 'granted',
            'source' => 'console',
        ]);

        $backupAdministrator = User::factory()->create(['email' => 'backup-system-admin@example.test']);
        $this->artisan('security:grant-super-admin', ['email' => $backupAdministrator->email])
            ->expectsConfirmation('Grant global Super Admin access to this user?', 'yes')
            ->assertExitCode(0);

        $this->artisan('security:revoke-super-admin', ['email' => $user->email])
            ->expectsConfirmation('Revoke global Super Admin access from this user?', 'yes')
            ->assertExitCode(0);
        self::assertFalse($user->fresh()->isSystemAdministrator());
        self::assertTrue($backupAdministrator->fresh()->isSystemAdministrator());
        $this->assertDatabaseHas('system_administrator_events', [
            'user_id' => $user->id,
            'action' => 'revoked',
            'source' => 'console',
        ]);
    }

    public function test_console_bootstrap_creates_the_first_admin_without_public_registration(): void
    {
        $this->artisan('security:bootstrap-organization', [
            'slug' => 'initial-org',
            'organization_name' => 'Initial Synthetic Organization',
            'admin_name' => 'Initial Admin',
            'email' => 'initial-admin@example.test',
        ])->expectsConfirmation('Create this organization and grant its first Organization Admin role?', 'yes')
            ->assertExitCode(0);

        $this->assertDatabaseHas('organization_user', [
            'organization_id' => DB::table('organizations')->where('slug', 'initial-org')->value('id'),
            'user_id' => User::query()->where('email', 'initial-admin@example.test')->value('id'),
            'status' => 'active',
        ]);
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'membership.bootstrap_admin',
            'subject_type' => 'user',
        ]);
        Notification::assertSentTo(
            User::query()->where('email', 'initial-admin@example.test')->firstOrFail(),
            ResetPassword::class,
        );
    }

    public function test_role_catalog_synchronization_is_idempotent(): void
    {
        $organizationId = $this->organization('role-catalog');
        app(RoleCatalog::class)->syncOrganization($organizationId);

        self::assertSame(count(RoleCatalog::ROLES), DB::table('roles')->where('organization_id', $organizationId)->count());
        self::assertSame(count(RoleCatalog::PERMISSIONS), DB::table('permissions')->count());
        self::assertSame(
            count(RoleCatalog::ROLES),
            DB::table('roles')->where('organization_id', $organizationId)->distinct('slug')->count('slug'),
        );
    }

    private function organization(string $slug): string
    {
        $id = (string) Str::ulid();
        DB::table('organizations')->insert([
            'id' => $id,
            'name' => 'Synthetic '.str_replace('-', ' ', $slug),
            'slug' => $slug,
            'timezone' => 'Africa/Cairo',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        app(RoleCatalog::class)->syncOrganization($id);

        return $id;
    }

    private function member(string $organizationId, string $roleSlug, string $email, string $status = 'active'): User
    {
        $user = User::factory()->create([
            'name' => 'Synthetic User',
            'email' => $email,
            'password' => 'correct horse battery staple',
        ]);

        DB::table('organization_user')->insert([
            'organization_id' => $organizationId,
            'user_id' => $user->id,
            'role_id' => $this->roleId($organizationId, $roleSlug),
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $user;
    }

    private function roleId(string $organizationId, string $roleSlug): int
    {
        return (int) DB::table('roles')
            ->where('organization_id', $organizationId)
            ->where('slug', $roleSlug)
            ->value('id');
    }

    private function hub(string $organizationId, string $name): string
    {
        $id = (string) Str::ulid();
        DB::table('hubs')->insert([
            'id' => $id,
            'organization_id' => $organizationId,
            'canonical_name' => $name,
            'canonical_name_hash' => hash('sha256', $name, true),
            'external_code' => null,
            'external_code_hash' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $id;
    }

    private function fromSpa(): static
    {
        return $this->withCredentials()->withHeaders([
            'Origin' => 'http://localhost:3000',
            'Referer' => 'http://localhost:3000/',
        ]);
    }

    private function rememberSessionCookie(TestResponse $response): void
    {
        $cookie = $response->getCookie((string) config('session.cookie'));
        self::assertNotNull($cookie, 'The SPA login response must set a session cookie.');
        $this->withCookie((string) config('session.cookie'), $cookie->getValue());
    }

    private function authenticateAs(User $user): void
    {
        Auth::forgetGuards();
        $this->actingAs($user, 'web');
    }
}

class StrictCsrfMiddleware extends ValidateCsrfToken
{
    protected function runningUnitTests(): bool
    {
        return false;
    }
}
