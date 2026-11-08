<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Http;

class CarsSheetController extends Controller
{
    private const SOURCE_URL = 'https://docs.google.com/spreadsheets/d/1q1At_nZgirwmRDmS7scB_ej8kyNLJjnrb6Xn7TFuq_Q/export?format=csv&gid=0';

    public function show(): JsonResponse
    {
        try {
            $response = Http::timeout(20)->get(self::SOURCE_URL);
        } catch (\Throwable $exception) {
            return response()->json(['message' => 'Could not reach the linked Google Sheet.'], 502);
        }

        if (! $response->successful()) {
            return response()->json(['message' => 'The linked Google Sheet is unavailable. Check its sharing settings.'], 502);
        }

        if (! str_contains(strtolower((string) $response->header('Content-Type')), 'text/csv')) {
            return response()->json(['message' => 'Google Sheets did not return CSV data. Check the sheet access settings.'], 502);
        }

        $body = $response->body();
        if (strlen($body) > 5_000_000) {
            return response()->json(['message' => 'The linked Google Sheet exceeds the supported size.'], 502);
        }

        $stream = fopen('php://temp', 'w+');
        if ($stream === false) {
            return response()->json(['message' => 'Could not read the linked Google Sheet.'], 502);
        }

        fwrite($stream, preg_replace('/^\xEF\xBB\xBF/', '', $body));
        rewind($stream);
        $rows = [];
        while (($row = fgetcsv($stream, 0, ',', '"', '')) !== false) {
            $rows[] = array_map(static fn ($value): string => (string) ($value ?? ''), $row);
            if (count($rows) > 5000) {
                fclose($stream);
                return response()->json(['message' => 'The linked Google Sheet has too many rows to display.'], 502);
            }
        }
        fclose($stream);

        return $this->success([
            'rows' => $rows,
            'source_url' => 'https://docs.google.com/spreadsheets/d/1q1At_nZgirwmRDmS7scB_ej8kyNLJjnrb6Xn7TFuq_Q/edit?gid=0',
            'fetched_at' => now()->toIso8601String(),
        ]);
    }
}
