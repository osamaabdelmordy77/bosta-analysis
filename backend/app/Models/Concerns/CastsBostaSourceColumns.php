<?php

namespace App\Models\Concerns;

trait CastsBostaSourceColumns
{
    protected function bostaSourceCasts(): array
    {
        $casts = [];

        foreach (config('bosta_columns', []) as $column) {
            if ($column['table'] !== $this->getTable()) {
                continue;
            }

            $cast = match ($column['provisional_type']) {
                'boolean' => 'boolean',
                'dateTime' => 'datetime',
                'unsignedInteger' => 'integer',
                default => null,
            };

            if ($cast !== null) {
                $casts[$column['physical_column']] = $cast;
            }
        }

        return $casts;
    }
}
