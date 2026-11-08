<?php

namespace App\Reports;

use OpenSpout\Reader\XLSX\Reader;
use RuntimeException;

class LoadingManifest
{
    public function cars(array $rows): array
    {
        $starts = [];
        foreach ($rows[0] ?? [] as $column => $value) {
            if (preg_match('/\b(?:car|alex)\s*(\d+)\b/i', $value, $match)) {
                $starts[$column] = 'CAR '.(int) $match[1];
            } elseif (preg_match('/^\s*car\s*$/i', $value) && preg_match('/^\s*(\d+)\s*$/', $rows[0][$column + 1] ?? '', $match)) {
                $starts[$column] = 'CAR '.(int) $match[1];
            }
        }
        $columns = array_keys($starts);
        $cars = [];
        foreach ($columns as $index => $start) {
            $end = $columns[$index + 1] ?? max(array_map('count', $rows));
            $meta = array_values(array_filter(array_map('trim', array_slice($rows[1] ?? [], $start, $end - $start)), fn ($v) => $v !== ''));
            $master = null;
            foreach ($meta as $value) {
                if (preg_match('/master\s*seal/i', $value)) {
                    $master = $meta[count($meta) - 1] ?? null;
                    if ($master === $value) {
                        $master = null;
                    }
                    break;
                }
            }
            $header = 2;
            $sealColumns = [];
            foreach ([2, 3] as $candidate) {
                for ($col = $start; $col < $end; $col++) {
                    if (preg_match('/^seal(?:\s*(?:number|no))?$/i', trim($rows[$candidate][$col] ?? ''))) {
                        $sealColumns[] = $col;
                    }
                }
                if ($sealColumns !== []) {
                    $header = $candidate;
                    break;
                }
            }
            $seals = [];
            foreach (array_slice($rows, $header + 1, null, true) as $rowIndex => $row) {
                foreach ($sealColumns as $col) {
                    $seal = trim($row[$col] ?? '');
                    if ($seal !== '' && ! preg_match('/^(seal|number|total|n)$/i', $seal)) {
                        $seals[] = ['seal' => $seal, 'source_row' => $rowIndex + 1];
                    }
                }
            }
            $cars[] = ['key' => $starts[$start], 'label' => trim($rows[0][$start]), 'master_seal' => $master, 'details' => array_values(array_filter($meta, fn ($value) => ! preg_match('/master\s*seal/i', $value) && $value !== $master)), 'seals' => $seals];
        }

        return array_map(function ($car) {
            $car['fingerprint'] = hash('sha256', json_encode($car, JSON_THROW_ON_ERROR));

            return $car;
        }, $cars);
    }

    public function read(string $path): array
    {
        $reader = new Reader;
        $reader->open($path);
        $records = [];
        $sheetCount = 0;
        try {
            foreach ($reader->getSheetIterator() as $sheet) {
                if (++$sheetCount > 20) {
                    throw new RuntimeException('At most 20 worksheets are supported.');
                }
                $headers = null;
                foreach ($sheet->getRowIterator() as $rowIndex => $row) {
                    $values = array_map(static fn ($cell): string => is_scalar($cell->getValue()) ? trim((string) $cell->getValue()) : '', $row->getCells());
                    if (! array_filter($values, fn ($value) => $value !== '')) {
                        continue;
                    }
                    if ($headers === null) {
                        $keys = array_map(fn ($value) => preg_replace('/[^a-z0-9]/', '', strtolower($value)), $values);
                        if (in_array('mastersealnumber', $keys, true) && in_array('sealnumber', $keys, true) && in_array('trackingnumber', $keys, true)) {
                            $headers = array_flip($keys);
                        } elseif ($rowIndex > 20) {
                            break;
                        }

                        continue;
                    }
                    $read = fn ($name) => $values[$headers[$name] ?? -1] ?? '';
                    $records[] = ['master_seal' => $read('mastersealnumber'), 'seal' => $read('sealnumber'), 'tracking' => $read('trackingnumber'), 'seal_type' => $read('sealtype'), 'source_hub' => $read('sourcehubname'), 'destination_hub' => $read('destinationhubname'), 'status' => $read('status'), 'source_sheet' => $sheet->getName(), 'source_row' => $rowIndex];
                    if (count($records) > 100000) {
                        throw new RuntimeException('At most 100,000 shipment rows are supported.');
                    }
                }
            }
        } finally {
            $reader->close();
        }
        if ($records === []) {
            throw new RuntimeException('No manifest rows found. Required columns: Master Seal Number, Seal Number, Tracking Number.');
        }

        return $records;
    }

    public function filenameDates(string $filename): array
    {
        if (preg_match('/(?<!\d)(\d{4})[-_](\d{1,2})[-_](\d{1,2})(?!\d)/', $filename, $iso)
            && checkdate((int) $iso[2], (int) $iso[3], (int) $iso[1])) {
            return [sprintf('%04d-%02d-%02d', $iso[1], $iso[2], $iso[3])];
        }
        if (! preg_match('/(?<!\d)(\d{1,2})[-_](\d{1,2})[-_](\d{4})(?!\d)/', $filename, $match)) {
            return [];
        }
        $dates = [];
        foreach ([[(int) $match[1], (int) $match[2]], [(int) $match[2], (int) $match[1]]] as [$month, $day]) {
            if (checkdate($month, $day, (int) $match[3])) {
                $dates[] = sprintf('%04d-%02d-%02d', $match[3], $month, $day);
            }
        }

        return array_values(array_unique($dates));
    }

    public function compare(array $records, array $car, array $cars, string $date, string $filename): array
    {
        $norm = static fn ($value): string => strtoupper(trim((string) $value));
        $masters = array_values(array_unique(array_filter(array_column($records, 'master_seal'), fn ($v) => $v !== '')));
        $masterMatches = $car['master_seal'] && count($masters) === 1 && $norm($masters[0]) === $norm($car['master_seal'])
            && count(array_filter($records, fn ($record) => $norm($record['master_seal']) === $norm($car['master_seal']))) === count($records);
        $dates = $this->filenameDates($filename);
        $dateMatches = $dates === [] || in_array($date, $dates, true);
        $fileCar = preg_match('/\bcar[\s_-]*(\d+)\b/i', $filename, $match) ? 'CAR '.(int) $match[1] : null;
        $carMatches = $fileCar === null || $fileCar === $car['key'];
        $seals = [];
        foreach ($car['seals'] as $expected) {
            $key = $norm($expected['seal']);
            $seals[$key] ??= ['seal' => $expected['seal'], 'in_cars' => true, 'sheet_rows' => [], 'file_rows' => 0, 'unique_trackings' => [], 'duplicate_rows' => 0, 'other_cars' => []];
            $seals[$key]['sheet_rows'][] = $expected['source_row'];
        }
        $issues = [];
        $trackingSeals = [];
        foreach ($records as $index => $record) {
            foreach (['master_seal', 'seal', 'tracking'] as $field) {
                if ($record[$field] === '') {
                    $issues[] = ['row' => $index + 1, 'sheet' => $record['source_sheet'], 'source_row' => $record['source_row'], 'issue' => 'Missing '.$field];
                }
            }
            if ($record['seal'] === '') {
                continue;
            }
            $key = $norm($record['seal']);
            $seals[$key] ??= ['seal' => $record['seal'], 'in_cars' => false, 'sheet_rows' => [], 'file_rows' => 0, 'unique_trackings' => [], 'duplicate_rows' => 0, 'other_cars' => []];
            $seals[$key]['file_rows']++;
            if ($record['tracking'] !== '') {
                $tracking = $norm($record['tracking']);
                if (isset($seals[$key]['unique_trackings'][$tracking])) {
                    $seals[$key]['duplicate_rows']++;
                }
                $seals[$key]['unique_trackings'][$tracking] = true;
                $trackingSeals[$tracking][$key] = true;
            }
        }
        foreach ($trackingSeals as $tracking => $inSeals) {
            if (count($inSeals) > 1) {
                $issues[] = ['row' => null, 'sheet' => '', 'source_row' => null, 'issue' => 'Tracking '.$tracking.' appears in multiple seals: '.implode(', ', array_keys($inSeals))];
            }
        }
        foreach ($seals as &$seal) {
            $seal['unique_trackings'] = count($seal['unique_trackings']);
            $seal['result'] = $seal['in_cars'] ? ($seal['file_rows'] ? 'matched' : 'missing_from_file') : 'extra_in_file';
            foreach ($cars as $other) {
                if ($other['key'] !== $car['key'] && in_array($norm($seal['seal']), array_map($norm, array_column($other['seals'], 'seal')), true)) {
                    $seal['other_cars'][] = $other['key'];
                }
            }
        }
        unset($seal);

        return [
            'verified_identity' => (bool) ($masterMatches && $dateMatches && $carMatches),
            'checks' => ['master_seal' => ['match' => (bool) $masterMatches, 'cars' => $car['master_seal'], 'file' => $masters], 'date' => ['match' => $dateMatches, 'selected' => $date, 'filename_candidates' => $dates, 'basis' => $dates === [] ? 'user_declared' : 'filename_and_user_confirmation'], 'car' => ['match' => $carMatches, 'selected' => $car['key'], 'filename' => $fileCar, 'basis' => $fileCar ? 'filename' : 'user_selected_upload']],
            'seals' => array_values($seals), 'records' => $records, 'issues' => $issues,
            'totals' => ['file_rows' => count($records), 'expected_seals' => count(array_filter($seals, fn ($s) => $s['in_cars'])), 'matched' => count(array_filter($seals, fn ($s) => $s['result'] === 'matched')), 'missing_from_file' => count(array_filter($seals, fn ($s) => $s['result'] === 'missing_from_file')), 'extra_in_file' => count(array_filter($seals, fn ($s) => $s['result'] === 'extra_in_file')), 'duplicate_rows' => array_sum(array_column($seals, 'duplicate_rows'))],
        ];
    }
}
