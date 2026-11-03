<?php

namespace App\Models;

use App\Models\Concerns\CastsBostaSourceColumns;
use App\Models\Concerns\UsesUlids;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ShipmentSnapshotRouting extends TenantModel
{
    use CastsBostaSourceColumns, UsesUlids;

    protected $table = 'shipment_snapshot_routing';

    protected function casts(): array
    {
        return $this->bostaSourceCasts();
    }

    public function snapshot(): BelongsTo
    {
        return $this->belongsTo(ShipmentSnapshot::class, 'shipment_snapshot_id');
    }
}
