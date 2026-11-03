<?php

namespace App\Models;

use App\Models\Concerns\CastsBostaSourceColumns;
use App\Models\Concerns\UsesUlids;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DeliveryAttempt extends TenantModel
{
    use CastsBostaSourceColumns, UsesUlids;

    protected function casts(): array
    {
        return array_merge($this->bostaSourceCasts(), ['attempt_index' => 'integer']);
    }

    public function snapshot(): BelongsTo
    {
        return $this->belongsTo(ShipmentSnapshot::class, 'shipment_snapshot_id');
    }
}
