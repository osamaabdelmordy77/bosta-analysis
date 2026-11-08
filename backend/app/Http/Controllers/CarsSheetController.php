<?php

namespace App\Http\Controllers;

use App\Reports\CarsWorkbookSource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;

class CarsSheetController extends Controller
{
    public function show(?Request $request = null): JsonResponse
    {
        $request ??= request();
        $input = $request->validate(['date' => ['nullable', 'date_format:Y-m-d'], 'sheet_name' => ['nullable', 'string', 'max:150']]);
        $date = $input['date'] ?? now('Africa/Cairo')->toDateString();
        try {
            return $this->success(app(CarsWorkbookSource::class)->snapshot($date, $input['sheet_name'] ?? null));
        } catch (RuntimeException $exception) {
            return response()->json(['message' => $exception->getMessage()], 502);
        }
    }
}
