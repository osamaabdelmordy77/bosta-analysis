<?php

namespace App\Models;

use App\Models\Concerns\UsesUlids;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ImportIssue extends TenantModel
{
    use UsesUlids;

    protected function casts(): array
    {
        return [
            'source_sheet_index' => 'integer',
            'source_row_number' => 'integer',
            'source_column_number' => 'integer',
        ];
    }

    public function run(): BelongsTo
    {
        return $this->belongsTo(ImportRun::class, 'import_run_id');
    }

    public function sourceRow(): BelongsTo
    {
        return $this->belongsTo(ImportSourceRow::class, 'import_source_row_id');
    }
}
