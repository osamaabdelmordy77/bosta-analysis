<?php

declare(strict_types=1);

use App\Imports\ImportIngestionService;
use Illuminate\Contracts\Console\Kernel;

$backend = dirname(__DIR__, 2);
require $backend.'/vendor/autoload.php';
$app = require $backend.'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

[$organizationId, $fileId, $runId, $sheetId, $barrierDirectory, $workerName] = array_slice($argv, 1);
file_put_contents($barrierDirectory.'/ready-'.$workerName, 'ready');
$deadline = microtime(true) + 30;
while (! is_file($barrierDirectory.'/start') && microtime(true) < $deadline) {
    usleep(10000);
}
if (! is_file($barrierDirectory.'/start')) {
    fwrite(STDERR, "concurrency barrier timed out\n");
    exit(2);
}

$result = $app->make(ImportIngestionService::class)->ingestChunk(
    $organizationId,
    $fileId,
    $runId,
    $sheetId,
    0,
    [[
        'source_row_number' => 2,
        'values' => ['SHARED-CROSS-FILE', 'Shared Synthetic Merchant', 'MERCHANT-SHARED', 'Race Hub'],
    ]],
    [],
);

fwrite(STDOUT, json_encode($result, JSON_THROW_ON_ERROR)."\n");
