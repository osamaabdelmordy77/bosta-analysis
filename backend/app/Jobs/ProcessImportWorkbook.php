<?php

namespace App\Jobs;

use App\Imports\ImportWorkbookProcessor;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Throwable;

class ProcessImportWorkbook implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public int $tries;

    public int $timeout;

    /** @var list<int> */
    public array $backoff = [10, 30, 60];

    public function __construct(
        public readonly string $organizationId,
        public readonly string $fileId,
        public readonly string $runId,
    ) {
        $this->timeout = max(60, (int) config('import_ingestion.worker_timeout', 3600));
        $this->tries = max(1, (int) config('import_ingestion.worker_tries', 3));
        $this->onQueue('imports');
    }

    /** @return list<WithoutOverlapping> */
    public function middleware(): array
    {
        return [
            (new WithoutOverlapping('import-run:'.$this->organizationId.':'.$this->runId))
                ->releaseAfter(10)
                ->expireAfter($this->timeout + 60),
        ];
    }

    public function handle(ImportWorkbookProcessor $processor): void
    {
        $processor->process($this->organizationId, $this->fileId, $this->runId);
    }

    public function failed(?Throwable $exception): void
    {
        $now = now();
        DB::table('import_runs')->where('id', $this->runId)
            ->where('import_file_id', $this->fileId)
            ->where('organization_id', $this->organizationId)
            ->where('processing_state', '!=', 'completed')
            ->update([
                'processing_state' => 'failed',
                'processing_error_code' => 'processing_failed',
                'processing_error' => 'Workbook processing failed. Retry this import or contact an administrator.',
                'finished_at' => $now,
                'updated_at' => $now,
            ]);
    }
}
