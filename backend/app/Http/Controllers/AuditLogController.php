<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;

class AuditLogController extends Controller
{
    public function index(): JsonResponse
    {
        Gate::authorize('viewAny', AuditLog::class);

        $logs = AuditLog::query()
            ->select(['id', 'organization_id', 'actor_id', 'action', 'subject_type', 'subject_id', 'metadata', 'created_at'])
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->cursorPaginate(50);

        return $this->success([
            'audit_logs' => collect($logs->items())->map(fn (AuditLog $log): array => [
                'id' => (string) $log->id,
                'actor_id' => $log->actor_id === null ? null : (int) $log->actor_id,
                'action' => $log->action,
                'subject_type' => $log->subject_type,
                'subject_id' => $log->subject_id,
                'metadata' => array_intersect_key($log->metadata ?? [], array_flip([
                    'role_id', 'previous_role_id', 'status', 'previous_status',
                    'hub_count', 'added_count', 'removed_count', 'system_actor_id',
                ])),
                'created_at' => $log->created_at?->toISOString(),
            ])->all(),
            'pagination' => [
                'next_cursor' => $logs->nextCursor()?->encode(),
                'previous_cursor' => $logs->previousCursor()?->encode(),
            ],
        ]);
    }
}
