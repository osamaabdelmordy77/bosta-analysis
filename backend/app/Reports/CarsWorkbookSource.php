<?php

namespace App\Reports;

use Illuminate\Support\Facades\Http;
use OpenSpout\Reader\XLSX\Reader;
use RuntimeException;

class CarsWorkbookSource
{
    public function sheetDate(string $name): ?string
    {
        if (preg_match('/(?<!\d)(\d{4})\s*[-\/]\s*(\d{1,2})\s*[-\/]\s*(\d{1,2})(?!\d)/', $name, $parts)) {
            [$year, $month, $day] = [(int) $parts[1], (int) $parts[2], (int) $parts[3]];
        } elseif (preg_match('/(?<!\d)(\d{1,2})\s*[-\/]\s*(\d{1,2})\s*[-\/]\s*(\d{4})(?!\d)/', $name, $parts)) {
            [$year, $month, $day] = [(int) $parts[3], (int) $parts[2], (int) $parts[1]];
        } else {
            return null;
        }

        return checkdate($month, $day, $year) ? sprintf('%04d-%02d-%02d', $year, $month, $day) : null;
    }

    public function snapshot(string $date, ?string $sheetName = null): array
    {
        try {
            $response = Http::timeout(30)->get('https://docs.google.com/spreadsheets/d/1q1At_nZgirwmRDmS7scB_ej8kyNLJjnrb6Xn7TFuq_Q/export?format=xlsx');
        } catch (\Throwable) {
            throw new RuntimeException('Could not reach the linked Google Sheet.');
        }
        if (! $response->successful() || ! str_starts_with($response->body(), 'PK')) {
            throw new RuntimeException('Google Sheets did not return an XLSX workbook. Check its sharing settings.');
        }
        if (strlen($response->body()) > 25_000_000) {
            throw new RuntimeException('The linked CARS workbook exceeds the supported size.');
        }
        $path = tempnam(sys_get_temp_dir(), 'cars-workbook-');
        $reader = new Reader;
        try {
            file_put_contents($path, $response->body());
            $reader->open($path);
            $available = [];
            foreach ($reader->getSheetIterator() as $sheet) {
                $available[] = ['name' => $sheet->getName(), 'date' => $this->sheetDate($sheet->getName())];
            }
            $matches = array_values(array_filter($available, fn ($sheet) => $sheet['date'] === $date && ($sheetName === null || $sheetName === $sheet['name'])));
            $selected = count($matches) === 1 ? $matches[0]['name'] : null;
            $rows = [];
            if ($selected !== null) {
                foreach ($reader->getSheetIterator() as $sheet) {
                    if ($sheet->getName() !== $selected) {
                        continue;
                    }
                    foreach ($sheet->getRowIterator() as $row) {
                        $rows[] = array_map(static fn ($cell): string => is_scalar($cell->getValue()) ? (string) $cell->getValue() : '', $row->getCells());
                        if (count($rows) > 5000) {
                            throw new RuntimeException('This CARS tab has too many rows.');
                        }
                    }
                    break;
                }
            }

            return ['rows' => $rows, 'source_url' => 'https://docs.google.com/spreadsheets/d/1q1At_nZgirwmRDmS7scB_ej8kyNLJjnrb6Xn7TFuq_Q/edit'.($selected ? '#range='.rawurlencode("'".$selected."'!A1") : ''), 'fetched_at' => now()->toIso8601String(), 'sheet_name' => $selected, 'sheet_date' => $selected ? $date : null, 'requested_date' => $date, 'selection_required' => count($matches) > 1, 'available_sheets' => $available];
        } finally {
            $reader->close();
            unlink($path);
        }
    }
}
