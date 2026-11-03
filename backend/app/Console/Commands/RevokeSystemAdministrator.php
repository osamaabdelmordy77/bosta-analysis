<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Security\SecurityEventLogger;
use App\Security\SystemAdministratorService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class RevokeSystemAdministrator extends Command
{
    protected $signature = 'security:revoke-super-admin {email} {--actor-id=}';

    protected $description = 'Revoke the global Super Admin role through a confirmed console operation.';

    public function handle(SystemAdministratorService $administrators): int
    {
        $user = User::query()->where('email', mb_strtolower(trim((string) $this->argument('email'))))->first();
        if (! $user || ! $administrators->isActive((int) $user->id)) {
            $this->error('No active system administrator matches that account.');

            return self::FAILURE;
        }

        if ($administrators->activeCount() <= 1) {
            $this->error('At least one active system Super Admin must remain.');

            return self::FAILURE;
        }

        if (! $this->confirm('Revoke global Super Admin access from this user?')) {
            return self::INVALID;
        }

        $actorId = $this->option('actor-id') === null ? null : (int) $this->option('actor-id');
        if ($actorId !== null && ! User::query()->whereKey($actorId)->exists()) {
            $this->error('The supplied actor account does not exist.');

            return self::FAILURE;
        }

        DB::transaction(function () use ($administrators, $user, $actorId): void {
            $administrators->record((int) $user->id, $actorId, 'revoked');
        });

        app(SecurityEventLogger::class)->record('security.super_admin_revoked', (int) $user->id, request(), [
            'actor_id' => $actorId,
            'source' => 'console',
        ]);
        $this->info('Global Super Admin access revoked.');

        return self::SUCCESS;
    }
}
