<?php

namespace Tests\Unit;

use App\Imports\ImportWorkbookReader;
use PhpOffice\PhpSpreadsheet\Cell\Coordinate;
use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\Shared\Date;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xls;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use Tests\TestCase;
use ZipArchive;

class ImportWorkbookReaderTest extends TestCase
{
    public function test_streaming_xlsx_reader_preserves_exact_date_serial_and_all_source_sheets(): void
    {
        $directory = storage_path('app/private/phase3-reader-tests');
        if (! is_dir($directory)) {
            mkdir($directory, 0700, true);
        }
        $path = $directory.'/raw-date-'.bin2hex(random_bytes(6)).'.xlsx';
        $spreadsheet = new Spreadsheet();
        $spreadsheet->setExcelCalendar(Date::CALENDAR_MAC_1904);
        $manifest = collect(config('bosta_columns'))->sortBy('source_number')->values();
        $headers = $manifest->pluck('source_label')->all();
        $trackingIndex = $manifest->search(fn (array $column): bool => $column['table'] === 'shipment_snapshots'
            && $column['physical_column'] === 'tracking_number');
        $dateIndex = $manifest->search(fn (array $column): bool => $column['table'] === 'shipment_snapshots'
            && $column['physical_column'] === 'source_created_at');
        self::assertIsInt($trackingIndex);
        self::assertIsInt($dateIndex);

        $sheet = $spreadsheet->getActiveSheet();
        $sheet->setTitle('Deliveries');
        $sheet->fromArray($headers, null, 'A1');
        $trackingColumn = Coordinate::stringFromColumnIndex($trackingIndex + 1);
        $dateColumn = Coordinate::stringFromColumnIndex($dateIndex + 1);
        $sheet->setCellValueExplicit($trackingColumn.'2', '0000123400', DataType::TYPE_STRING);
        $sheet->setCellValueExplicit($dateColumn.'2', 43831.123456789, DataType::TYPE_NUMERIC);
        $sheet->getStyle($dateColumn.'2')->getNumberFormat()->setFormatCode('yyyy-mm-dd hh:mm:ss.000000');
        $other = $spreadsheet->createSheet();
        $other->setTitle('Other source');
        $other->fromArray(['Unmapped field', 'Quoted note'], null, 'A1');
        $other->fromArray(['retained', "line one, line two\ninside a cell"], null, 'A2');
        (new Xlsx($spreadsheet))->save($path);

        try {
            $zip = new ZipArchive();
            self::assertTrue($zip->open($path) === true);
            $xml = $zip->getFromName('xl/worksheets/sheet1.xml');
            $zip->close();
            self::assertIsString($xml);
            $reference = preg_quote($dateColumn.'2', '/');
            self::assertSame(1, preg_match('/<c\b[^>]*\br="'.$reference.'"[^>]*>.*?<v>([^<]+)<\/v>.*?<\/c>/s', $xml, $match));
            $rawSerial = html_entity_decode($match[1], ENT_QUOTES | ENT_XML1, 'UTF-8');

            $reader = app(ImportWorkbookReader::class);
            $inspection = $reader->inspect($path, 'xlsx');
            self::assertSame('1904', $inspection['date_system']);
            self::assertCount(2, $inspection['sheets']);
            $rows = iterator_to_array($reader->rows($path, $inspection), false);
            self::assertCount(2, $rows);
            self::assertSame('Deliveries', $rows[0]['sheet']['name']);
            self::assertSame(2, $rows[0]['source_row_number']);
            self::assertSame('0000123400', $rows[0]['values'][$trackingIndex]);
            self::assertSame($rawSerial, $rows[0]['values'][$dateIndex]);
            self::assertSame('Other source', $rows[1]['sheet']['name']);
            self::assertSame("line one, line two\ninside a cell", $rows[1]['values'][1]);
        } finally {
            @unlink($path);
        }
    }

    public function test_legacy_xls_and_quoted_multiline_csv_remain_readable(): void
    {
        $directory = storage_path('app/private/phase3-reader-tests');
        if (! is_dir($directory)) {
            mkdir($directory, 0700, true);
        }
        $xlsPath = $directory.'/legacy-'.bin2hex(random_bytes(6)).'.xls';
        $csvPath = $directory.'/quoted-'.bin2hex(random_bytes(6)).'.csv';
        $manifest = collect(config('bosta_columns'))->sortBy('source_number')->values();
        $headers = $manifest->pluck('source_label')->all();
        $trackingIndex = $manifest->search(fn (array $column): bool => $column['table'] === 'shipment_snapshots'
            && $column['physical_column'] === 'tracking_number');

        $spreadsheet = new Spreadsheet();
        $sheet = $spreadsheet->getActiveSheet();
        $sheet->setTitle('Legacy XLS');
        $sheet->fromArray($headers, null, 'A1');
        $trackingColumn = Coordinate::stringFromColumnIndex($trackingIndex + 1);
        $sheet->setCellValueExplicit($trackingColumn.'2', '0000098765', DataType::TYPE_STRING);
        (new Xls($spreadsheet))->save($xlsPath);
        $spreadsheet->disconnectWorksheets();

        $noteIndex = 1;
        $row = array_fill(0, count($headers), '');
        $row[$trackingIndex] = '0000012345';
        $row[$noteIndex] = "North, \"Dock\"\nAt 7am";
        $stream = fopen($csvPath, 'wb');
        fputcsv($stream, $headers, ',', '"', '\\');
        fputcsv($stream, $row, ',', '"', '\\');
        fclose($stream);

        try {
            $reader = app(ImportWorkbookReader::class);
            $xlsInspection = $reader->inspect($xlsPath, 'xls');
            $xlsRows = iterator_to_array($reader->rows($xlsPath, $xlsInspection), false);
            self::assertSame('xls', $xlsInspection['format']);
            self::assertSame(2, $xlsRows[0]['source_row_number']);
            self::assertSame('0000098765', $xlsRows[0]['values'][$trackingIndex]);

            $csvInspection = $reader->inspect($csvPath, 'csv');
            $csvRows = iterator_to_array($reader->rows($csvPath, $csvInspection), false);
            self::assertSame('csv', $csvInspection['format']);
            self::assertSame(2, $csvRows[0]['source_row_number']);
            self::assertSame('0000012345', $csvRows[0]['values'][$trackingIndex]);
            self::assertSame("North, \"Dock\"\nAt 7am", $csvRows[0]['values'][$noteIndex]);
        } finally {
            @unlink($xlsPath);
            @unlink($csvPath);
            $spreadsheet->disconnectWorksheets();
        }
    }
}
