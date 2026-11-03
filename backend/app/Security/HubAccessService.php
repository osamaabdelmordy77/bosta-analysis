<?php

namespace App\Security;

use App\Models\Hub;
use App\Models\ShipmentSnapshot;
use App\Models\User;
use App\Tenancy\OrganizationContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

class HubAccessService
{
    public function __construct(
        private readonly OrganizationContext $context,
        private readonly AuthorizationService $authorization,
    ) {}

    public function scopeHubs(Builder $query, User $user): Builder
    {
        $organizationId = $this->context->requireId();
        $query->where('hubs.organization_id', $organizationId);

        if ($this->authorization->hasPermission($user, 'hubs.view_all')) {
            return $query;
        }

        abort_unless($this->authorization->hasPermission($user, 'hubs.view_assigned'), 403);

        return $query->whereExists(function ($subquery) use ($user, $organizationId): void {
            $subquery->selectRaw('1')
                ->from('user_hub_access')
                ->whereColumn('user_hub_access.hub_id', 'hubs.id')
                ->where('user_hub_access.organization_id', $organizationId)
                ->where('user_hub_access.user_id', $user->id);
        });
    }

    public function findVisibleHubOrFail(User $user, string $hubId): Hub
    {
        return $this->scopeHubs(Hub::query(), $user)
            ->whereKey($hubId)
            ->firstOrFail();
    }

    /**
     * Scope shipment snapshots by the current routing hub, falling back to assigned hub.
     * Future reports and exports must use this query service rather than the raw model.
     *
     * @param  Builder<ShipmentSnapshot>  $query
     * @return Builder<ShipmentSnapshot>
     */
    public function scopeShipmentSnapshots(Builder $query, User $user): Builder
    {
        $organizationId = $this->context->requireId();
        $query->where('shipment_snapshots.organization_id', $organizationId);

        if ($this->authorization->hasPermission($user, 'shipments.view_all')) {
            return $query;
        }

        abort_unless($this->authorization->hasPermission($user, 'shipments.view_assigned'), 403);

        $visibleHubIds = DB::table('user_hub_access')
            ->select('hub_id')
            ->where('organization_id', $organizationId)
            ->where('user_id', $user->id);

        return $query->where(function (Builder $location) use ($visibleHubIds): void {
            $location->whereIn('shipment_snapshots.current_hub_id', clone $visibleHubIds)
                ->orWhere(function (Builder $fallback) use ($visibleHubIds): void {
                    $fallback->whereNull('shipment_snapshots.current_hub_id')
                        ->whereIn('shipment_snapshots.assigned_hub_id', clone $visibleHubIds);
                });
        });
    }
}
