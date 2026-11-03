# Backend local setup

The Laravel API lives here. The existing React/Vite application remains at the repository root. This backend uses PHP and Composer directly with a local MySQL server; it does not need Docker, Redis, Horizon, or a queue worker for Phase 01.

## Requirements

- PHP 8.2 or later with `pdo_mysql`, `mbstring`, `openssl`, `fileinfo`, `xml`, and `curl` enabled.
- Composer 2.
- MySQL 8.4, InnoDB, and a dedicated local application account.

## First local setup

1. Start MySQL as a local service, bound to loopback for development.
2. Create the application and test databases and grant the app account access to those databases only.
3. From this directory, run `composer install`, copy `.env.example` to `.env`, set the local database credentials, then run `php artisan key:generate` and `php artisan migrate`.
4. Start only the API with `php artisan serve`. Run the root React/Vite application separately when needed.
5. For tests, create a separate `bosta_analysis_test` database and a restricted test account, then copy `.env.testing.example` to `.env.testing` and set its credentials.

Use a private database account and a strong local password. Keep `.env`, MySQL data files, and uploaded source workbooks out of Git. Store uploaded workbooks on a private filesystem disk; never serve their storage paths directly.

## Queues

The default queue connection is Laravel's database driver. Phase 01 does not start a worker because import jobs are not implemented yet. When a later phase adds queued work, start one `queue:work database` process locally. The queue interface can move to Redis and Horizon on a suitably provisioned deployment without changing job contracts.

## Database tests

Run `composer test` to use `.env.testing` and the separate test database. Never point it at the application database. Keep the MySQL server resource settings modest on development machines. The application has no load-test command in its local setup.

## Schema source

`database/schema/bosta_columns_v1.json` is the immutable Phase 01 migration input. `config/bosta_columns.json` supplies the same field mapping to application code. Both are checked against `../docs/phase-00/bosta_211_column_manifest.json`; do not change the mapping in place after the migration ships. Add a versioned schema/mapping revision for any future field change.
