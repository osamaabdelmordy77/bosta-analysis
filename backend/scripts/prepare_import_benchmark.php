<?php

declare(strict_types=1);

use App\Models\User;
use App\Security\RoleCatalog;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

require dirname(__DIR__).'/vendor/autoload.php';
$app = require dirname(__DIR__).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$database = (string) config('database.connections.'.config('database.default').'.database');
$allowedDatabase = (string) config('import_benchmark.database');
if (! config('import_benchmark.enabled') || $allowedDatabase === '' || $database !== $allowedDatabase
    || str_ends_with($database, '_local') || str_ends_with($database, '_production')) {
    fwrite(STDERR, "Refusing to prepare benchmark credentials: enable IMPORT_BENCHMARK_ENABLED and select exactly IMPORT_BENCHMARK_DATABASE.\n");
    exit(2);
}

$slug = (string) (getenv('IMPORT_BENCHMARK_ORGANIZATION') ?: 'phase3-benchmark');
$email = mb_strtolower(trim((string) getenv('IMPORT_BENCHMARK_EMAIL')));
$password = (string) getenv('IMPORT_BENCHMARK_PASSWORD');
if (! preg_match('/\A[a-z0-9]+(?:-[a-z0-9]+)*\z/', $slug) || filter_var($email, FILTER_VALIDATE_EMAIL) === false
    || strlen($password) < 20) {
    fwrite(STDERR, "Set IMPORT_BENCHMARK_ORGANIZATION, IMPORT_BENCHMARK_EMAIL, and a benchmark-only password of at least 20 characters.\n");
    exit(2);
}

$organizationId = (string) (DB::table('organizations')->where('slug', $slug)->value('id') ?: Str::ulid());
DB::table('organizations')->updateOrInsert(['id' => $organizationId], [
    'name' => 'Synthetic Import Pipeline Benchmark',
    'slug' => $slug,
    'timezone' => 'Africa/Cairo',
    'created_at' => now(),
    'updated_at' => now(),
]);
$app->make(RoleCatalog::class)->syncOrganization($organizationId);
$user = User::query()->updateOrCreate(['email' => $email], [
    'name' => 'Synthetic Benchmark Admin',
    'password' => Hash::make($password),
]);
$roleId = (int) DB::table('roles')->where('organization_id', $organizationId)
    ->where('slug', 'organization-admin')->value('id');
DB::table('organization_user')->updateOrInsert([
    'organization_id' => $organizationId,
    'user_id' => (int) $user->id,
], [
    'role_id' => $roleId,
    'status' => 'active',
    'created_at' => now(),
    'updated_at' => now(),
]);

fwrite(STDOUT, json_encode([
    'database' => $database,
    'organization_slug' => $slug,
    'benchmark_user_configured' => true,
], JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT)."\n");
