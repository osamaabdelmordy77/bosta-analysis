<?php

namespace App\Models;

use App\Models\Concerns\UsesUlids;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ColumnMapping extends TenantModel
{
    use UsesUlids;

    protected function casts(): array
    {
        return [
            'mapping_version' => 'integer',
            'source_column_number' => 'integer',
            'source_column_index' => 'integer',
            'is_enabled' => 'boolean',
        ];
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
