<?php

declare(strict_types=1);

use App\Http\Controllers\ImportController;
use App\Imports\ImportFileContentStorage;
use App\Imports\ImportWorkbookProcessor;
use App\Models\User;
use App\Security\AuditLogService;
use App\Security\RoleCatalog;
use App\Tenancy\OrganizationContext;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

require dirname(__DIR__).'/vendor/autoload.php';
$app = require dirname(__DIR__).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$database = (string) config('database.connections.mysql.database');
if (! config('import_benchmark.enabled') || $database !== config('import_benchmark.database')
    || ! str_ends_with($database, '_benchmark')) {
    throw new RuntimeException('Select an isolated *_benchmark database and enable IMPORT_BENCHMARK_ENABLED.');
}
$path = realpath($argv[1] ?? '');
if ($path === false || ! is_file($path)) {
    throw new RuntimeException('Provide a readable workbook path.');
}
$label = $argv[2] ?? 'unlabelled';
if (preg_match('/\A[a-zA-Z0-9_-]{1,64}\z/', $label) !== 1) {
    throw new RuntimeException('Use a short alphanumeric benchmark label.');
}
$organizationId = (string) Str::ulid();
$slug = 'worker-benchmark-'.strtolower($organizationId);
DB::table('organizations')->insert([
    'id' => $organizationId, 'name' => 'Isolated Worker Benchmark', 'slug' => $slug,
    'timezone' => 'Africa/Cairo', 'created_at' => now(), 'updated_at' => now(),
]);
app(RoleCatalog::class)->syncOrganization($organizationId);
$user = User::query()->create([
    'name' => 'Benchmark', 'email' => $slug.'@example.test', 'password' => Str::random(40),
]);
$roleId = (int) DB::table('roles')->where('organization_id', $organizationId)->where('slug', 'organization-admin')->value('id');
$user->organizations()->attach($organizationId, ['role_id' => $roleId, 'status' => 'active']);
app(OrganizationContext::class)->set($organizationId, (int) $user->id, $roleId);
$extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));
$request = Request::create('/api/organizations/'.$slug.'/imports', 'POST', [
    'report_date' => '2026-11-04', 'manual_date' => '0', 'column_overrides' => '{}',
], [], ['file' => new UploadedFile($path, 'benchmark.'.$extension, null, null, true)]);
$app->instance('request', $request);
$request->setUserResolver(fn () => $user);
$startedAt = hrtime(true);
$response = app(ImportController::class)->store($request, $slug, app(AuditLogService::class), app(ImportFileContentStorage::class));
if ($response->getStatusCode() !== 202) {
    throw new RuntimeException('The benchmark import was not queued.');
}
$queued = $response->getData(true)['data'];
$uploadMs = (hrtime(true) - $startedAt) / 1_000_000;
app(ImportWorkbookProcessor::class)->process($organizationId, $queued['file_id'], $queued['run_id']);
$run = DB::table('import_runs')->where('id', $queued['run_id'])->first();
$digest = hash_init('sha256');
foreach (DB::table('import_source_rows as rows')->join('import_sheets as sheets', 'sheets.id', '=', 'rows.import_sheet_id')
    ->where('rows.import_run_id', $run->id)->orderBy('sheets.source_sheet_index')->orderBy('rows.source_row_number')
    ->select(['sheets.source_sheet_index', 'rows.source_row_number', 'rows.source_values'])->cursor() as $row) {
    hash_update($digest, json_encode([(int) $row->source_sheet_index, (int) $row->source_row_number,
        json_decode($row->source_values, true, 512, JSON_THROW_ON_ERROR)], JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION)."\n");
}
$report = [
    'label' => $label,
    'pdo_emulate_prepares' => DB::connection()->getPdo()->getAttribute(PDO::ATTR_EMULATE_PREPARES),
    'database' => $database, 'run_id' => $run->id, 'state' => $run->processing_state,
    'file_bytes' => filesize($path), 'upload_store_ms' => round($uploadMs, 3),
    'rows' => (int) $run->source_rows_count, 'source_digest' => hash_final($digest),
    'metrics' => json_decode($run->processing_metrics, true, 512, JSON_THROW_ON_ERROR),
];
$output = dirname(__DIR__).'/.local/worker-benchmark-'.$run->id.'.json';
file_put_contents($output, json_encode($report, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
echo json_encode($report, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR).PHP_EOL;
