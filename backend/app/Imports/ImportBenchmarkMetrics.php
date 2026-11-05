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

    /** @var array<string,array{count:int,total_ms:float,max_ms:float}> */
    private array $queryGroups = [];

    /** @var array<string,int> */
    private array $commitStarts = [];

    public function begin(): void
    {
        $this->active = true;
        $this->queryCount = 0;
        $this->sqlMilliseconds = 0.0;
        $this->phases = [];
        $this->queryGroups = [];
        $this->commitStarts = [];
    }

    public function recordQuery(float $milliseconds, ?string $sql = null): void
    {
        if (! $this->active) {
            return;
        }

        $this->queryCount++;
        $this->sqlMilliseconds += $milliseconds;
        if ($sql !== null) {
            // Keep only an operation and schema identifier, never SQL text or values.
            $operation = strtolower(strtok(ltrim($sql), " \t\r\n") ?: 'other');
            $table = 'other';
            if (preg_match('/\b(?:into|from|update)\s+[`"]?([a-zA-Z_][a-zA-Z0-9_]*)/i', $sql, $match)) {
                $table = $match[1];
            }
            $key = $operation.'.'.$table;
            $group = $this->queryGroups[$key] ?? ['count' => 0, 'total_ms' => 0.0, 'max_ms' => 0.0];
            $group['count']++;
            $group['total_ms'] += $milliseconds;
            $group['max_ms'] = max($group['max_ms'], $milliseconds);
            $this->queryGroups[$key] = $group;
        }
    }

    public function addPhase(string $phase, float $milliseconds): void
    {
        if (! $this->active) {
            return;
        }

        $this->phases[$phase] = ($this->phases[$phase] ?? 0.0) + $milliseconds;
    }

    public function startCommit(string $connection): void
    {
        if ($this->active) {
            $this->commitStarts[$connection] = hrtime(true);
        }
    }

    public function finishCommit(string $connection): void
    {
        if (isset($this->commitStarts[$connection])) {
            $this->addPhase('transaction_commit_wall_ms', (hrtime(true) - $this->commitStarts[$connection]) / 1_000_000);
            unset($this->commitStarts[$connection]);
        }
    }

    /** @return array<string,mixed> */
    public function finish(): array
    {
        $this->active = false;

        return [
            'sql_query_count' => $this->queryCount,
            'sql_total_ms' => round($this->sqlMilliseconds, 3),
            'server_phases_ms' => array_map(static fn (float $value): float => round($value, 3), $this->phases),
            'sql_by_operation_table' => array_map(static fn (array $group): array => [
                'count' => $group['count'], 'total_ms' => round($group['total_ms'], 3), 'max_ms' => round($group['max_ms'], 3),
            ], $this->queryGroups),
        ];
    }
}
