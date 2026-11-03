<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Security\AuditLogService;
use App\Security\RoleCatalog;
use App\Security\SecurityEventLogger;
use App\Tenancy\OrganizationContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;

class BootstrapOrganization extends Command
{
    protected $signature = 'security:bootstrap-organization {slug} {organization_name} {admin_name} {email}';

    protected $description = 'Create an organization and its first Organization Admin through a confirmed console operation.';

    public function handle(
        RoleCatalog $catalog,
        AuditLogService $auditLog,
        OrganizationContext $context,
        SecurityEventLogger $securityEvents,
    ): int {
        $slug = mb_strtolower(trim((string) $this->argument('slug')));
        $organizationName = trim((string) $this->argument('organization_name'));
        $adminName = trim((string) $this->argument('admin_name'));
        $email = mb_strtolower(trim((string) $this->argument('email')));

        if (! preg_match('/\A[a-z0-9]+(?:-[a-z0-9]+)*\z/', $slug) || mb_strlen($slug) > 100) {
            $this->error('The organization slug must contain lowercase letters, digits, and single hyphens only.');

            return self::INVALID;
        }

        if ($organizationName === '' || mb_strlen($organizationName) > 191 || $adminName === '' || mb_strlen($adminName) > 255) {
            $this->error('Organization and administrator names are required and must fit their database fields.');

            return self::INVALID;
        }

        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false || mb_strlen($email) > 254) {
            $this->error('A valid administrator email address is required.');

            return self::INVALID;
        }

        if (DB::table('organizations')->where('slug', $slug)->exists()) {
            $this->error('An organization already uses that slug.');

            return self::FAILURE;
        }

        if (! $this->confirm('Create this organization and grant its first Organization Admin role?')) {
            return self::INVALID;
        }

        $organizationId = (string) Str::ulid();
        $wasCreated = false;
        $admin = DB::transaction(function () use (
            $catalog,
            $auditLog,
            $context,
            $organizationId,
            $slug,
            $organizationName,
            $adminName,
            $email,
            &$wasCreated,
        ): User {
            DB::table('organizations')->insert([
                'id' => $organizationId,
                'name' => $organizationName,
                'slug' => $slug,
                'timezone' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $catalog->syncOrganization($organizationId);
            $roleId = (int) DB::table('roles')
                ->where('organization_id', $organizationId)
                ->where('slug', 'organization-admin')
                ->value('id');

            $admin = User::query()->where('email', $email)->lockForUpdate()->first();
            if (! $admin) {
                $admin = User::query()->create([
                    'name' => $adminName,
                    'email' => $email,
                    'password' => Str::random(48),
                ]);
                $wasCreated = true;
            }

            DB::table('organization_user')->insert([
                'organization_id' => $organizationId,
                'user_id' => $admin->id,
                'role_id' => $roleId,
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $context->set($organizationId, (int) $admin->id, $roleId);
            try {
                $auditLog->record($admin, 'membership.bootstrap_admin', 'user', (string) $admin->id, [
                    'role_id' => $roleId,
                    'status' => 'active',
                ]);
            } finally {
                $context->clear();
            }

            return $admin;
        });

        if ($wasCreated) {
            try {
                Password::sendResetLink(['email' => $email]);
            } catch (\Throwable) {
                $securityEvents->record('security.bootstrap_password_setup_delivery_failed', (int) $admin->id, request(), [
                    'source' => 'console',
                ]);
            }
        }

        $securityEvents->record('security.organization_bootstrapped', (int) $admin->id, request(), [
            'source' => 'console',
        ]);
        $this->info('Organization and first Organization Admin were created.');
        if ($wasCreated) {
            $this->line('A password setup notification was requested; configure a real MAIL_MAILER before production use.');
        }

        return self::SUCCESS;
    }
}
