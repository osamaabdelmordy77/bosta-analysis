<?php

declare(strict_types=1);

use App\Imports\ImportWorkbookReader;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

$backend = dirname(__DIR__);
require $backend.'/vendor/autoload.php';
$app = require $backend.'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$inputPath = isset($argv[1]) ? realpath($argv[1]) : false;
$allowedRoot = realpath($backend.'/.local/import-benchmark');
$slug = (string) (getenv('IMPORT_BENCHMARK_ORGANIZATION') ?: 'phase3-benchmark');
$database = DB::connection()->getDatabaseName();
if (! config('import_benchmark.enabled') || $database !== (string) config('import_benchmark.database')
    || ! is_string($inputPath) || ! is_string($allowedRoot)
    || ! str_starts_with(strtolower($inputPath), strtolower($allowedRoot.DIRECTORY_SEPARATOR))) {
    fwrite(STDERR, "Refusing source verification: use the explicitly enabled benchmark database and a generated fixture under backend/.local/import-benchmark.\n");
    exit(2);
}

$run = DB::table('organizations as organization')
    ->join('import_files as file', 'file.organization_id', '=', 'organization.id')
    ->join('import_runs as run', 'run.import_file_id', '=', 'file.id')
    ->join('import_file_contents as content', 'content.import_run_id', '=', 'run.id')
    ->where('organization.slug', $slug)
    ->where('run.processing_state', 'completed')
    ->where('run.status', 'published')
    ->orderByDesc('run.created_at')
    ->first([
        'organization.id as organization_id', 'file.id as file_id', 'file.original_name', 'file.sha256 as file_sha256',
        'run.id as run_id', 'run.processing_options', 'run.source_rows_count', 'content.sha256 as content_sha256',
        'content.storage_disk', 'content.storage_path',
    ]);
if (! $run) {
    throw new RuntimeException('No completed published benchmark import was found for the selected organization.');
}

$storedPath = Storage::disk((string) $run->storage_disk)->path((string) $run->storage_path);
$privateCopyExists = is_file($storedPath);
$storedSha256 = is_file($storedPath) ? hash_file('sha256', $storedPath) : false;
$fixtureSha256 = hash_file('sha256', $inputPath);
$extension = strtolower(pathinfo((string) $run->original_name, PATHINFO_EXTENSION));
$reader = app(ImportWorkbookReader::class);
$options = is_string($run->processing_options) ? json_decode($run->processing_options, true, 512, JSON_THROW_ON_ERROR) : [];
$overrides = is_array($options['column_overrides'] ?? null) ? $options['column_overrides'] : [];
$inspection = $reader->inspect($inputPath, $extension, $overrides);
$expectedRows = $reader->rows($inputPath, $inspection);
$expectedRows->rewind();
$expectedSheets = $inspection['sheets'];
$storedSheets = DB::table('import_sheets')->where('organization_id', $run->organization_id)
    ->where('import_run_id', $run->run_id)->orderBy('source_sheet_index')->get([
        'id', 'source_sheet_index', 'source_sheet_name', 'source_headers', 'header_row_number',
    ]);
$sourceRowsCompared = 0;
$sourceRowsInDatabase = 0;
$sourceValueMismatches = 0;
$rowKeyMismatches = 0;
$firstMismatch = null;
$actualBySheet = [];
foreach ($storedSheets as $storedSheet) {
    $sheetIndex = (int) $storedSheet->source_sheet_index;
    DB::table('import_source_rows')->where('organization_id', $run->organization_id)
        ->where('import_run_id', $run->run_id)->where('import_sheet_id', $storedSheet->id)
        ->orderBy('source_row_number')->chunk(500, function ($actualChunk) use (
            $expectedRows, $sheetIndex, &$sourceRowsCompared, &$sourceRowsInDatabase, &$sourceValueMismatches, &$rowKeyMismatches, &$firstMismatch,
        ): void {
            foreach ($actualChunk as $actual) {
                $sourceRowsInDatabase++;
                if (! $expectedRows->valid()) {
                    $rowKeyMismatches++;
                    $firstMismatch ??= 'database_extra_row';
                    continue;
                }
                $expected = $expectedRows->current();
                $expectedSheet = (int) $expected['sheet']['index'];
                $expectedRow = (int) $expected['source_row_number'];
                $actualRow = (int) $actual->source_row_number;
                if ($expectedSheet !== $sheetIndex || $expectedRow !== $actualRow) {
                    $rowKeyMismatches++;
                    $firstMismatch ??= "row_key:$expectedSheet:$expectedRow";
                }
                $actualValues = json_decode((string) $actual->source_values, true, 512, JSON_THROW_ON_ERROR);
                if (json_encode($expected['values'], JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PRESERVE_ZERO_FRACTION)
                    !== json_encode($actualValues, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PRESERVE_ZERO_FRACTION)) {
                    $sourceValueMismatches++;
                    $firstMismatch ??= "source_values:$expectedSheet:$expectedRow";
                }
                $sourceRowsCompared++;
                $expectedRows->next();
            }
        });
    while ($expectedRows->valid() && (int) $expectedRows->current()['sheet']['index'] < $sheetIndex) {
        $rowKeyMismatches++;
        $firstMismatch ??= 'database_missing_sheet_rows';
        $expectedRows->next();
    }
}
while ($expectedRows->valid()) {
    $rowKeyMismatches++;
    $firstMismatch ??= 'database_missing_row';
    $expectedRows->next();
}

$sheetMetadataMismatches = 0;
if (count($expectedSheets) !== $storedSheets->count()) {
    $sheetMetadataMismatches++;
}
foreach ($expectedSheets as $index => $expectedSheet) {
    $stored = $storedSheets->get($index);
    if (! $stored || (int) $stored->source_sheet_index !== (int) $expectedSheet['index']
        || (string) $stored->source_sheet_name !== (string) $expectedSheet['name']
        || (int) $stored->header_row_number !== (int) $expectedSheet['header_row_number']
        || json_decode((string) $stored->source_headers, true, 512, JSON_THROW_ON_ERROR) !== $expectedSheet['headers']) {
        $sheetMetadataMismatches++;
    }
}

$result = [
    'database' => $database,
    'private_original_exists' => $privateCopyExists,
    'file_sha256_matches_import_metadata' => is_string($fixtureSha256) && hash_equals((string) $run->file_sha256, $fixtureSha256),
    'content_sha256_matches_private_original' => is_string($storedSha256) && hash_equals((string) $run->content_sha256, $storedSha256),
    'fixture_sha256_matches_private_original' => is_string($storedSha256) && is_string($fixtureSha256) && hash_equals($storedSha256, $fixtureSha256),
    'sheets_in_source_workbook' => count($expectedSheets),
    'sheet_metadata_mismatches' => $sheetMetadataMismatches,
    'source_rows_in_reader' => $sourceRowsCompared,
    'source_rows_in_database' => $sourceRowsInDatabase,
    'row_key_mismatches' => $rowKeyMismatches,
    'raw_source_value_mismatches' => $sourceValueMismatches,
    'first_mismatch_location' => $firstMismatch,
];
$result['all_source_values_match'] = $result['private_original_exists'] && $result['file_sha256_matches_import_metadata']
    && $result['content_sha256_matches_private_original'] && $result['fixture_sha256_matches_private_original']
    && $result['sheet_metadata_mismatches'] === 0 && $result['row_key_mismatches'] === 0
    && $result['raw_source_value_mismatches'] === 0 && $result['source_rows_in_reader'] === $result['source_rows_in_database']
    && $result['source_rows_in_database'] === (int) $run->source_rows_count;
$result['run_id'] = (string) $run->run_id;
$outputPath = $backend.'/.local/import-benchmark/phase3-results/source-verification-'.$run->run_id.'.json';
if (! is_dir(dirname($outputPath)) && ! mkdir(dirname($outputPath), 0777, true) && ! is_dir(dirname($outputPath))) {
    throw new RuntimeException('Could not create the E-drive source verification report directory.');
}
$encodedResult = json_encode($result, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR);
file_put_contents($outputPath, $encodedResult."\n");
fwrite(STDOUT, $encodedResult."\n");
exit($result['all_source_values_match'] ? 0 : 1);
