<?php

namespace App\Security;

use App\Models\User;
use App\Tenancy\OrganizationContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class AuditLogService
{
    public function __construct(
        private readonly OrganizationContext $context,
        private readonly SystemAdministratorService $systemAdministrators,
    ) {}

    public function record(
        User $actor,
        string $action,
        ?string $subjectType = null,
        ?string $subjectId = null,
        array $metadata = [],
    ): void {
        $organizationId = $this->context->requireId();
        $isMember = DB::table('organization_user')
            ->where('organization_id', $organizationId)
            ->where('user_id', $actor->id)
            ->where('status', 'active')
            ->exists();

        $safeMetadata = array_intersect_key($metadata, array_flip([
            'role_id', 'previous_role_id', 'status', 'previous_status',
            'hub_count', 'added_count', 'removed_count', 'system_actor_id',
            'previous_report_date', 'report_date',
        ]));

        if (! $isMember && $this->systemAdministrators->isActive((int) $actor->id)) {
            $safeMetadata['system_actor_id'] = (int) $actor->id;
        }

        DB::table('audit_logs')->insert([
            'id' => (string) Str::ulid(),
            'organization_id' => $organizationId,
            'actor_id' => $isMember ? (int) $actor->id : null,
            'action' => $action,
            'subject_type' => $subjectType,
            'subject_id' => $subjectId,
            'metadata' => $safeMetadata === [] ? null : json_encode($safeMetadata, JSON_THROW_ON_ERROR),
            'created_at' => now(),
        ]);
    }
}
