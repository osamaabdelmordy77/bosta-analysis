<?php

namespace App\Models;

use App\Models\Concerns\UsesUlids;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ImportRun extends TenantModel
{
    use UsesUlids;

    protected function casts(): array
    {
        return [
            'report_date' => 'date',
            'report_date_is_manual' => 'boolean',
            'revision' => 'integer',
            'mapping_version' => 'integer',
            'source_rows_count' => 'integer',
            'accepted_rows_count' => 'integer',
            'duplicate_rows_count' => 'integer',
            'rejected_rows_count' => 'integer',
            'issues_count' => 'integer',
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
            'published_at' => 'datetime',
        ];
    }

    public function file(): BelongsTo
    {
        return $this->belongsTo(ImportFile::class, 'import_file_id');
    }

    public function sheets(): HasMany
    {
        return $this->hasMany(ImportSheet::class);
    }

    public function sourceRows(): HasMany
    {
        return $this->hasMany(ImportSourceRow::class);
    }

    public function issues(): HasMany
    {
        return $this->hasMany(ImportIssue::class);
    }

    public function snapshots(): HasMany
    {
        return $this->hasMany(ShipmentSnapshot::class);
    }
}
