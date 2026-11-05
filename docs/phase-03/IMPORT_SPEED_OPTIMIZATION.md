# Local import speed measurements — 2026-11-05

The requested target of a few seconds for a full import has **not** been achieved.
The actual supplied workbook now completes worker processing in 51.260 seconds,
compared with the original recorded 124.505 seconds (58.8% less time, 2.43× throughput).
These are worker timings, not browser upload-to-render timings or a statistical latency guarantee.

## Input and isolation

- The supplied real XLSX contains 15,731 data rows and 211 columns (3,319,241 source values).
- Compressed size: 15,467,972 bytes; worksheet XML size: 174,895,356 bytes.
- The original completed run in `bosta_analysis_local` was read for comparison only.
- All new benchmark writes used `bosta_analysis_benchmark`; tests used `bosta_analysis_test`.
- No source workbook or customer values are committed. Detailed local reports remain in ignored `backend/.local/`.
- Runtime: PHP 8.3.33 and the existing local MySQL instance. No global database settings or integrity checks were changed.

## Measurements

| Measurement | Before | After |
|---|---:|---:|
| Reader inspection + all rows + digest | 89.619 s | 16.812 s |
| Reader peak PHP allocation | 22 MiB | 22 MiB |
| Full worker processing | 124.505 s | 51.260 s |
| Accepted / rejected / duplicate rows | 15,731 / 0 / 0 | 15,731 / 0 / 0 |
| Warning count | 16,574 | 16,574 |

The optimized full worker run used about 116 MiB peak PHP allocation, versus
68 MiB in the original run, because source chunks grew from 400 to 1,000 rows.
Worker instrumentation was enabled for the new benchmark and disabled for the
original run. The measurements are from individual runs on the same local instance.

The optimized run issued 548 SQL statements with 23.050 seconds cumulative SQL
time. The preceding optimized-reader run with 400-row source chunks issued 1,037
statements and took 56.337 seconds. Increasing chunk size and adaptive batch budgets
reduced statements without disabling transactions, constraints, duplicate detection,
raw source retention, or atomic publication. SQL and phase times overlap and must
not be added together. The legacy `prepublication_checks_wall_ms` field is cumulative
elapsed time up to that point, not a separate isolated phase.

## Implementation

- XLSX data rows use one streaming XMLReader pass. No per-cell objects are created
  for ordinary values, and no parallel second worksheet pass is required for raw
  Excel date serials. OpenSpout remains responsible for header inspection, shared
  string caching, date style classification, and uncommon value semantics. XLS and
  CSV retain their established readers.
- Exact date serial strings, cached formula values, leading zeros, rich text, XML
  namespaces, booleans, empty cells, and source row positions remain supported.
- Source chunks default to 1,000 rows. Their size is saved in each new run's
  processing options; existing runs retain the legacy 400-row boundary. A default
  change cannot regroup already committed chunks during a retry.
- SQL batches default to 1,000 rows, 48,000 bindings, and 4 MiB, while continuing
  to obey the actual server packet budget. Bindings are capped at 60,000.
- Worksheet header comparisons on resume compare decoded JSON arrays. MySQL
  normalizes JSON whitespace, so comparing serialized bytes incorrectly rejected
  valid retries even when headers had not changed.

## Correctness checks

- All 3,319,241 raw source values have the same complete row digest before/after.
- Digests of all mapped values match across `shipment_snapshots`, parties,
  financials, routing, service, and delivery attempts, ordered by source row and
  attempt index. Each snapshot/detail table has 15,731 rows; attempts have 2,265.
- `php artisan test --env=testing`: 44 tests, 339 assertions passed.
- Tests include shared strings, XLS/CSV compatibility, exact date serials,
  prefixed rich text, formula caches, malformed XML, column limits, import resume
  after a default chunk-size change, concurrent imports, and publication integrity.

## Reproduce a worker benchmark

Create and migrate an isolated database ending in `_benchmark`, grant only its
application account access, then run from `backend`:

```powershell
$env:DB_DATABASE = 'bosta_analysis_benchmark'
$env:IMPORT_BENCHMARK_ENABLED = 'true'
php -d memory_limit=512M scripts/benchmark_import_worker.php 'C:\path\to\workbook.xlsx'
```

The script refuses a non-benchmark database, creates an isolated organization,
stores a private workbook copy, invokes the actual upload controller and worker
processor, and reports counts, timings, and a source digest. It bypasses HTTP
transport and queue scheduling, so it does not measure browser rendering or upload
network time. Benchmark copies contain the input's data and stay on private local
storage; use synthetic input when real data is unnecessary.

Reaching a few seconds requires further changes to parsing/storage throughput;
the current measured SQL time alone exceeds that target. The implementation does
not report completion early or omit source columns to mask that remaining cost.
