<?php

namespace Tests\Unit;

use App\Http\Controllers\LoadingManifestController;
use App\Reports\LoadingManifest;
use App\Tenancy\OrganizationContext;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

class LoadingManifestTest extends TestCase
{
    private function grid(): array
    {
        return [['CAR 1', '', '', '', 'CAR 2', ''], ['master seal', 'Alex 1', 'MASTER1', '', 'master seal', 'MASTER2'], ['seal', 'seal', 'Number', '', 'seal', 'Number'], ['S1', 'S2', '1', '', 'S3', '1'], ['S1', '', '2', '', '', '']];
    }

    private function record(string $seal, string $tracking, string $master = 'MASTER1'): array
    {
        return ['master_seal' => $master, 'seal' => $seal, 'tracking' => $tracking, 'seal_type' => 'Normal', 'source_hub' => 'Source', 'destination_hub' => 'Destination', 'status' => 'Received', 'source_sheet' => 'Master Seal', 'source_row' => 2];
    }

    public function test_cars_reads_both_seal_columns_and_never_counts_number_as_shipments(): void
    {
        $cars = (new LoadingManifest)->cars($this->grid());
        self::assertSame('CAR 1', $cars[0]['key']);
        self::assertSame('MASTER1', $cars[0]['master_seal']);
        self::assertSame(['S1', 'S2', 'S1'], array_column($cars[0]['seals'], 'seal'));
        self::assertSame(['S3'], array_column($cars[1]['seals'], 'seal'));
        self::assertNotEmpty($cars[0]['fingerprint']);
        $daily = $this->grid();
        $daily[0] = ['ALEX1', '1', '', '', 'car', '2'];
        self::assertSame(['CAR 1', 'CAR 2'], array_column((new LoadingManifest)->cars($daily), 'key'));
    }

    public function test_comparison_reconciles_missing_extra_duplicate_and_cross_car_seals(): void
    {
        $service = new LoadingManifest;
        $cars = $service->cars($this->grid());
        $result = $service->compare([$this->record('S1', '000123'), $this->record('S1', '000123'), $this->record('S3', '000123')], $cars[0], $cars, '2026-11-03', 'Master Seal Export - 11-03-2026.xlsx');
        self::assertTrue($result['verified_identity']);
        self::assertSame(1, $result['totals']['matched']);
        self::assertSame(1, $result['totals']['missing_from_file']);
        self::assertSame(1, $result['totals']['extra_in_file']);
        self::assertSame(1, $result['totals']['duplicate_rows']);
        self::assertSame(2, $result['totals']['expected_seals']);
        self::assertSame(['CAR 2'], $result['seals'][2]['other_cars']);
        self::assertCount(1, $result['issues']);
        self::assertSame('000123', $result['records'][0]['tracking']);
        self::assertSame(['2026-11-03', '2026-03-11'], $result['checks']['date']['filename_candidates']);
        self::assertSame(['2026-11-03'], $service->filenameDates('CAR 1 - 2026-11-03.xlsx'));
    }

    public function test_wrong_master_date_or_car_never_passes_identity_checks(): void
    {
        $service = new LoadingManifest;
        $cars = $service->cars($this->grid());
        $result = $service->compare([$this->record('S1', '1', 'WRONG')], $cars[0], $cars, '2026-11-08', 'CAR 2 - 11-03-2026.xlsx');
        self::assertFalse($result['verified_identity']);
        self::assertFalse($result['checks']['master_seal']['match']);
        self::assertFalse($result['checks']['date']['match']);
        self::assertFalse($result['checks']['car']['match']);
        $missing = $service->compare([$this->record('', '')], $cars[0], $cars, '2026-11-03', 'manifest.xlsx');
        self::assertCount(2, $missing['issues']);
    }

    public function test_upload_is_private_date_scoped_reopenable_and_does_not_overwrite_history(): void
    {
        Storage::fake('manifests_private');
        $carsBook = new Spreadsheet;
        $carsBook->getActiveSheet()->setTitle('palet')->fromArray([['Wrong tab']]);
        $carsBook->createSheet()->setTitle('3-11-2026')->fromArray($this->grid());
        $carsBook->createSheet()->setTitle('4-11-2026')->fromArray([['CAR 1'], ['master seal', 'OTHER-DAY-MASTER'], ['seal', 'Number'], ['OTHER-DAY-SEAL', '1']]);
        ob_start();
        (new Xlsx($carsBook))->save('php://output');
        $bytes = ob_get_clean();
        $carsBook->disconnectWorksheets();
        Http::fake(['docs.google.com/*' => Http::response($bytes, 200)]);
        $service = new LoadingManifest;
        $context = new OrganizationContext;
        $context->set('org-a', 1, 1);
        $controller = app(LoadingManifestController::class);
        $car = $controller->cars(Request::create('/cars?date=2026-11-03'), $service)->getData(true)['data']['cars'][0];
        $book = new Spreadsheet;
        $book->getActiveSheet()->fromArray([
            ['Master Seal Number', 'Seal Number', 'Seal Type', 'Tracking Number', 'Source Hub Name', 'Destination Hub Name', 'Status'],
            ['MASTER1', 'S1', 'Normal', '000123', 'Source', 'Destination', 'Received'],
        ]);
        $path = tempnam(sys_get_temp_dir(), 'manifest-test-');
        try {
            (new Xlsx($book))->save($path);
            $input = ['date' => '2026-11-03', 'source_sheet' => '3-11-2026', 'car' => 'CAR 1', 'vehicle_number' => 'ABC 123', 'confirm_snapshot_date' => '1', 'snapshot_fetched_at' => now()->toIso8601String(), 'expected_master_seal' => 'MASTER1', 'car_fingerprint' => $car['fingerprint']];
            $request = Request::create('/manifest', 'POST', $input, [], ['file' => new UploadedFile($path, 'Master Seal Export - 11-03-2026.xlsx', null, null, true)]);
            $first = $controller->store($request, $context, $service);
            self::assertSame(201, $first->status());
            $report = $first->getData(true)['data'];
            self::assertTrue($report['verified_identity']);
            self::assertSame('3-11-2026', $report['cars_snapshot']['sheet_name']);
            self::assertSame('dated_sheet_tab', $report['snapshot_date_basis']);
            self::assertSame('000123', $report['records'][0]['tracking']);
            Storage::disk('manifests_private')->assertExists('org-a/2026-11-03/'.$report['id'].'.xlsx');
            self::assertSame($report, $controller->show('org-a', '2026-11-03', $report['id'], $context)->getData(true)['data']);
            $second = $controller->store($request, $context, $service)->getData(true)['data'];
            self::assertNotSame($first->getData(true)['data']['id'], $second['id']);
            $index = $controller->index(Request::create('/manifest?date=2026-11-03'), $context)->getData(true)['data']['uploads'];
            self::assertCount(2, $index);
            self::assertArrayNotHasKey('records', $index[0]);
            self::assertCount(0, $controller->index(Request::create('/manifest?date=2026-11-04'), $context)->getData(true)['data']['uploads']);
            $context->set('org-b', 2, 1);
            self::assertCount(0, $controller->index(Request::create('/manifest?date=2026-11-03'), $context)->getData(true)['data']['uploads']);
            try {
                $controller->show('org-b', '2026-11-03', $report['id'], $context);
                self::fail('Cross-organization access must be denied.');
            } catch (HttpException $exception) {
                self::assertSame(404, $exception->getStatusCode());
            }
            $context->set('org-a', 1, 1);
            $request->merge(['date' => '2026-11-04']);
            try {
                $controller->store($request, $context, $service);
                self::fail('A CAR from another dated tab cannot be reused.');
            } catch (ValidationException $exception) {
                self::assertArrayHasKey('date', $exception->errors());
            }
            $request->merge(['date' => '2026-11-03']);
            $request->merge(['car_fingerprint' => str_repeat('0', 64)]);
            try {
                $controller->store($request, $context, $service);
                self::fail('Changed CARS must require a new confirmation.');
            } catch (ValidationException $exception) {
                self::assertArrayHasKey('car', $exception->errors());
            }
        } finally {
            $book->disconnectWorksheets();
            unlink($path);
        }
    }
}
