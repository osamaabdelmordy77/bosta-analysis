<?php

declare(strict_types=1);

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

$backend = dirname(__DIR__);
require $backend.'/vendor/autoload.php';
$app = require $backend.'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

[$beforeSlug, $afterSlug] = array_slice($argv, 1);
if (! $beforeSlug || ! $afterSlug || DB::connection()->getDatabaseName() !== 'bosta_analysis_benchmark') {
    fwrite(STDERR, "Usage: php scripts/compare_import_benchmarks.php <before-org> <after-org> (requires bosta_analysis_benchmark)\n");
    exit(2);
}

$before = importRun($beforeSlug);
$after = importRun($afterSlug);
$storedFileBefore = storedOriginalContent($before);
$storedFileAfter = storedOriginalContent($after);
$sourceComparison = compareStreams(sourceHashes($before), sourceHashes($after));
$sheetComparison = compareStreams(sheetHashes($before), sheetHashes($after));
$snapshotComparison = compareStreams(snapshotHashes($before), snapshotHashes($after));

$childTables = [
    'shipment_snapshot_parties',
    'shipment_snapshot_routing',
    'shipment_snapshot_financials',
    'shipment_snapshot_service',
];
$childComparisons = [];
foreach ($childTables as $table) {
    $childComparisons[$table] = compareStreams(childHashes($table, $before), childHashes($table, $after));
}
$childComparisons['delivery_attempts'] = compareStreams(attemptHashes($before), attemptHashes($after));
$childComparisons['import_issues'] = compareStreams(issueHashes($before), issueHashes($after));

$summary = [
    'database' => DB::connection()->getDatabaseName(),
    'before_organization' => $beforeSlug,
    'after_organization' => $afterSlug,
    'same_original_sha256' => hash_equals($before['sha256'], $after['sha256']),
    'stored_original_content' => [
        'before' => $storedFileBefore,
        'after' => $storedFileAfter,
        'both_match_file_metadata' => hash_equals($before['sha256'], $storedFileBefore['sha256'])
            && hash_equals($after['sha256'], $storedFileAfter['sha256']),
        'same_content' => hash_equals($storedFileBefore['sha256'], $storedFileAfter['sha256'])
            && $storedFileBefore['bytes'] === $storedFileAfter['bytes'],
    ],
    'before_counts' => importCounts($before),
    'after_counts' => importCounts($after),
    'source_rows' => $sourceComparison,
    'sheet_names_headers_and_row_metadata' => $sheetComparison,
    'normalized_snapshots' => $snapshotComparison,
    'related_tables' => $childComparisons,
    'all_values_match' => $sourceComparison['mismatches'] === 0
        && $sheetComparison['mismatches'] === 0
        && $snapshotComparison['mismatches'] === 0
        && array_sum(array_column($childComparisons, 'mismatches')) === 0
        && hash_equals($before['sha256'], $after['sha256'])
        && $storedFileBefore['bytes'] === $storedFileAfter['bytes']
        && hash_equals($before['sha256'], $storedFileBefore['sha256'])
        && hash_equals($after['sha256'], $storedFileAfter['sha256']),
];

fwrite(STDOUT, json_encode($summary, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR)."\n");
exit($summary['all_values_match'] ? 0 : 1);

function importRun(string $slug): array
{
    $run = DB::table('organizations as o')
        ->join('import_files as f', 'f.organization_id', '=', 'o.id')
        ->join('import_runs as r', 'r.import_file_id', '=', 'f.id')
        ->where('o.slug', $slug)
        ->orderByDesc('r.revision')
        ->first(['o.id as organization_id', 'r.id as run_id', 'r.status', 'f.sha256']);

    if (! $run || $run->status !== 'published') {
        throw new RuntimeException('Each selected organization must contain a published benchmark run.');
    }

    return [
        'organization_id' => (string) $run->organization_id,
        'run_id' => (string) $run->run_id,
        'sha256' => (string) $run->sha256,
    ];
}

function importCounts(array $run): array
{
    $counts = DB::table('import_runs')->where('id', $run['run_id'])->first([
        'source_rows_count', 'accepted_rows_count', 'duplicate_rows_count', 'rejected_rows_count', 'issues_count',
    ]);

    return array_map('intval', (array) $counts);
}

function storedOriginalContent(array $run): array
{
    $contentId = DB::table('import_file_contents')
        ->where('organization_id', $run['organization_id'])
        ->where('import_run_id', $run['run_id'])
        ->value('id');
    if (! is_string($contentId) || $contentId === '') {
        throw new RuntimeException('A benchmark run is missing its stored original file.');
    }

    $context = hash_init('sha256');
    $bytes = 0;
    foreach (DB::table('import_file_content_chunks')->where('import_file_content_id', $contentId)
        ->orderBy('chunk_index')->cursor(['contents']) as $chunk) {
        $contents = (string) $chunk->contents;
        $bytes += strlen($contents);
        hash_update($context, $contents);
    }

    return ['bytes' => $bytes, 'sha256' => hash_final($context)];
}

/** @return Generator<int,array{0:string,1:string}> */
function sourceHashes(array $run): Generator
{
    $rows = DB::table('import_source_rows as sr')
        ->join('import_sheets as sh', 'sh.id', '=', 'sr.import_sheet_id')
        ->where('sr.organization_id', $run['organization_id'])
        ->where('sr.import_run_id', $run['run_id'])
        ->orderBy('sh.source_sheet_index')
        ->orderBy('sr.source_row_number')
        ->cursor(['sh.source_sheet_index', 'sr.source_row_number', 'sr.status', 'sr.issues_count', 'sr.source_values']);

    foreach ($rows as $row) {
        $key = sourceKey((int) $row->source_sheet_index, (int) $row->source_row_number);
        yield [$key, hash('sha256', (string) $row->status."\0".(string) $row->issues_count."\0".(string) $row->source_values)];
    }
}

/** @return Generator<int,array{0:string,1:string}> */
function sheetHashes(array $run): Generator
{
    $sheets = DB::table('import_sheets')
        ->where('organization_id', $run['organization_id'])
        ->where('import_run_id', $run['run_id'])
        ->orderBy('source_sheet_index')
        ->cursor([
            'source_sheet_index', 'source_sheet_name', 'source_headers', 'header_row_number',
            'data_rows_count', 'detected_columns_count',
        ]);

    foreach ($sheets as $sheet) {
        $headers = is_string($sheet->source_headers)
            ? json_decode($sheet->source_headers, true, 512, JSON_THROW_ON_ERROR)
            : $sheet->source_headers;
        yield [
            (string) $sheet->source_sheet_index,
            stableHash([
                'source_sheet_name' => (string) $sheet->source_sheet_name,
                'source_headers' => $headers,
                'header_row_number' => (int) $sheet->header_row_number,
                'data_rows_count' => (int) $sheet->data_rows_count,
                'detected_columns_count' => (int) $sheet->detected_columns_count,
            ]),
        ];
    }
}

/** @return Generator<int,array{0:string,1:string}> */
function snapshotHashes(array $run): Generator
{
    $excluded = array_fill_keys([
        'id', 'organization_id', 'shipment_id', 'import_run_id', 'import_source_row_id', 'business_id',
        'current_hub_id', 'assigned_hub_id', 'auto_assigned_hub_id', 'first_hub_id', 'last_dispatch_hub_id',
        'loss_liable_hub_id', 'delivery_state_fingerprint', 'created_at', 'updated_at',
    ], true);
    $query = DB::table('shipment_snapshots as ss')
        ->join('import_source_rows as sr', 'sr.id', '=', 'ss.import_source_row_id')
        ->join('import_sheets as sh', 'sh.id', '=', 'sr.import_sheet_id')
        ->where('ss.organization_id', $run['organization_id'])
        ->where('ss.import_run_id', $run['run_id'])
        ->orderBy('sh.source_sheet_index')
        ->orderBy('sr.source_row_number')
        ->select(['ss.*', 'sh.source_sheet_index', 'sr.source_row_number']);

    foreach ($query->cursor() as $row) {
        $values = (array) $row;
        $key = sourceKey((int) $values['source_sheet_index'], (int) $values['source_row_number']);
        unset($values['source_sheet_index'], $values['source_row_number']);
        foreach ($excluded as $column => $_) {
            unset($values[$column]);
        }
        $values['business_link_present'] = $row->business_id !== null;
        foreach (['current_hub_id', 'assigned_hub_id', 'auto_assigned_hub_id', 'first_hub_id', 'last_dispatch_hub_id', 'loss_liable_hub_id'] as $column) {
            $values[$column.'_present'] = $row->{$column} !== null;
        }
        yield [$key, stableHash($values)];
    }
}

/** @return Generator<int,array{0:string,1:string}> */
function childHashes(string $table, array $run): Generator
{
    $excluded = array_fill_keys(['id', 'organization_id', 'shipment_snapshot_id', 'created_at', 'updated_at'], true);
    $query = DB::table($table.' as child')
        ->join('shipment_snapshots as ss', 'ss.id', '=', 'child.shipment_snapshot_id')
        ->join('import_source_rows as sr', 'sr.id', '=', 'ss.import_source_row_id')
        ->join('import_sheets as sh', 'sh.id', '=', 'sr.import_sheet_id')
        ->where('ss.organization_id', $run['organization_id'])
        ->where('ss.import_run_id', $run['run_id'])
        ->orderBy('sh.source_sheet_index')
        ->orderBy('sr.source_row_number')
        ->select(['child.*', 'sh.source_sheet_index', 'sr.source_row_number']);

    foreach ($query->cursor() as $row) {
        $values = (array) $row;
        $key = sourceKey((int) $values['source_sheet_index'], (int) $values['source_row_number']);
        unset($values['source_sheet_index'], $values['source_row_number']);
        foreach ($excluded as $column => $_) {
            unset($values[$column]);
        }
        yield [$key, stableHash($values)];
    }
}

/** @return Generator<int,array{0:string,1:string}> */
function attemptHashes(array $run): Generator
{
    $excluded = array_fill_keys(['id', 'organization_id', 'shipment_snapshot_id', 'created_at', 'updated_at'], true);
    $query = DB::table('delivery_attempts as attempt')
        ->join('shipment_snapshots as ss', 'ss.id', '=', 'attempt.shipment_snapshot_id')
        ->join('import_source_rows as sr', 'sr.id', '=', 'ss.import_source_row_id')
        ->join('import_sheets as sh', 'sh.id', '=', 'sr.import_sheet_id')
        ->where('ss.organization_id', $run['organization_id'])
        ->where('ss.import_run_id', $run['run_id'])
        ->orderBy('sh.source_sheet_index')
        ->orderBy('sr.source_row_number')
        ->orderBy('attempt.attempt_index')
        ->select(['attempt.*', 'sh.source_sheet_index', 'sr.source_row_number']);

    foreach ($query->cursor() as $row) {
        $values = (array) $row;
        $key = sourceKey((int) $values['source_sheet_index'], (int) $values['source_row_number']);
        unset($values['source_sheet_index'], $values['source_row_number']);
        foreach ($excluded as $column => $_) {
            unset($values[$column]);
        }
        yield [$key.':'.(int) $values['attempt_index'], stableHash($values)];
    }
}

/** @return Generator<int,array{0:string,1:string}> */
function issueHashes(array $run): Generator
{
    $query = DB::table('import_issues as issue')
        ->leftJoin('import_source_rows as sr', 'sr.id', '=', 'issue.import_source_row_id')
        ->leftJoin('import_sheets as sh', 'sh.id', '=', 'sr.import_sheet_id')
        ->where('issue.organization_id', $run['organization_id'])
        ->where('issue.import_run_id', $run['run_id'])
        ->orderBy('issue.source_sheet_index')
        ->orderBy('issue.source_row_number')
        ->orderBy('issue.source_column_number')
        ->orderBy('issue.source_column_label')
        ->orderBy('issue.issue_code')
        ->orderBy('issue.severity')
        ->orderBy('issue.safe_message')
        ->select([
            'issue.source_sheet_index', 'issue.source_row_number', 'issue.source_column_number',
            'issue.source_column_label', 'issue.issue_code', 'issue.severity', 'issue.safe_message',
            'sh.source_sheet_index as joined_sheet_index',
        ]);

    foreach ($query->cursor() as $row) {
        $sheetIndex = (int) ($row->source_sheet_index ?? $row->joined_sheet_index ?? 0);
        $key = sourceKey($sheetIndex, (int) ($row->source_row_number ?? 0));
        $values = [
            $row->source_column_number,
            $row->source_column_label,
            $row->issue_code,
            $row->severity,
            $row->safe_message,
        ];
        yield [$key.':'.(string) ($row->source_column_number ?? '').':'.(string) $row->issue_code, stableHash($values)];
    }
}

function stableHash(array $values): string
{
    ksort($values, SORT_STRING);

    return hash('sha256', json_encode($values, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PRESERVE_ZERO_FRACTION));
}

function compareStreams(Generator $before, Generator $after): array
{
    $mismatches = 0;
    $beforeRows = 0;
    $afterRows = 0;
    $before->rewind();
    $after->rewind();
    while ($before->valid() || $after->valid()) {
        $beforeValid = $before->valid();
        $afterValid = $after->valid();
        if ($beforeValid) {
            $beforeRows++;
        }
        if ($afterValid) {
            $afterRows++;
        }
        if (! $beforeValid || ! $afterValid) {
            $mismatches++;
        } elseif ($before->current()[0] !== $after->current()[0]
            || ! hash_equals($before->current()[1], $after->current()[1])) {
            $mismatches++;
        }
        if ($beforeValid) {
            $before->next();
        }
        if ($afterValid) {
            $after->next();
        }
    }

    return ['before_rows' => $beforeRows, 'after_rows' => $afterRows, 'mismatches' => $mismatches];
}

function sourceKey(int $sheetIndex, int $rowNumber): string
{
    return $sheetIndex.':'.$rowNumber;
}
