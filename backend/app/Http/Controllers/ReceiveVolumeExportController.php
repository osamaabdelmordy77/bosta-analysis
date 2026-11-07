<?php

namespace App\Http\Controllers;

use App\Reports\ReceiveVolumeWorkbook;
use App\Security\AuthorizationService;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ReceiveVolumeExportController extends Controller
{
    public function __invoke(Request $request, AuthorizationService $authorization, ReceiveVolumeWorkbook $report): StreamedResponse
    {
        abort_unless(
            $authorization->hasPermission($request->user(), 'imports.manage')
                || $authorization->hasPermission($request->user(), 'shipments.view_all')
                || $authorization->hasPermission($request->user(), 'shipments.view_assigned'),
            403,
        );
        // Only aggregates already visible in the user's filtered view are exported.
        // No database records are read, changed, or accepted as authoritative data.
        $data = $request->validate([
            'rows' => ['required', 'array', 'min:1', 'max:20000'],
            'rows.*' => ['required', 'array:date,weekday,week,window,shipments,items'],
            'rows.*.date' => ['present', 'nullable', 'date_format:Y-m-d'],
            'rows.*.week' => ['present', 'nullable', 'date_format:Y-m-d'],
            'rows.*.weekday' => ['present', 'nullable', Rule::in(ReceiveVolumeWorkbook::WEEKDAYS)],
            'rows.*.window' => ['required', Rule::in(ReceiveVolumeWorkbook::WINDOWS)],
            'rows.*.shipments' => ['required', 'integer', 'min:1', 'max:1000000000'],
            'rows.*.items' => ['required', 'numeric', 'min:0', 'max:1000000000000'],
        ]);

        return response()->streamDownload(function () use ($report, $data): void {
            $workbook = $report->build($data['rows']);
            try {
                (new Xlsx($workbook))->save('php://output');
            } finally {
                $workbook->disconnectWorksheets();
            }
        }, 'receive-volume-comparisons-pivots.xlsx', [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Cache-Control' => 'private, no-store',
        ]);
    }
}
