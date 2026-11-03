<?php

namespace App\Models;

use App\Models\Concerns\UsesUlids;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ImportFile extends TenantModel
{
    use UsesUlids;

    protected function casts(): array
    {
        return ['size_bytes' => 'integer'];
    }

    public function runs(): HasMany
    {
        return $this->hasMany(ImportRun::class);
    }

    public function activeRun(): BelongsTo
    {
        return $this->belongsTo(ImportRun::class, 'active_run_id');
    }
}
