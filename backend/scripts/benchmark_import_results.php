<?php

declare(strict_types=1);

use App\Http\Controllers\ImportController;
use App\Imports\ImportBenchmarkMetrics;
use App\Models\User;
use App\Security\AuthorizationService;
use App\Security\HubAccessService;
use App\Tenancy\OrganizationContext;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

require dirname(__DIR__).'/vendor/autoload.php';
$app = require dirname(__DIR__).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
$database = DB::connection()->getDatabaseName();
if (! config('import_benchmark.enabled') || $database !== config('import_benchmark.database') || ! str_ends_with($database, '_benchmark')) {
    throw new RuntimeException('Results benchmarks require the isolated benchmark database.');
}
$run = DB::table('import_runs')->where('id', $argv[1] ?? '')->where('processing_state', 'completed')->first();
if (! $run) {
    throw new RuntimeException('Provide a completed benchmark run ID.');
}
$label = $argv[2] ?? 'results';
if (! preg_match('/\A[a-zA-Z0-9_-]{1,64}\z/', $label)) {
    throw new RuntimeException('Invalid benchmark label.');
}
$organization = DB::table('organizations')->where('id', $run->organization_id)->first();
$user = User::query()->findOrFail($run->uploaded_by);
$roleId = (int) DB::table('organization_user')->where('organization_id', $organization->id)->where('user_id', $user->id)->value('role_id');
app(OrganizationContext::class)->set($organization->id, (int) $user->id, $roleId);
$metrics = app(ImportBenchmarkMetrics::class);
$metrics->begin();
$startedAt = hrtime(true);
$hash = hash_init('sha256');
$counts = [];
$pages = 0;
foreach (['published', 'legacy'] as $source) {
    $cursor = null;
    $counts[$source] = 0;
    do {
        $request = Request::create('/api/organizations/'.$organization->slug.'/imports/shipments', 'GET', [
            'source' => $source, 'per_page' => 2000, ...($cursor ? ['cursor' => $cursor] : []),
        ]);
        $app->instance('request', $request);
        $request->setUserResolver(fn () => $user);
        $response = app(ImportController::class)->shipments($request, $organization->slug, app(HubAccessService::class), app(AuthorizationService::class));
        $data = $response->getData(true)['data'];
        $counts[$source] += count($data['shipments']);
        foreach ($data['shipments'] as $shipment) {
            hash_update($hash, json_encode($shipment, JSON_THROW_ON_ERROR)."\n");
        }
        $cursor = $data['pagination']['next_cursor'];
        $pages++;
    } while ($cursor !== null);
}
$report = [
    'label' => $label, 'run_id' => $run->id, 'controller_results_ms' => round((hrtime(true) - $startedAt) / 1_000_000, 3),
    'pages' => $pages, 'counts' => $counts, 'payload_digest' => hash_final($hash), 'metrics' => $metrics->finish(),
];
file_put_contents(dirname(__DIR__).'/.local/'.$label.'.json', json_encode($report, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
echo json_encode($report, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR).PHP_EOL;
