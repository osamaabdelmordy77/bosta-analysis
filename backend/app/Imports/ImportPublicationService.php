<?php

namespace App\Imports;

use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\HttpException;

class ImportPublicationService
{
    /** @return array{file_id:string,run_id:string,revision:int,counts:array<string,int>} */
    public function publish(string $organizationId, string $fileId, string $runId, ?callable $metricsFactory = null): array
    {
        return DB::transaction(function () use ($organizationId, $fileId, $runId, $metricsFactory): array {
            $file = DB::table('import_files')->where('id', $fileId)->where('organization_id', $organizationId)
                ->lockForUpdate()->first();
            abort_unless($file, 404, 'Import file not found.');

            $run = DB::table('import_runs')->where('id', $runId)->where('import_file_id', $fileId)
                ->where('organization_id', $organizationId)->lockForUpdate()->first();
            abort_unless($run && $run->status === 'importing', 409, 'This import run cannot be published.');

            $newerPublishedExists = DB::table('import_runs')->where('import_file_id', $fileId)
                ->where('organization_id', $organizationId)->where('status', 'published')
                ->whereNotNull('published_at')->where('revision', '>', $run->revision)->exists();
            abort_if($newerPublishedExists, 409, 'A newer revision is already published; this older revision cannot replace it.');

            $incompleteChunks = DB::table('import_chunks')->where('import_run_id', $runId)
                ->where('organization_id', $organizationId)->where('status', '!=', 'completed')->exists();
            abort_if($incompleteChunks, 409, 'Some import chunks are incomplete.');

            $sourceRows = DB::table('import_source_rows')->where('import_run_id', $runId)
                ->where('organization_id', $organizationId)->count();
            $countedRows = (int) $run->accepted_rows_count + (int) $run->duplicate_rows_count + (int) $run->rejected_rows_count;
            if ($sourceRows !== (int) $run->source_rows_count || $sourceRows !== $countedRows
                || $sourceRows !== (int) $run->processed_source_rows || $sourceRows !== (int) $run->total_source_rows) {
                throw new HttpException(409, 'The workbook row counts did not reconcile; this import remains unpublished.');
            }

            $chunkRows = (int) DB::table('import_chunks')->where('import_run_id', $runId)
                ->where('organization_id', $organizationId)->where('status', 'completed')->sum('rows_processed');
            abort_unless($chunkRows === $sourceRows, 409, 'The completed chunks do not match the saved source rows.');

            $snapshotCount = DB::table('shipment_snapshots')->where('import_run_id', $runId)
                ->where('organization_id', $organizationId)->count();
            abort_unless($snapshotCount === (int) $run->accepted_rows_count, 409, 'The published snapshot count does not match accepted rows.');
            abort_if((int) $run->accepted_rows_count === 0, 422, 'The workbook has no acceptable shipment rows.');

            $now = now();
            DB::table('import_runs')->where('id', $runId)->where('organization_id', $organizationId)->update([
                'status' => 'published',
                'processing_state' => 'completed',
                'processing_error_code' => null,
                'processing_error' => null,
                'processing_completed_at' => $now,
                'finished_at' => $now,
                'published_at' => $now,
                'updated_at' => $now,
            ]);
            DB::table('import_files')->where('id', $fileId)->where('organization_id', $organizationId)->update([
                'active_run_id' => $runId,
                'archived_at' => null,
                'updated_at' => $now,
            ]);

            if ($metricsFactory !== null) {
                $metrics = $metricsFactory();
                DB::table('import_runs')->where('id', $runId)->where('organization_id', $organizationId)->update([
                    'processing_metrics' => json_encode($metrics, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE),
                    'updated_at' => now(),
                ]);
            }

            return [
                'file_id' => $fileId,
                'run_id' => $runId,
                'revision' => (int) $run->revision,
                'counts' => [
                    'source' => (int) $run->source_rows_count,
                    'accepted' => (int) $run->accepted_rows_count,
                    'duplicates' => (int) $run->duplicate_rows_count,
                    'rejected' => (int) $run->rejected_rows_count,
                    'issues' => (int) $run->issues_count,
                ],
            ];
        }, 3);
    }
}
