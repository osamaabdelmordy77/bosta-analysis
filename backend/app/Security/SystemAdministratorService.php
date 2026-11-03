<?php

namespace App\Security;

use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

class SystemAdministratorService
{
    public function isActive(int $userId): bool
    {
        $latestAction = DB::table('system_administrator_events')
            ->where('user_id', $userId)
            ->orderByDesc('id')
            ->value('action');

        return $latestAction === 'granted';
    }

    public function activeCount(): int
    {
        $latestEvents = DB::table('system_administrator_events')
            ->selectRaw('user_id, MAX(id) as latest_id')
            ->groupBy('user_id');

        return (int) DB::table('system_administrator_events as events')
            ->joinSub($latestEvents, 'latest_events', function ($join): void {
                $join->on('events.id', '=', 'latest_events.latest_id');
            })
            ->where('events.action', 'granted')
            ->count();
    }

    public function record(int $userId, ?int $actorId, string $action, string $source = 'console'): void
    {
        if (! in_array($action, ['granted', 'revoked'], true) || ! in_array($source, ['console', 'system'], true)) {
            throw new InvalidArgumentException('Invalid system administrator event.');
        }

        DB::table('system_administrator_events')->insert([
            'user_id' => $userId,
            'actor_id' => $actorId,
            'action' => $action,
            'source' => $source,
            'created_at' => now(),
        ]);
    }
}
