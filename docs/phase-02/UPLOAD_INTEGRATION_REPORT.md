# Bosta upload integration report

## Scope and source file

The supplied `Deliveries_Export_2026-10-25-1792947041986.csv` is a data export, not an instruction document. Its file signature is OpenXML/XLSX even though its filename ends in `.csv`; the original file was read only and was not renamed or modified.

The full source profile is in [upload_sample_profile.json](upload_sample_profile.json). It records column labels, manifest matches, parsed value types, and row counts without retaining shipment values.

| Check | Result |
|---|---:|
| Worksheets | 1 (`Deliveries`) |
| Source columns | 211, in the same order as the manifest |
| Non-empty shipment rows | 14,407 |
| Distinct tracking numbers | 14,407 |
| Duplicate or missing tracking numbers | 0 / 0 |
| Filename report date | 2026-10-25 |
| Physical source row range | 2–14,408 |

The workbook’s timestamp cells are strings, not Excel numeric date cells. The 211-column manifest therefore remains the mapping authority; the raw source values are retained alongside typed values and any conversion issues. The report date comes from the filename and remains editable as a manual date in the upload dialog.

## Implemented flow

1. The upload dialog accepts `.xlsx`, `.xls`, and `.csv`. Parsing uses the workbook signature, so this XLSX-format file with a `.csv` suffix is handled as a workbook. Unsupported files and failed imports remain visible in the dialog.
2. The browser parser reads the source once, keeps each row tied to its physical worksheet row, pads every source row to the header width, and sends the original row values. The import path skips constructing a second shipment-object copy, uses dense worksheet storage, and releases uploaded rows as 200-row chunks complete.
3. The API translates frontend row property names to Laravel’s request format. The original file is stored in MySQL as ordered 512 KiB binary chunks, with per-chunk hashes and the complete file hash. This stays below the local MariaDB `max_allowed_packet` of 1 MiB.
4. Each row is retained in `import_source_rows` and mapped by the 211-column manifest into shipment snapshots and related tables. Delivery attempt columns map into attempt groups 0–8. Unique organization-scoped tracking fingerprints prevent duplicate shipment snapshots while the source rows remain available for audit.
5. A run is published only after row chunks are complete. Its fingerprint covers the file-derived date, sheet metadata, headers, and column overrides; retries with the same fingerprint resume the existing run and completed chunks are idempotent.

Migrations `000011` and `000012` add retry fingerprints and chunked MySQL file storage. The migrations were applied to the local and testing databases. No container, Redis, Horizon, queue worker, or extra service was started.

## Verification

- The frontend parser processed the actual sample: 211 columns matched in order, all 14,407 rows were found, and duplicate/missing tracking counts were zero.
- A synthetic blank-row workbook verified source row numbers `[2, 4]`, preventing a blank worksheet row from shifting the next record’s source reference.
- `npm run lint` and `npm run build` passed. Vite still reports its existing `__dirname` configuration warning and an 861 KiB minified main bundle warning.
- The focused Laravel import storage tests passed after the migrations: 2 tests, 49 assertions. They cover original-byte reconstruction from MySQL chunks, CSV text, XLSX content with a `.csv` suffix, 211 source values, retries, duplicates, and publish behavior.
- The full suite passed earlier with 38 tests and 243 assertions, before the final chunk-storage migration. It was not rerun afterward because the system drive ran out of space.
- A complete database acceptance run using all sample rows began, but MariaDB returned `table is full`. The XAMPP data directory is on `C:\xampp\mysql\data` and the C: drive now reports 0 free bytes; E: has about 43.7 GiB free. The request transaction rolled back: the testing database contains no sample import, source rows, snapshots, or content chunks.
- Browser UI automation could not initialize because the local computer-use kernel failed. The parser, frontend build, API request contract, and Laravel route were checked independently; a direct click-through upload was not completed.

## Remaining acceptance item

The code path is ready, but the full sample has not been committed to the local database because MySQL cannot allocate more disk space on C:. Free space on C: or approve relocating the XAMPP data directory to E: before retrying the complete upload. The sample’s end-to-end persistence and all date conversions remain unverified until that import finishes.
