<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Security\SecurityEventLogger;
use App\Security\SystemAdministratorService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class GrantSystemAdministrator extends Command
{
    protected $signature = 'security:grant-super-admin {email} {--actor-id=}';

    protected $description = 'Grant the global Super Admin role through a confirmed console operation.';

    public function handle(SystemAdministratorService $administrators): int
    {
        $user = User::query()->where('email', mb_strtolower(trim((string) $this->argument('email'))))->first();
        if (! $user) {
            $this->error('No user matches that account.');

            return self::FAILURE;
        }

        if ($administrators->isActive((int) $user->id)) {
            $this->info('The user already has the global Super Admin role.');

            return self::SUCCESS;
        }

        if (! $this->confirm('Grant global Super Admin access to this user?')) {
            return self::INVALID;
        }

        $actorId = $this->option('actor-id') === null ? null : (int) $this->option('actor-id');
        if ($actorId !== null && ! User::query()->whereKey($actorId)->exists()) {
            $this->error('The supplied actor account does not exist.');

            return self::FAILURE;
        }

        DB::transaction(function () use ($administrators, $user, $actorId): void {
            $administrators->record((int) $user->id, $actorId, 'granted');
        });

        app(SecurityEventLogger::class)->record('security.super_admin_granted', (int) $user->id, request(), [
            'actor_id' => $actorId,
            'source' => 'console',
        ]);
        $this->info('Global Super Admin access granted.');

        return self::SUCCESS;
    }
}
