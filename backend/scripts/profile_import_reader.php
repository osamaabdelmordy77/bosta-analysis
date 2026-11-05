<?php

declare(strict_types=1);

use OpenSpout\Common\Entity\Cell\FormulaCell;
use OpenSpout\Reader\CSV\Options as CsvOptions;
use OpenSpout\Reader\CSV\Reader as CsvReader;
use OpenSpout\Reader\XLSX\Options as XlsxOptions;
use OpenSpout\Reader\XLSX\Reader as XlsxReader;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Reader\IReadFilter;

$backend = dirname(__DIR__);
require $backend.'/vendor/autoload.php';

$file = $argv[1] ?? '';
$format = strtolower(pathinfo($file, PATHINFO_EXTENSION));
$mode = $argv[2] ?? 'both';
if (! is_file($file) || ! in_array($format, ['xlsx', 'xls', 'csv'], true)) {
    fwrite(STDERR, "Usage: php scripts/profile_import_reader.php <xlsx|xls|csv-file> [open|spreadsheet|both]\n");
    exit(2);
}

$sha256 = hash_file('sha256', $file);
$results = [];
if ($format !== 'xls' && in_array($mode, ['open', 'both'], true)) {
    $options = $format === 'xlsx' ? new XlsxOptions() : new CsvOptions();
    if ($format === 'xlsx') {
        $options->SHOULD_PRESERVE_EMPTY_ROWS = true;
        $reader = new XlsxReader($options);
    } else {
        $options->SHOULD_PRESERVE_EMPTY_ROWS = true;
        $options->FIELD_DELIMITER = detectDelimiter($file);
        $options->ENCODING = detectEncoding($file);
        $reader = new CsvReader($options);
    }

    $start = hrtime(true);
    $reader->open($file);
    $sheets = 0;
    $rows = 0;
    $nonEmptyRows = 0;
    $cells = 0;
    $hash = hash_init('sha256');
    foreach ($reader->getSheetIterator() as $sheet) {
        $sheets++;
        foreach ($sheet->getRowIterator() as $rowIndex => $row) {
            $values = [];
            foreach ($row->getCells() as $columnIndex => $cell) {
                $value = $cell instanceof FormulaCell ? $cell->getComputedValue() : $cell->getValue();
                if ($value instanceof DateTimeInterface) {
                    // OpenSpout exposes formatted Excel date cells as DateTime values; record this explicitly
                    // during reader selection because converting back to a serial can round sub-second data.
                    $value = ['datetime' => $value->format('Y-m-d H:i:s.u')];
                }
                $values[$columnIndex] = $value;
                $cells++;
            }
            if (array_filter($values, static fn (mixed $value): bool => $value !== null && $value !== '') !== []) {
                $nonEmptyRows++;
            }
            $rows++;
            hash_update($hash, json_encode([$sheet->getIndex(), $sheet->getName(), $rowIndex, $values], JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PRESERVE_ZERO_FRACTION)."\n");
        }
    }
    $reader->close();
    $results['openspout_stream'] = [
        'elapsed_ms' => round((hrtime(true) - $start) / 1_000_000, 3),
        'sheets' => $sheets,
        'rows_including_blank_rows' => $rows,
        'nonempty_rows' => $nonEmptyRows,
        'cells' => $cells,
        'value_digest' => hash_final($hash),
        'peak_memory_bytes' => memory_get_peak_usage(true),
        'datetime_cells_are_returned_as_objects' => true,
        'delimiter' => $format === 'csv' ? $options->FIELD_DELIMITER : null,
        'encoding' => $format === 'csv' ? $options->ENCODING : null,
    ];
}

if (! in_array($mode, ['spreadsheet', 'both'], true)) {
    echo json_encode([
        'file' => basename($file),
        'bytes' => filesize($file),
        'sha256' => $sha256,
        'memory_limit' => ini_get('memory_limit'),
        'results' => $results,
    ], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR).PHP_EOL;
    exit(0);
}

$start = hrtime(true);
$reader = IOFactory::createReaderForFile($file);
$reader->setReadDataOnly(false);
$reader->setReadEmptyCells(false);
$sheetInfo = $reader->listWorksheetInfo($file);
$filter = new class implements IReadFilter
{
    public int $startRow = 1;
    public int $endRow = PHP_INT_MAX;

    public function readCell(string $columnAddress, int $row, string $worksheetName = ''): bool
    {
        return $row >= $this->startRow && $row <= $this->endRow;
    }
};
$reader->setReadFilter($filter);
$chunkSize = 750;
$spreadsheetRows = 0;
$spreadsheetNonemptyRows = 0;
$spreadsheetCells = 0;
$spreadsheetHash = hash_init('sha256');
foreach ($sheetInfo as $info) {
    $sheetName = (string) $info['worksheetName'];
    $sheetRows = (int) $info['totalRows'];
    $sheetColumns = (int) $info['totalColumns'];
    $reader->setLoadSheetsOnly([$sheetName]);
    for ($firstRow = 1; $firstRow <= $sheetRows; $firstRow += $chunkSize) {
        $filter->startRow = $firstRow;
        $filter->endRow = min($sheetRows, $firstRow + $chunkSize - 1);
        $book = $reader->load($file);
        $sheet = $book->getSheetByName($sheetName);
        if ($sheet !== null) {
            for ($rowIndex = $firstRow; $rowIndex <= $filter->endRow; $rowIndex++) {
                $values = [];
                $nonempty = false;
                for ($column = 1; $column <= $sheetColumns; $column++) {
                    $value = $sheet->getCell([$column, $rowIndex])->getValue();
                    $values[] = $value;
                    if ($value !== null && $value !== '') {
                        $nonempty = true;
                    }
                }
                $spreadsheetCells += $sheetColumns;
                $spreadsheetRows++;
                $spreadsheetNonemptyRows += (int) $nonempty;
                hash_update($spreadsheetHash, json_encode([$sheetName, $rowIndex, $values], JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PRESERVE_ZERO_FRACTION)."\n");
            }
        }
        $book->disconnectWorksheets();
        unset($book, $sheet);
    }
}
$results['phpspreadsheet_chunk_750'] = [
    'elapsed_ms' => round((hrtime(true) - $start) / 1_000_000, 3),
    'sheets' => count($sheetInfo),
    'rows_including_blank_rows' => $spreadsheetRows,
    'nonempty_rows' => $spreadsheetNonemptyRows,
    'cells' => $spreadsheetCells,
    'value_digest' => hash_final($spreadsheetHash),
    'peak_memory_bytes' => memory_get_peak_usage(true),
    'read_filter_chunk_rows' => $chunkSize,
    'note' => 'Full workbook parsing and hash only; formula cells remain raw formula expressions in this candidate profile.',
];

echo json_encode([
    'file' => basename($file),
    'bytes' => filesize($file),
    'sha256' => $sha256,
    'memory_limit' => ini_get('memory_limit'),
    'results' => $results,
], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR).PHP_EOL;

function detectDelimiter(string $file): string
{
    $handle = fopen($file, 'rb');
    if ($handle === false) {
        return ',';
    }
    $line = fgets($handle, 65536) ?: '';
    fclose($handle);
    $line = preg_replace('/^\xEF\xBB\xBF/', '', $line) ?? $line;
    $scores = [];
    foreach ([',', ';', "\t", '|'] as $delimiter) {
        $scores[$delimiter] = count(str_getcsv($line, $delimiter));
    }
    arsort($scores);

    return (string) array_key_first($scores);
}

function detectEncoding(string $file): string
{
    $head = file_get_contents($file, false, null, 0, 4) ?: '';
    return str_starts_with($head, "\xFF\xFE") ? 'UTF-16LE'
        : (str_starts_with($head, "\xFE\xFF") ? 'UTF-16BE' : 'UTF-8');
}
