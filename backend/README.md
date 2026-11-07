# Backend local setup

The Laravel API lives here. The React/Vite application remains at the repository root. Local development uses PHP, Composer, and the existing XAMPP MariaDB service; imports run on Laravel's database queue.

## Requirements

- PHP 8.2 or later with `pdo_mysql`, `mbstring`, `openssl`, `fileinfo`, `xml`, `xmlreader`, `zip`, and `curl` enabled. `zip` is required for XLSX; PhpSpreadsheet reads legacy XLS files in bounded row chunks.
- Composer 2.
- MariaDB 10.4 or later / MySQL with InnoDB and a dedicated local application account.

## First local setup

1. Start the local XAMPP MariaDB service on loopback.
2. Create the application and test databases and grant the app account access to those databases only.
3. From this directory, run `composer install`, copy `.env.example` to `.env`, set the local database credentials, then run `php artisan key:generate` and `php artisan migrate`.
4. Start the API with `php artisan serve --host=127.0.0.1 --port=8000` and start Vite from the repository root when needed.
5. In a second terminal, start the import worker with `composer queue:imports`. Keep `DB_QUEUE_RETRY_AFTER` greater than `IMPORT_WORKER_TIMEOUT` (the defaults are 3900 and 3600 seconds).
6. For tests, create a separate MariaDB test database and configure its connection explicitly. Never aim tests or benchmarks at `bosta_analysis_local`.

Use a private database account and a strong local password. Keep `.env`, MySQL data files, and uploaded source workbooks out of Git. Store uploaded workbooks on a private filesystem disk; never serve their storage paths directly.

To create a local workspace administrator, set `LOCAL_WORKSPACE_SEED_ENABLED=true` and provide the organization name/slug, administrator name/email/password, and role slug (`organization-admin`, `data-manager`, `analyst`, `hub-manager`, `viewer`, or `auditor`) in the ignored `.env`. Then run `php artisan db:seed`. The seeder is restricted to `APP_ENV=local`, synchronizes the organization role catalog, creates an active organization membership, and records the membership in the audit log. Seeding the same email again updates its local password from `.env`; keep this password out of tracked files and do not use a local seed password outside development.

## Import worker

The database queue is installed through the migrations. Start one worker with:

```powershell
composer queue:imports
```

That worker processes one import file at a time. Add another worker only after measuring its effect on CPU, memory, and MariaDB. A job contains only organization/file/run IDs; the private original is stored under `IMPORT_FILE_STORAGE_PATH` (default: `storage/app/private/imports`). Keep this path outside the public web root. Set `IMPORT_READER_TEMP_PATH` to a private path on a volume with sufficient free space. The local Windows PHP build may not enforce worker timeout without `pcntl`; production workers should run under a process supervisor with timeout and retry-after configured as above.

## Database tests

Run `composer test` only after `.env.testing` points to an isolated database. Phase 3 integration tests exercise the upload endpoint, private storage, database queue worker, publication, re-open status, failure recovery, and cross-file shipment/business/hub concurrency. Full pipeline benchmark fixtures and instructions are in `docs/phase-03/IMPORT_PERFORMANCE_REPORT.md`.

## Full import pipeline benchmark

Use generated synthetic fixtures only. Point the API and worker to a dedicated benchmark database, set `IMPORT_BENCHMARK_ENABLED=true` and `IMPORT_BENCHMARK_DATABASE` to that exact database name, then create the isolated benchmark admin with:

```powershell
php scripts/prepare_import_benchmark.php
```

Start the API and one `composer queue:imports` worker in separate terminals. From the repository root run `npm run benchmark:import-pipeline -- backend/.local/import-benchmark/synthetic_bosta_15mb_211_columns.xlsx`. The script uploads one file, waits for the persisted job state to become completed, then fetches the same import metadata, settings, and paginated shipment data that the UI loads. It writes a JSON report under `backend/.local/import-benchmark/phase3-results/`. The script rejects files outside the generated fixture directory.

## Schema source

`database/schema/bosta_columns_v1.json` is the immutable Phase 01 migration input. `config/bosta_columns.json` supplies the same field mapping to application code. Both are checked against `../docs/phase-00/bosta_211_column_manifest.json`; do not change the mapping in place after the migration ships. Add a versioned schema/mapping revision for any future field change.
