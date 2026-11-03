<?php

namespace App\Models;

use App\Models\Concerns\CastsBostaSourceColumns;
use App\Models\Concerns\UsesUlids;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class ShipmentSnapshot extends TenantModel
{
    use CastsBostaSourceColumns, UsesUlids;

    protected function casts(): array
    {
        return $this->bostaSourceCasts();
    }

    public function shipment(): BelongsTo
    {
        return $this->belongsTo(Shipment::class);
    }

    public function run(): BelongsTo
    {
        return $this->belongsTo(ImportRun::class, 'import_run_id');
    }

    public function sourceRow(): BelongsTo
    {
        return $this->belongsTo(ImportSourceRow::class, 'import_source_row_id');
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }

    public function currentHub(): BelongsTo
    {
        return $this->belongsTo(Hub::class, 'current_hub_id');
    }

    public function assignedHub(): BelongsTo
    {
        return $this->belongsTo(Hub::class, 'assigned_hub_id');
    }

    public function autoAssignedHub(): BelongsTo
    {
        return $this->belongsTo(Hub::class, 'auto_assigned_hub_id');
    }

    public function firstHub(): BelongsTo
    {
        return $this->belongsTo(Hub::class, 'first_hub_id');
    }

    public function lastDispatchHub(): BelongsTo
    {
        return $this->belongsTo(Hub::class, 'last_dispatch_hub_id');
    }

    public function lossLiableHub(): BelongsTo
    {
        return $this->belongsTo(Hub::class, 'loss_liable_hub_id');
    }

    public function parties(): HasOne
    {
        return $this->hasOne(ShipmentSnapshotParty::class);
    }

    public function routing(): HasOne
    {
        return $this->hasOne(ShipmentSnapshotRouting::class);
    }

    public function financials(): HasOne
    {
        return $this->hasOne(ShipmentSnapshotFinancial::class);
    }

    public function service(): HasOne
    {
        return $this->hasOne(ShipmentSnapshotService::class);
    }

    public function deliveryAttempts(): HasMany
    {
        return $this->hasMany(DeliveryAttempt::class);
    }
}
