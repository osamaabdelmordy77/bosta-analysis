<?php

namespace App\Models;

use App\Models\Concerns\UsesUlids;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ImportSheet extends TenantModel
{
    use UsesUlids;

    protected function casts(): array
    {
        return [
            'source_sheet_index' => 'integer',
            'header_row_number' => 'integer',
            'data_rows_count' => 'integer',
            'detected_columns_count' => 'integer',
        ];
    }

    public function run(): BelongsTo
    {
        return $this->belongsTo(ImportRun::class, 'import_run_id');
    }

    public function chunks(): HasMany
    {
        return $this->hasMany(ImportChunk::class);
    }

    public function sourceRows(): HasMany
    {
        return $this->hasMany(ImportSourceRow::class);
    }
}
