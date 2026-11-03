<?php

namespace App\Models;

use App\Models\Concerns\UsesUlids;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Hub extends TenantModel
{
    use UsesUlids;

    public function aliases(): HasMany
    {
        return $this->hasMany(HubAlias::class);
    }

    public function currentSnapshots(): HasMany
    {
        return $this->hasMany(ShipmentSnapshot::class, 'current_hub_id');
    }

    public function assignedSnapshots(): HasMany
    {
        return $this->hasMany(ShipmentSnapshot::class, 'assigned_hub_id');
    }
}
