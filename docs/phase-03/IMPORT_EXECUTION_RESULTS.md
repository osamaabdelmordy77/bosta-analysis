# Import execution round 2 — 2026-11-05

Execution reference: [IMPORT_EXECUTION_REFERENCE.md](IMPORT_EXECUTION_REFERENCE.md).

The target of processing a fresh complete workbook within 30 seconds has **not**
been achieved. This round retains a demonstrated improvement to loading results
and detailed instrumentation. Worker experiments that did not demonstrate a gain
were reverted before the application services were restarted.

## Kept changes

- Read published shipment projections with the query builder after all tenant and
  hub scopes have been applied, avoiding Eloquent hydration for every displayed row.
- Reuse report-date conversion within each controller request.
- Keep cursor pagination bounded at 2,000 rows; load published and legacy streams
  concurrently, preserving their original output order.
- Aggregate SQL operation/table counts, SQL timing, per-table write timing, commit
  timing, and reader/dashboard time separately from chunk ingestion. The SQL event
  timer includes the framework/driver round trip, not just server execution.
- Add reproducible worker/results benchmarks and an explicitly guarded real-file
  HTTP mode. The real-file mode requires a separate loopback API port and a server
  header proving the expected isolated `*_benchmark` database before upload.

No new schema migrations, global database settings, or disabled integrity checks
were introduced. The prior round's single-pass reader and 1,000-row chunks remain.

## Result loading benchmark

Same completed run, same complete response digest:

| Controller + JSON measurement | Duration | Pages | Published records |
|---|---:|---:|---:|
| Before | 29.504 s | 17 | 15,731 |
| After, run 1 | 7.303 s | 9 | 15,731 |
| After, run 2 | 6.994 s | 9 | 15,731 |
| After, run 3 | 6.472 s | 9 | 15,731 |

After median: **6.994 s**; slowest: **7.303 s**. The before measurement is a single
sample. These measurements bypass browser transport, authentication middleware,
PHP HTTP startup, and React rendering. They are not a promise of a seven-second
complete import or seven-second browser load.

## Worker investigation

| Variant | Worker samples (seconds) | Decision |
|---|---|---|
| Instrumented baseline | 60.166, 94.402, 99.966 | Median 94.402; variable conditions |
| PDO emulation probe | 105.249 | Rejected; no demonstrated gain |
| JSON_TABLE transport probe | 102.070 | Rejected; no demonstrated gain |
| XML/date micro-optimization candidate | 123.782, 116.443, 110.877 | Reverted; median 116.443 did not justify promotion |

All source digests in these runs matched the established 3,319,241-value digest.
First baseline details: snapshots INSERT events 9.456 s, source-row INSERT events
3.907 s, commits 0.993 s. Later measurements grew significantly across reader,
mapping, and SQL time. A resource snapshot showed 91% committed memory, 810 MiB
available memory, and 418 pages input/sec. This snapshot describes the environment;
it does not isolate the cause or establish a causal performance explanation.

The original 51.260-second worker result remains a historical individual sample,
not a guaranteed current latency. The benchmark database also accumulated many
independent copies, unlike the application database. Comparisons are therefore
not controlled one-to-one tests of the original user interface.

The rejected SQL experiments were informed by the official
[PDO prepare documentation](https://www.php.net/manual/en/pdo.prepare.php) and
[MySQL JSON_TABLE documentation](https://dev.mysql.com/doc/refman/8.4/en/json-table-functions.html).
Neither experimental transport remains enabled or present in application code.

## HTTP workflow and browser verification

The supplied real workbook was uploaded once to an isolated organization using
the separate benchmark API. The recorded sample completed successfully:

| Boundary | Observed duration |
|---|---:|
| Upload round trip | 8.978 s |
| Worker | 155.254 s |
| Result fetch + JSON decoding | 27.263 s |
| Total until client result data loaded | 193.165 s |

This was a functional workflow verification in variable conditions, with browser
activity also occurring during that workflow. It is not a fixed-load latency
comparison with the original application. React rendering duration is unmeasured.

The isolated browser dashboard visibly displayed 15,731 / 15,731 shipments, one
file, 88 hubs, 1,062 businesses, and 36,670 items. Full field digests of the resulting
six normalized tables matched the original application's reference run: 15,731
rows in each snapshot/detail table and 2,265 delivery-attempt rows.

## Direct read of the original application

At the user's request, the actual frontend/proxy at `http://localhost:3001` was
measured without uploading or reprocessing anything. The same result-loading
requests as the app returned:

- Two existing files, 31,103 published records, no legacy records, no active imports.
- 16 published pages plus one empty legacy page.
- **27.617 seconds** for the complete HTTP result load and JSON decoding.

That measurement excludes React rendering and a new import. It confirms that
result-load latency is also present on the original interface, but does **not**
prove that a fresh import there would take 193 seconds. Different database sizes,
file counts, HTTP overhead, and runtime conditions must be considered.

## Validation and operations

- Full PHP suite: 50 tests, 351 assertions passed on the test database.
- After reverting the worker candidate: 13 targeted tests, 136 assertions passed,
  with `DB_DATABASE=bosta_analysis_test` explicitly selected.
- TypeScript check, frontend build, Node syntax check, and diff whitespace check passed.
- Original application data was not re-imported or altered by benchmark writes.
- Temporary benchmark API, queue worker, and frontend were stopped after verification.
- Original API and import worker were restarted only after confirming zero active
  imports; frontend remains fixed at 3001.

Private JSON reports, credentials, and workbook copies are under ignored
`backend/.local/` and private Laravel storage; no customer cell values are included
in this report. Future browser benchmarks should use `127.0.0.1:3013` and a distinct
`SESSION_COOKIE` to avoid sharing localhost application cookies across ports.

## Next decision

A defensible next performance experiment needs a stable load and a benchmark
dataset comparable in size to the application database. Measure a fresh isolated
run and original-data reads separately. Reassess actual storage/SQL throughput
before committing to an architectural change or another numerical latency promise.
The few-seconds objective remains open.
