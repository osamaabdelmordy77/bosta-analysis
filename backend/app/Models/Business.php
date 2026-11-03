<?php

namespace App\Models;

use App\Models\Concerns\UsesUlids;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Business extends TenantModel
{
    use UsesUlids;

    public function snapshots(): HasMany
    {
        return $this->hasMany(ShipmentSnapshot::class);
    }
}
