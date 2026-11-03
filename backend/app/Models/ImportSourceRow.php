<?php

namespace App\Models;

use App\Models\Concerns\UsesUlids;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class ImportSourceRow extends TenantModel
{
    use UsesUlids;

    protected function casts(): array
    {
        return [
            'source_row_number' => 'integer',
            'source_values' => 'array',
            'issues_count' => 'integer',
            'processed_at' => 'datetime',
        ];
    }

    public function run(): BelongsTo
    {
        return $this->belongsTo(ImportRun::class, 'import_run_id');
    }

    public function sheet(): BelongsTo
    {
        return $this->belongsTo(ImportSheet::class, 'import_sheet_id');
    }

    public function chunk(): BelongsTo
    {
        return $this->belongsTo(ImportChunk::class, 'import_chunk_id');
    }

    public function snapshot(): HasOne
    {
        return $this->hasOne(ShipmentSnapshot::class);
    }

    public function issues(): HasMany
    {
        return $this->hasMany(ImportIssue::class);
    }
}
