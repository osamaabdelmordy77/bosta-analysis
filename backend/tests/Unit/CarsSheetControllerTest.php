<?php

namespace Tests\Unit;

use App\Http\Controllers\CarsSheetController;
use App\Reports\CarsWorkbookSource;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use Tests\TestCase;

class CarsSheetControllerTest extends TestCase
{
    private function fakeWorkbook(): void
    {
        $book = new Spreadsheet;
        $book->getActiveSheet()->setTitle('palet')->fromArray([['Wrong source', 'DO NOT USE']]);
        $book->createSheet()->setTitle('3-11-2026')->fromArray([['car 1', '', 'car 2'], ['master seal', 'MASTER-DAY-3', ''], ['seal, note', '', '3']]);
        $book->createSheet()->setTitle('4-11-2026')->fromArray([['car 1'], ['master seal', 'MASTER-DAY-4'], ['seal', 'Number'], ['ONLY-DAY-4', '1']]);
        ob_start();
        (new Xlsx($book))->save('php://output');
        $bytes = ob_get_clean();
        $book->disconnectWorksheets();
        Http::fake(['docs.google.com/*' => Http::response($bytes, 200)]);
    }

    public function test_it_reads_only_the_selected_dated_tab_and_preserves_empty_cells(): void
    {
        $this->fakeWorkbook();
        $response = app(CarsSheetController::class)->show(Request::create('/cars?date=2026-11-03'));
        $data = $response->getData(true)['data'];
        self::assertSame(200, $response->status());
        self::assertSame('3-11-2026', $data['sheet_name']);
        self::assertSame('2026-11-03', $data['sheet_date']);
        self::assertSame(['car 1', '', 'car 2'], $data['rows'][0]);
        self::assertSame(['seal, note', '', '3'], $data['rows'][2]);
        self::assertStringNotContainsString('ONLY-DAY-4', json_encode($data['rows']));
        $next = app(CarsSheetController::class)->show(Request::create('/cars?date=2026-11-04'))->getData(true)['data'];
        self::assertSame('MASTER-DAY-4', $next['rows'][1][1]);
        self::assertStringNotContainsString('MASTER-DAY-3', json_encode($next['rows']));
    }

    public function test_missing_day_never_falls_back_to_palet_or_another_day(): void
    {
        $this->fakeWorkbook();
        $data = app(CarsSheetController::class)->show(Request::create('/cars?date=2026-11-05'))->getData(true)['data'];
        self::assertNull($data['sheet_name']);
        self::assertSame([], $data['rows']);
        self::assertCount(3, $data['available_sheets']);
        $wrongTab = app(CarsSheetController::class)->show(Request::create('/cars?date=2026-11-03&sheet_name=4-11-2026'))->getData(true)['data'];
        self::assertNull($wrongTab['sheet_name']);
        self::assertSame([], $wrongTab['rows']);
    }

    public function test_tab_dates_are_day_month_year_with_no_guessed_year(): void
    {
        $source = new CarsWorkbookSource;
        self::assertSame('2026-11-08', $source->sheetDate('8-11-2026'));
        self::assertSame('2026-10-20', $source->sheetDate('20- 10-2026'));
        self::assertSame('2026-10-16', $source->sheetDate('fri 16-10-2026'));
        self::assertNull($source->sheetDate('fri 2-10'));
        self::assertNull($source->sheetDate('31-2-2026'));
        self::assertNull($source->sheetDate('palet'));
    }

    public function test_it_reports_an_unavailable_sheet(): void
    {
        Http::fake(['docs.google.com/*' => Http::response('Forbidden', 403)]);

        $response = app(CarsSheetController::class)->show();

        $this->assertSame(502, $response->status());
    }
}
