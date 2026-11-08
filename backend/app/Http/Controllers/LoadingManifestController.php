<?php

namespace App\Http\Controllers;

use App\Reports\LoadingManifest;
use App\Tenancy\OrganizationContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use RuntimeException;

class LoadingManifestController extends Controller
{
    public function cars(Request $request, LoadingManifest $manifest): JsonResponse
    {
        $request->validate(['date' => ['required', 'date_format:Y-m-d']]);
        $response = app(CarsSheetController::class)->show($request);
        if ($response->status() !== 200) {
            return $response;
        }
        $snapshot = $response->getData(true)['data'];

        return $this->success(['snapshot' => $snapshot, 'cars' => $manifest->cars($snapshot['rows'])]);
    }

    public function index(Request $request, OrganizationContext $context): JsonResponse
    {
        $date = $request->validate(['date' => ['required', 'date_format:Y-m-d']])['date'];
        $disk = Storage::disk('manifests_private');
        $items = [];
        foreach ($disk->files($context->requireId().'/'.$date) as $path) {
            if (! str_ends_with($path, '.json')) {
                continue;
            }
            $data = json_decode($disk->get($path), true, 512, JSON_THROW_ON_ERROR);
            $summary = array_intersect_key($data, array_flip(['id', 'date', 'car', 'vehicle_number', 'filename', 'created_at', 'verified_identity', 'snapshot_date_basis', 'totals']));
            $summary['verified_identity'] = ($data['verified_identity'] ?? false) && ($data['cars_snapshot']['sheet_date'] ?? null) === $data['date'];
            $items[] = $summary;
        }
        usort($items, fn ($a, $b) => strcmp($b['id'], $a['id']));

        return $this->success(['uploads' => $items]);
    }

    public function show(string $organization, string $date, string $id, OrganizationContext $context): JsonResponse
    {
        $path = $context->requireId().'/'.$date.'/'.$id.'.json';
        $disk = Storage::disk('manifests_private');
        abort_unless($disk->exists($path), 404);

        return $this->success(json_decode($disk->get($path), true, 512, JSON_THROW_ON_ERROR));
    }

    public function store(Request $request, OrganizationContext $context, LoadingManifest $manifest): JsonResponse
    {
        $input = $request->validate([
            'file' => ['required', 'file', 'mimes:xlsx', 'max:10240'],
            'date' => ['required', 'date_format:Y-m-d'],
            'car' => ['required', 'string', 'regex:/^CAR \d+$/'],
            'vehicle_number' => ['required', 'string', 'max:80'],
            'confirm_snapshot_date' => ['accepted'],
            'snapshot_fetched_at' => ['required', 'date'],
            'car_fingerprint' => ['required', 'string', 'size:64'],
            'expected_master_seal' => ['nullable', 'string', 'max:200'],
            'source_sheet' => ['required', 'string', 'max:150'],
        ]);
        $response = app(CarsSheetController::class)->show(Request::create('/cars', 'GET', ['date' => $input['date'], 'sheet_name' => $input['source_sheet']]));
        if ($response->status() !== 200) {
            return $response;
        }
        $snapshot = $response->getData(true)['data'];
        if ($snapshot['sheet_date'] !== $input['date'] || $snapshot['sheet_name'] !== $input['source_sheet']) {
            throw ValidationException::withMessages(['date' => 'No matching dated CARS tab. A different day cannot be used for this comparison.']);
        }
        $cars = $manifest->cars($snapshot['rows']);
        $car = collect($cars)->firstWhere('key', $input['car']);
        if (! $car) {
            throw ValidationException::withMessages(['car' => 'This car no longer exists in CARS. Refresh the sheet.']);
        }
        if (! hash_equals($car['fingerprint'], $input['car_fingerprint'])) {
            throw ValidationException::withMessages(['car' => 'The CARS entries for this car changed. Refresh and confirm the current sheet before uploading.']);
        }
        if (trim((string) ($car['master_seal'] ?? '')) !== trim((string) ($input['expected_master_seal'] ?? ''))) {
            throw ValidationException::withMessages(['car' => 'CARS Master Seal changed since you selected this car. Refresh and confirm again.']);
        }
        $filename = $request->file('file')->getClientOriginalName();
        try {
            $records = $manifest->read($request->file('file')->getRealPath());
        } catch (\Throwable $exception) {
            throw ValidationException::withMessages(['file' => $exception instanceof RuntimeException ? $exception->getMessage() : 'Could not read this XLSX manifest.']);
        }
        $report = $manifest->compare($records, $car, $cars, $input['date'], $filename);
        $id = (string) Str::ulid();
        $report = ['id' => $id, 'date' => $input['date'], 'car' => $car['key'], 'vehicle_number' => trim($input['vehicle_number']), 'filename' => $filename, 'created_at' => now()->toIso8601String(), 'uploaded_by' => $context->userId(), 'sha256' => hash_file('sha256', $request->file('file')->getRealPath()), 'cars_snapshot' => $snapshot, 'snapshot_date_basis' => 'dated_sheet_tab', 'selected_car' => $car, ...$report];
        $disk = Storage::disk('manifests_private');
        $base = $context->requireId().'/'.$input['date'].'/'.$id;
        $stream = fopen($request->file('file')->getRealPath(), 'rb');
        try {
            $disk->put($base.'.xlsx', $stream);
            $disk->put($base.'.pending', json_encode($report, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
            $disk->move($base.'.pending', $base.'.json');
        } catch (\Throwable $exception) {
            $disk->delete([$base.'.xlsx', $base.'.json', $base.'.pending']);
            throw $exception;
        } finally {
            fclose($stream);
        }

        return $this->success($report, 201);
    }
}
