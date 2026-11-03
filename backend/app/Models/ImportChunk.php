<?php

namespace App\Models;

use App\Models\Concerns\UsesUlids;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ImportChunk extends TenantModel
{
    use UsesUlids;

    protected function casts(): array
    {
        return [
            'chunk_index' => 'integer',
            'first_source_row' => 'integer',
            'last_source_row' => 'integer',
            'attempts' => 'integer',
            'rows_processed' => 'integer',
            'issues_count' => 'integer',
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
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

    public function sourceRows(): HasMany
    {
        return $this->hasMany(ImportSourceRow::class);
    }
}
