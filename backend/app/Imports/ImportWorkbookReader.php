<?php

namespace App\Imports;

use DateTimeInterface;
use OpenSpout\Common\Entity\Cell;
use OpenSpout\Common\Entity\Cell\FormulaCell;
use OpenSpout\Common\Helper\EncodingHelper;
use OpenSpout\Reader\CSV\Options as CsvOptions;
use OpenSpout\Reader\CSV\Reader as CsvReader;
use OpenSpout\Reader\XLSX\Options as XlsxOptions;
use OpenSpout\Reader\XLSX\Reader as XlsxReader;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Reader\IReadFilter;
use PhpOffice\PhpSpreadsheet\Shared\Date;
use RuntimeException;

class ImportWorkbookReader
{
    /** @var list<array{source_number:int,source_label:string,table:string,physical_column:string,provisional_type:string}> */
    private array $manifest;

    public function __construct()
    {
        $this->manifest = config('bosta_columns', []);
    }

    /** @return array{format:string,date_system:string,sheets:list<array<string,mixed>>,selected_sheets:list<array<string,mixed>>,hub_labels:list<string>,all_headers:list<string>,total_source_rows:null} */
    public function inspect(string $path, string $clientExtension, array $overrides = []): array
    {
        $format = $this->detectFormat($path, $clientExtension);
        $sourceSheets = match ($format) {
            'xlsx', 'csv' => $this->inspectOpenSpout($path, $format),
            'xls' => $this->inspectPhpSpreadsheet($path),
            default => throw new RuntimeException('The uploaded file format could not be identified.'),
        };

        if ($sourceSheets === [] || count($sourceSheets) > 100) {
            throw new RuntimeException('A workbook must contain between 1 and 100 readable worksheets.');
        }

        $candidates = array_values(array_filter($sourceSheets, static fn (array $sheet): bool => ($sheet['detection']['tracking'] ?? null) !== null || $sheet['detection']['score'] >= 3
        ));
        if ($candidates === []) {
            // Match the existing browser parser's fallback without mistaking a
            // worksheet's declared range for its number of populated rows.
            foreach ($sourceSheets as &$sheet) {
                $sheet['nonempty_data_rows'] = $this->countNonemptyRows($path, $format, $sheet);
            }
            unset($sheet);
            $candidates = array_values(array_filter($sourceSheets, static fn (array $sheet): bool => $sheet['nonempty_data_rows'] > 0));
            usort($candidates, static fn (array $left, array $right): int => ($right['detection']['score'] <=> $left['detection']['score'])
                ?: ($right['nonempty_data_rows'] <=> $left['nonempty_data_rows'])
            );
            $candidates = array_slice($candidates, 0, 1);
        }

        $hubLabels = [];
        $hubNorms = [];
        foreach ($candidates as $candidate) {
            foreach ($candidate['detection']['hubs'] as $columnIndex) {
                $normalized = $candidate['normalized_headers'][$columnIndex] ?? '';
                if ($normalized !== '' && ! in_array($normalized, $hubNorms, true)) {
                    $hubNorms[] = $normalized;
                    $hubLabels[] = $candidate['headers'][$columnIndex];
                }
            }
        }

        $candidateIndexes = array_fill_keys(array_column($candidates, 'index'), true);
        foreach ($sourceSheets as &$sheet) {
            $sheet['candidate'] = isset($candidateIndexes[$sheet['index']]);
            $sheet['hub_columns_by_label'] = [];
            foreach ($hubLabels as $label) {
                $normalized = self::normalize($label);
                $sheet['hub_columns_by_label'][$label] = array_search($normalized, $sheet['normalized_headers'], true);
            }
            $sheet['role_indexes'] = [];
            foreach (['tracking', 'items', 'business', 'shipType', 'packageType', 'packageSize', 'pickupCity', 'dropCity', 'pickupZone'] as $role) {
                $override = $overrides[$role] ?? null;
                $index = is_string($override) && trim($override) !== ''
                    ? array_search(self::normalize($override), $sheet['normalized_headers'], true)
                    : ($sheet['detection'][$role] ?? -1);
                $sheet['role_indexes'][$role] = is_int($index) ? $index : -1;
            }
            unset($sheet['sample_rows'], $sheet['normalized_headers'], $sheet['detection'], $sheet['nonempty_data_rows'], $sheet['physical_row_count']);
        }
        unset($sheet);

        $allHeaders = [];
        foreach ($sourceSheets as $sheet) {
            foreach ($sheet['headers'] as $header) {
                $allHeaders[$header] = true;
            }
        }

        return [
            'format' => $format,
            'date_system' => $sourceSheets[0]['date_system'] ?? '1900',
            'sheets' => $sourceSheets,
            'selected_sheets' => array_values(array_filter($sourceSheets, static fn (array $sheet): bool => $sheet['candidate'])),
            'hub_labels' => $hubLabels,
            'all_headers' => array_keys($allHeaders),
            // Counting requires a complete second pass; keeping the denominator
            // unknown avoids presenting worksheet range metadata as real work.
            'total_source_rows' => null,
        ];
    }

    /** @param array<string,mixed> $inspection @return \Generator<int,array{sheet:array<string,mixed>,source_row_number:int,values:list<mixed>}> */
    public function rows(string $path, array $inspection): \Generator
    {
        if ($inspection['format'] === 'xls') {
            yield from $this->spreadsheetRows($path, $inspection['sheets']);

            return;
        }

        if ($inspection['format'] === 'xlsx') {
            $targets = $this->xlsxWorksheetTargets($path);
            $stream = new XlsxRowStream;
            foreach ($inspection['sheets'] as $sheet) {
                $target = $targets[(int) $sheet['index']] ?? null;
                if (! is_string($target)) {
                    throw new RuntimeException('An XLSX worksheet relationship could not be resolved.');
                }
                foreach ($stream->rows($path, $target, (string) $inspection['date_system']) as [$number, $values]) {
                    if ($number <= (int) $sheet['header_row_number']) {
                        continue;
                    }
                    $values = array_slice(array_pad($values, count($sheet['headers']), null), 0, count($sheet['headers']));
                    if ($this->hasValues($values)) {
                        yield ['sheet' => $sheet, 'source_row_number' => $number, 'values' => $values];
                    }
                }
            }

            return;
        }

        $reader = $this->openStreamReader($path, $inspection['format']);
        $reader->open($path);
        try {
            $selected = [];
            foreach ($inspection['sheets'] as $sheet) {
                $selected[(int) $sheet['index']] = $sheet;
            }
            foreach ($reader->getSheetIterator() as $streamSheet) {
                $index = $streamSheet->getIndex();
                if (! isset($selected[$index])) {
                    continue;
                }
                $metadata = $selected[$index];
                foreach ($streamSheet->getRowIterator() as $rowIndex => $row) {
                    $sourceRowNumber = (int) $rowIndex;
                    if ($sourceRowNumber <= (int) $metadata['header_row_number']) {
                        continue;
                    }
                    if ($sourceRowNumber > (int) config('import_ingestion.max_source_row_number', 200000)) {
                        throw new RuntimeException('The workbook exceeds the supported source row number limit.');
                    }

                    $values = $this->openSpoutValues($row->getCells(), (string) $inspection['date_system']);
                    $values = array_pad($values, count($metadata['headers']), null);
                    if (count($values) > count($metadata['headers'])) {
                        if (count($values) > 512) {
                            throw new RuntimeException('The workbook exceeds the supported 512 source columns.');
                        }
                        $values = array_slice($values, 0, count($metadata['headers']));
                    }
                    if (! $this->hasValues($values)) {
                        continue;
                    }

                    yield ['sheet' => $metadata, 'source_row_number' => $sourceRowNumber, 'values' => $values];
                }
            }
        } finally {
            $reader->close();
        }
    }

    /** @param array<string,mixed> $sheet @param array<string,string> $overrides @param list<string> $hubLabels @return array<string,mixed>|null */
    public function dashboardRecord(array $sheet, array $values, string $fileName, int &$validRecordNumber, array &$seenTracking, array $overrides, array $hubLabels): ?array
    {
        $roleIndexes = $sheet['role_indexes'] ?? [];
        $indexFor = static fn (string $role): int => is_int($roleIndexes[$role] ?? null) ? $roleIndexes[$role] : -1;

        $trackingIndex = $indexFor('tracking');
        if ($trackingIndex >= 0) {
            $tracking = $this->trackingValue($values[$trackingIndex] ?? null);
            if ($tracking === null) {
                return null;
            }
            if (isset($seenTracking[$tracking])) {
                return null;
            }
            $seenTracking[$tracking] = true;
        } else {
            $tracking = 'ROW-'.$fileName.'-'.($validRecordNumber + 1);
        }
        $validRecordNumber++;

        $items = 1;
        $itemsIndex = $indexFor('items');
        if ($itemsIndex >= 0) {
            $rawItems = $values[$itemsIndex] ?? null;
            $number = is_numeric($rawItems) ? (float) $rawItems : $this->parseFloat($rawItems);
            if ($number !== null && is_finite($number) && $number >= 0) {
                $items = $number;
            }
        }

        $hubs = [];
        $assignedHub = null;
        foreach ($hubLabels as $label) {
            $columnIndex = $sheet['hub_columns_by_label'][$label] ?? false;
            $value = is_int($columnIndex) ? $this->cleanValue($values[$columnIndex] ?? null) : null;
            $hubs[$label] = $value;
            if (preg_match('/assigned/i', $label) === 1 && $value !== null && $assignedHub === null) {
                $assignedHub = $value;
            }
        }
        if ($assignedHub === null) {
            foreach ($hubs as $hub) {
                if ($hub !== null) {
                    $assignedHub = $hub;
                    break;
                }
            }
        }

        return [
            'tracking' => $tracking,
            'items' => $items,
            'business' => $this->roleValue($values, $indexFor('business')),
            'shipType' => $this->roleValue($values, $indexFor('shipType')),
            'packageType' => $this->roleValue($values, $indexFor('packageType')),
            'packageSize' => $this->roleValue($values, $indexFor('packageSize')),
            'pickupCity' => $this->roleValue($values, $indexFor('pickupCity')),
            'dropCity' => $this->roleValue($values, $indexFor('dropCity')),
            'pickupZone' => $this->roleValue($values, $indexFor('pickupZone')),
            'assignedHub' => $assignedHub,
            'hubs' => $hubs,
        ];
    }

    public static function normalize(string $label): string
    {
        return preg_replace('/[^a-z0-9]+/i', '', mb_strtolower(trim($label))) ?? '';
    }

    private function detectFormat(string $path, string $clientExtension): string
    {
        $handle = fopen($path, 'rb');
        if ($handle === false) {
            throw new RuntimeException('The uploaded workbook could not be opened.');
        }
        $signature = fread($handle, 256) ?: '';
        fclose($handle);

        if (str_starts_with($signature, "PK\x03\x04")) {
            $zip = new \ZipArchive;
            if ($zip->open($path) !== true || $zip->locateName('xl/workbook.xml') === false) {
                throw new RuntimeException('The uploaded ZIP file is not a readable XLSX workbook.');
            }
            $zip->close();

            return 'xlsx';
        }
        if (str_starts_with($signature, "\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1")) {
            return 'xls';
        }
        if ($clientExtension === 'csv' && ! str_contains($signature, "\0") && preg_match('/[,;\t\r\n]/', $signature) === 1) {
            return 'csv';
        }

        throw new RuntimeException('Upload a valid XLSX, XLS, or delimited CSV file.');
    }

    /** @return list<array<string,mixed>> */
    private function inspectOpenSpout(string $path, string $format): array
    {
        $dateSystem = $format === 'xlsx' ? $this->readXlsxDateSystem($path) : '1900';
        $reader = $this->openStreamReader($path, $format);
        $reader->open($path);
        $sheets = [];
        try {
            foreach ($reader->getSheetIterator() as $streamSheet) {
                if (count($sheets) >= 100) {
                    throw new RuntimeException('A workbook may contain at most 100 worksheets.');
                }
                $sampleRows = [];
                $maxColumns = 0;
                $physicalRows = 0;
                foreach ($streamSheet->getRowIterator() as $rowIndex => $row) {
                    $rowIndex = (int) $rowIndex;
                    if ($rowIndex > 215) {
                        break;
                    }
                    $physicalRows++;
                    $values = $this->openSpoutValues($row->getCells(), $dateSystem);
                    $maxColumns = max($maxColumns, count($values));
                    if ($maxColumns > 512) {
                        throw new RuntimeException('The workbook exceeds the supported 512 source columns.');
                    }
                    $sampleRows[] = ['source_row_number' => $rowIndex, 'values' => $values];
                }
                $sheets[] = $this->analyzeSheet(
                    $format === 'csv' ? count($sheets) : $streamSheet->getIndex(),
                    $format === 'csv' ? 'Sheet1' : $streamSheet->getName(),
                    $sampleRows,
                    $maxColumns,
                    $dateSystem,
                    null,
                );
            }
        } finally {
            $reader->close();
        }

        return $sheets;
    }

    /** @return list<array<string,mixed>> */
    private function inspectPhpSpreadsheet(string $path): array
    {
        $reader = IOFactory::createReaderForFile($path);
        $reader->setReadDataOnly(false)->setReadEmptyCells(false);
        $worksheetInfo = $reader->listWorksheetInfo($path);
        $filter = new class implements IReadFilter
        {
            public int $startRow = 1;

            public int $endRow = 215;

            public function readCell(string $columnAddress, int $row, string $worksheetName = ''): bool
            {
                return $row >= $this->startRow && $row <= $this->endRow;
            }
        };
        $reader->setReadFilter($filter);
        $sheets = [];
        foreach ($worksheetInfo as $sheetIndex => $info) {
            if (count($sheets) >= 100) {
                throw new RuntimeException('A workbook may contain at most 100 worksheets.');
            }
            $sheetName = (string) $info['worksheetName'];
            if ((int) $info['totalColumns'] > 512) {
                throw new RuntimeException('The XLS workbook exceeds the supported 512 source columns.');
            }
            $columnCount = max(1, (int) $info['totalColumns']);
            $filter->startRow = 1;
            $filter->endRow = min(215, max(1, (int) $info['totalRows']));
            $reader->setLoadSheetsOnly([$sheetName]);
            $book = $reader->load($path);
            $worksheet = $book->getSheetByName($sheetName);
            $sampleRows = [];
            if ($worksheet !== null) {
                for ($rowIndex = 1; $rowIndex <= $filter->endRow; $rowIndex++) {
                    $values = [];
                    for ($columnIndex = 1; $columnIndex <= $columnCount; $columnIndex++) {
                        $cell = $worksheet->getCell([$columnIndex, $rowIndex]);
                        $value = $cell->getValue();
                        if ($cell->getDataType() === 'f') {
                            $value = $cell->getOldCalculatedValue();
                        }
                        $values[] = $value === '' ? null : $value;
                    }
                    $sampleRows[] = ['source_row_number' => $rowIndex, 'values' => $values];
                }
            }
            $dateSystem = $book?->getExcelCalendar() === Date::CALENDAR_MAC_1904 ? '1904' : '1900';
            $sheets[] = $this->analyzeSheet((int) $sheetIndex, $sheetName, $sampleRows, $columnCount, $dateSystem, (int) $info['totalRows']);
            $book?->disconnectWorksheets();
            unset($book, $worksheet);
        }

        return $sheets;
    }

    /** @param array<string,mixed> $sheet @return int */
    private function countNonemptyRows(string $path, string $format, array $sheet): int
    {
        $count = 0;
        foreach ($this->rows($path, ['format' => $format, 'date_system' => $sheet['date_system'], 'selected_sheets' => [$sheet]]) as $_row) {
            $count++;
        }

        return $count;
    }

    /** @param list<array{source_row_number:int,values:list<mixed>}> $sampleRows @return array<string,mixed> */
    private function analyzeSheet(int $index, string $name, array $sampleRows, int $columnCount, string $dateSystem, ?int $physicalRows): array
    {
        $headerCandidateRows = array_slice($sampleRows, 0, 15);
        $headerIndex = 0;
        $best = -1;
        foreach ($headerCandidateRows as $candidateIndex => $row) {
            $score = count(array_filter($row['values'], static fn (mixed $value): bool => is_string($value) && trim($value) !== ''
            ));
            if ($score > $best) {
                $best = $score;
                $headerIndex = $candidateIndex;
            }
        }
        $header = $sampleRows[$headerIndex]['values'] ?? [];
        $headers = [];
        $columnCount = min(512, max($columnCount, count($header)));
        for ($column = 0; $column < $columnCount; $column++) {
            $value = $header[$column] ?? null;
            $headers[] = $value !== null && trim((string) $value) !== '' ? trim((string) $value) : 'Column '.($column + 1);
        }

        $dataRows = array_values(array_filter(array_slice($sampleRows, $headerIndex + 1, 200), fn (array $row): bool => $this->hasValues($row['values'])));
        $normalizedHeaders = array_map([self::class, 'normalize'], $headers);
        $detection = $this->detectColumns($headers, $normalizedHeaders, $dataRows);

        return [
            'index' => $index,
            'name' => $name,
            'date_system' => $dateSystem,
            'header_row_number' => (int) ($sampleRows[$headerIndex]['source_row_number'] ?? 1),
            'headers' => $headers,
            'normalized_headers' => $normalizedHeaders,
            'detection' => $detection,
            'sample_rows' => $sampleRows,
            'physical_row_count' => $physicalRows,
            'nonempty_data_rows' => 0,
            'candidate' => false,
        ];
    }

    /** @param list<string> $headers @param list<string> $normalizedHeaders @param list<array{source_row_number:int,values:list<mixed>}> $rows @return array<string,mixed> */
    private function detectColumns(array $headers, array $normalizedHeaders, array $rows): array
    {
        $roles = [
            'tracking' => [['trackingnumber', 'trackingno', 'trackingnum', 'trackingid', 'tracking', 'awb', 'awbnumber', 'waybill', 'waybillnumber', 'shipmentid', 'shipmentnumber', 'shipmentno', 'barcode'], ['tracking', 'waybill', 'awb']],
            'packageType' => [['packagetype', 'parceltype', 'packagecategory'], ['packagetype', 'parceltype']],
            'packageSize' => [['packagesize', 'parcelsize', 'size'], ['packagesize', 'parcelsize']],
            'shipType' => [['type', 'shipmenttype', 'deliverytype', 'ordertype', 'servicetype', 'shipmentcategory'], ['shipmenttype', 'deliverytype', 'ordertype', 'servicetype']],
            'pickupCity' => [['pickupcity', 'origincity', 'fromcity', 'sendercity', 'collectioncity'], ['pickupcity', 'origincity', 'fromcity']],
            'dropCity' => [['dropoffcity', 'dropcity', 'deliverycity', 'destinationcity', 'tocity', 'consigneecity', 'destcity'], ['dropoffcity', 'deliverycity', 'destinationcity']],
            'pickupZone' => [['pickupzone', 'pickuparea', 'originzone', 'pickupdistrict', 'pickupneighborhood'], ['pickupzone', 'pickuparea', 'originzone']],
            'items' => [['items', 'itemcount', 'noofitems', 'numberofitems', 'itemscount', 'quantity', 'qty', 'totalitems', 'itemsquantity'], ['itemcount', 'noofitems', 'numberofitems']],
            'business' => [['business', 'businessname', 'merchant', 'merchantname', 'seller', 'sellername', 'store', 'storename', 'shipper', 'shippername', 'client', 'clientname', 'sender'], ['business', 'merchant', 'seller', 'shipper']],
        ];
        $used = [];
        $detected = [];
        foreach ($roles as $role => [$exact, $parts]) {
            $found = null;
            foreach ($normalizedHeaders as $columnIndex => $header) {
                if (! isset($used[$columnIndex]) && in_array($header, $exact, true)) {
                    $found = $columnIndex;
                    break;
                }
            }
            if ($found === null) {
                foreach ($normalizedHeaders as $columnIndex => $header) {
                    $isHub = preg_match('/hub|facility|warehouse|intransitto/', $header) === 1;
                    if (! isset($used[$columnIndex]) && ! $isHub && $this->hasAnyPart($header, $parts)) {
                        $found = $columnIndex;
                        break;
                    }
                }
            }
            if ($found !== null) {
                $detected[$role] = $found;
                $used[$found] = true;
            }
        }

        $hubs = [];
        foreach ($normalizedHeaders as $columnIndex => $header) {
            if (! isset($used[$columnIndex]) && preg_match('/hub|facility|warehouse|intransitto/', $header) === 1) {
                $hubs[] = $columnIndex;
                $used[$columnIndex] = true;
            }
        }

        $datePattern = '/date|time|created|updated|scheduled|deliveredat|pickedup|day$/';
        foreach ($normalizedHeaders as $columnIndex => $header) {
            if (isset($used[$columnIndex]) || preg_match($datePattern, $header) !== 1) {
                continue;
            }
            $valid = 0;
            $total = 0;
            foreach (array_slice($rows, 0, 200) as $row) {
                $value = $row['values'][$columnIndex] ?? null;
                if ($value === null || $value === '') {
                    continue;
                }
                $total++;
                if ($value instanceof DateTimeInterface
                    || (is_numeric($value) && (float) $value > 20000 && (float) $value < 80000)
                    || (is_string($value) && preg_match('/\d{1,4}[-\/.]\d{1,2}[-\/.]\d{1,4}/', $value) === 1)) {
                    $valid++;
                }
            }
            if ($total > 0 && ($valid / $total) >= 0.7) {
                $detected['date'] = $columnIndex;
                $used[$columnIndex] = true;
                break;
            }
        }

        return [
            ...$detected,
            'hubs' => $hubs,
            'score' => count($detected) + (count($hubs) > 0 ? 1 : 0),
        ];
    }

    /** @param array<string,mixed> $inspection @param list<array<string,mixed>> $sheets @return \Generator<int,array{sheet:array<string,mixed>,source_row_number:int,values:list<mixed>}> */
    private function spreadsheetRows(string $path, array $sheets): \Generator
    {
        $reader = IOFactory::createReaderForFile($path);
        $reader->setReadDataOnly(false)->setReadEmptyCells(false);
        $worksheetInfo = $reader->listWorksheetInfo($path);
        $filter = new class implements IReadFilter
        {
            public int $startRow = 1;

            public int $endRow = 1;

            public function readCell(string $columnAddress, int $row, string $worksheetName = ''): bool
            {
                return $row >= $this->startRow && $row <= $this->endRow;
            }
        };
        $reader->setReadFilter($filter);
        $chunkSize = max(100, min(1000, (int) config('import_ingestion.xls_read_chunk_rows', 400)));
        foreach ($sheets as $metadata) {
            $info = $worksheetInfo[$metadata['index']] ?? null;
            if (! is_array($info)) {
                throw new RuntimeException('A worksheet in the XLS workbook could not be selected.');
            }
            $sheetName = (string) $metadata['name'];
            $columnCount = count($metadata['headers']);
            $reader->setLoadSheetsOnly([$sheetName]);
            for ($firstRow = (int) $metadata['header_row_number'] + 1; $firstRow <= (int) $info['totalRows']; $firstRow += $chunkSize) {
                $filter->startRow = $firstRow;
                $filter->endRow = min((int) $info['totalRows'], $firstRow + $chunkSize - 1);
                $book = $reader->load($path);
                $worksheet = $book->getSheetByName($sheetName);
                if ($worksheet === null) {
                    $book->disconnectWorksheets();
                    throw new RuntimeException('A worksheet in the XLS workbook could not be loaded.');
                }
                for ($rowIndex = $firstRow; $rowIndex <= $filter->endRow; $rowIndex++) {
                    if ($rowIndex > (int) config('import_ingestion.max_source_row_number', 200000)) {
                        $book->disconnectWorksheets();
                        throw new RuntimeException('The workbook exceeds the supported source row number limit.');
                    }
                    $values = [];
                    for ($columnIndex = 1; $columnIndex <= $columnCount; $columnIndex++) {
                        $cell = $worksheet->getCell([$columnIndex, $rowIndex]);
                        $value = $cell->getValue();
                        if ($cell->getDataType() === 'f') {
                            $value = $cell->getOldCalculatedValue();
                        }
                        $values[] = $value === '' ? null : $value;
                    }
                    if ($this->hasValues($values)) {
                        yield ['sheet' => $metadata, 'source_row_number' => $rowIndex, 'values' => $values];
                    }
                }
                $book->disconnectWorksheets();
                unset($book, $worksheet);
            }
        }
    }

    private function openStreamReader(string $path, string $format): XlsxReader|CsvReader
    {
        if ($format === 'xlsx') {
            $options = new XlsxOptions;
            $options->SHOULD_PRESERVE_EMPTY_ROWS = true;
            $temporaryPath = (string) config('import_ingestion.reader_temp_path', storage_path('app/private/import-work'));
            if (! is_dir($temporaryPath) && ! mkdir($temporaryPath, 0700, true) && ! is_dir($temporaryPath)) {
                throw new RuntimeException('The private workbook reader directory could not be created.');
            }
            $options->setTempFolder($temporaryPath);

            return new XlsxReader($options);
        }

        $options = new CsvOptions;
        $options->SHOULD_PRESERVE_EMPTY_ROWS = true;
        $options->FIELD_DELIMITER = $this->detectDelimiter($path);
        $options->ENCODING = $this->detectEncoding($path);

        return new CsvReader($options);
    }

    private function detectDelimiter(string $path): string
    {
        $scores = [];
        foreach ([',', ';', "\t", '|'] as $delimiter) {
            $stream = fopen($path, 'rb');
            if ($stream === false) {
                return ',';
            }
            $record = fgetcsv($stream, 0, $delimiter, '"', '');
            fclose($stream);
            $scores[$delimiter] = is_array($record) ? count($record) : 0;
        }
        arsort($scores);

        return (string) array_key_first($scores);
    }

    private function detectEncoding(string $path): string
    {
        $head = file_get_contents($path, false, null, 0, 4) ?: '';
        if (str_starts_with($head, "\xFF\xFE\x00\x00")) {
            return EncodingHelper::ENCODING_UTF32_LE;
        }
        if (str_starts_with($head, "\x00\x00\xFE\xFF")) {
            return EncodingHelper::ENCODING_UTF32_BE;
        }
        if (str_starts_with($head, "\xFF\xFE")) {
            return EncodingHelper::ENCODING_UTF16_LE;
        }
        if (str_starts_with($head, "\xFE\xFF")) {
            return EncodingHelper::ENCODING_UTF16_BE;
        }
        if (str_starts_with($head, "\xEF\xBB\xBF") || mb_check_encoding($head, 'UTF-8')) {
            return EncodingHelper::ENCODING_UTF8;
        }

        $sample = file_get_contents($path, false, null, 0, 8192) ?: '';

        return mb_detect_encoding($sample, ['UTF-8', 'Windows-1252', 'ISO-8859-1'], true) ?: EncodingHelper::ENCODING_UTF8;
    }

    private function readXlsxDateSystem(string $path): string
    {
        $zip = new \ZipArchive;
        if ($zip->open($path) !== true) {
            throw new RuntimeException('The XLSX archive could not be opened.');
        }
        try {
            $workbook = $zip->getFromName('xl/workbook.xml');
            if (! is_string($workbook)) {
                throw new RuntimeException('The XLSX workbook metadata is missing.');
            }
            $is1904 = preg_match('/<workbookPr\b[^>]*\bdate1904\s*=\s*["\'](1|true)["\']/i', $workbook) === 1;

            return $is1904 ? '1904' : '1900';
        } finally {
            $zip->close();
        }
    }

    /** @param list<Cell> $cells @return list<mixed> */
    private function openSpoutValues(array $cells, string $dateSystem): array
    {
        $values = [];
        $maxIndex = $cells === [] ? -1 : max(array_keys($cells));
        for ($columnIndex = 0; $columnIndex <= $maxIndex; $columnIndex++) {
            $cell = $cells[$columnIndex] ?? null;
            if ($cell === null) {
                $values[$columnIndex] = null;

                continue;
            }
            $value = $cell instanceof FormulaCell ? $cell->getComputedValue() : $cell->getValue();
            if ($value instanceof DateTimeInterface) {
                $value = $this->excelSerial($value, $dateSystem);
            }
            $values[$columnIndex] = $value === '' ? null : $value;
        }

        return array_values($values);
    }

    /** @return array<int,string> worksheet iterator index to archive member */
    private function xlsxWorksheetTargets(string $path): array
    {
        $zip = new \ZipArchive;
        if ($zip->open($path) !== true) {
            throw new RuntimeException('The XLSX archive could not be opened.');
        }
        try {
            $workbookText = $zip->getFromName('xl/workbook.xml');
            $relationshipsText = $zip->getFromName('xl/_rels/workbook.xml.rels');
            if (! is_string($workbookText) || ! is_string($relationshipsText)) {
                throw new RuntimeException('The XLSX worksheet index is incomplete.');
            }
            $workbook = simplexml_load_string($workbookText, \SimpleXMLElement::class, LIBXML_NONET | LIBXML_COMPACT);
            $relationships = simplexml_load_string($relationshipsText, \SimpleXMLElement::class, LIBXML_NONET | LIBXML_COMPACT);
            if (! $workbook || ! $relationships) {
                throw new RuntimeException('The XLSX worksheet index could not be parsed.');
            }

            $relationshipTargets = [];
            foreach ($relationships->xpath('//*[local-name()="Relationship"]') ?: [] as $relationship) {
                $attributes = $relationship->attributes();
                $relationshipTargets[(string) ($attributes['Id'] ?? '')] = (string) ($attributes['Target'] ?? '');
            }
            $targets = [];
            foreach ($workbook->xpath('//*[local-name()="sheet"]') ?: [] as $sheet) {
                $attributes = $sheet->attributes('http://schemas.openxmlformats.org/officeDocument/2006/relationships');
                $relationshipId = (string) ($attributes['id'] ?? '');
                $target = $relationshipTargets[$relationshipId] ?? '';
                if ($target === '') {
                    throw new RuntimeException('An XLSX worksheet target is missing.');
                }
                if (str_starts_with($target, '/')) {
                    $target = ltrim($target, '/');
                } elseif (! str_starts_with($target, 'xl/')) {
                    $target = 'xl/'.$target;
                }
                $targets[] = str_replace('\\', '/', $target);
            }

            return $targets;
        } finally {
            $zip->close();
        }
    }

    private function excelSerial(DateTimeInterface $value, string $dateSystem): float
    {
        $date = new \DateTimeImmutable($value->format('Y-m-d H:i:s'), new \DateTimeZone('UTC'));
        $epoch = $dateSystem === '1904' ? new \DateTimeImmutable('1904-01-01 00:00:00', new \DateTimeZone('UTC'))
            : new \DateTimeImmutable('1899-12-30 00:00:00', new \DateTimeZone('UTC'));
        $seconds = $date->getTimestamp() - $epoch->getTimestamp();

        return $seconds / 86400;
    }

    private function hasAnyPart(string $value, array $parts): bool
    {
        foreach ($parts as $part) {
            if (str_contains($value, $part)) {
                return true;
            }
        }

        return false;
    }

    private function hasValues(array $values): bool
    {
        foreach ($values as $value) {
            if ($value !== null && $value !== '') {
                return true;
            }
        }

        return false;
    }

    private function trackingValue(mixed $value): ?string
    {
        if (is_int($value)) {
            return (string) $value;
        }
        if (is_float($value) && floor($value) === $value) {
            return sprintf('%.0f', $value);
        }

        return $this->cleanValue($value);
    }

    private function roleValue(array $values, int $index): ?string
    {
        return $index < 0 ? null : $this->cleanValue($values[$index] ?? null);
    }

    private function cleanValue(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if ($value instanceof DateTimeInterface) {
            $value = $value->format('Y-m-d');
        }
        $string = trim(preg_replace('/\s+/u', ' ', (string) $value) ?? (string) $value);
        if (in_array(mb_strtolower($string), ['', 'nan', 'null', 'undefined', 'n/a', 'na', 'none', '-', '--'], true)) {
            return null;
        }

        return $string;
    }

    private function parseFloat(mixed $value): ?float
    {
        $string = str_replace(',', '', (string) ($value ?? ''));
        if (preg_match('/\A[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/', $string, $match) !== 1) {
            return null;
        }

        return (float) $match[0];
    }
}
