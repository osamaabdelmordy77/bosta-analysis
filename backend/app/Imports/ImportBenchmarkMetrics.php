<?php

namespace App\Imports;

/** Request-scoped aggregate counters. It intentionally stores no SQL text or values. */
class ImportBenchmarkMetrics
{
    private bool $active = false;

    private int $queryCount = 0;

    private float $sqlMilliseconds = 0.0;

    /** @var array<string,float> */
    private array $phases = [];

    public function begin(): void
    {
        $this->active = true;
        $this->queryCount = 0;
        $this->sqlMilliseconds = 0.0;
        $this->phases = [];
    }

    public function recordQuery(float $milliseconds): void
    {
        if (! $this->active) {
            return;
        }

        $this->queryCount++;
        $this->sqlMilliseconds += $milliseconds;
    }

    public function addPhase(string $phase, float $milliseconds): void
    {
        if (! $this->active) {
            return;
        }

        $this->phases[$phase] = ($this->phases[$phase] ?? 0.0) + $milliseconds;
    }

    /** @return array{sql_query_count:int,sql_total_ms:float,server_phases_ms:array<string,float>} */
    public function finish(): array
    {
        $this->active = false;

        return [
            'sql_query_count' => $this->queryCount,
            'sql_total_ms' => round($this->sqlMilliseconds, 3),
            'server_phases_ms' => array_map(static fn (float $value): float => round($value, 3), $this->phases),
        ];
    }
}
