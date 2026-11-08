<?php

namespace Tests\Unit;

use App\Http\Controllers\CarsSheetController;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class CarsSheetControllerTest extends TestCase
{
    public function test_it_preserves_all_csv_cells_including_empty_cells_and_quoted_commas(): void
    {
        Http::fake(['docs.google.com/*' => Http::response("car 1,,car 2\r\nmaster seal,S134011,\r\n\"seal, note\",,3\r\n", 200, ['Content-Type' => 'text/csv; charset=utf-8'])]);

        $response = app(CarsSheetController::class)->show();

        $this->assertSame(200, $response->status());
        $this->assertSame([
            ['car 1', '', 'car 2'],
            ['master seal', 'S134011', ''],
            ['seal, note', '', '3'],
        ], $response->getData(true)['data']['rows']);
    }

    public function test_it_reports_an_unavailable_sheet(): void
    {
        Http::fake(['docs.google.com/*' => Http::response('Forbidden', 403)]);

        $response = app(CarsSheetController::class)->show();

        $this->assertSame(502, $response->status());
    }
}
