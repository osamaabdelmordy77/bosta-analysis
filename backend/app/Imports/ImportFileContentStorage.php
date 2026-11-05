<?php

namespace App\Imports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Throwable;

class ImportFileContentStorage
{
    private const LEGACY_CHUNK_BYTES = 524288;

    /**
     * Store a newly uploaded original outside the web root and verify it before
     * a database row or queue job can refer to it.
     *
     * @return array{disk:string,path:string,bytes:int,sha256:string}
     */
    public function storePrivateOriginal(string $sourcePath, string $organizationId, string $runId, string $extension, string $expectedSha256): array
    {
        $diskName = 'imports_private';
        $disk = Storage::disk($diskName);
        $path = trim($organizationId, '/').'/'.trim($runId, '/').'.'.strtolower($extension);
        $stream = fopen($sourcePath, 'rb');
        if ($stream === false) {
            throw new RuntimeException('The uploaded workbook could not be read from its temporary file.');
        }

        try {
            $written = $disk->writeStream($path, $stream, ['visibility' => 'private']);
        } catch (Throwable $exception) {
            fclose($stream);
            throw $exception;
        }
        fclose($stream);

        if (! $written) {
            throw new RuntimeException('The private workbook could not be stored.');
        }

        try {
            $localPath = $this->localPath($diskName, $path);
            $actualSha256 = hash_file('sha256', $localPath);
            $bytes = filesize($localPath);
            if (! is_string($actualSha256) || ! is_int($bytes) || ! hash_equals($expectedSha256, $actualSha256)) {
                throw new RuntimeException('The stored workbook did not match the uploaded file checksum.');
            }

            return ['disk' => $diskName, 'path' => $path, 'bytes' => $bytes, 'sha256' => $actualSha256];
        } catch (Throwable $exception) {
            $disk->delete($path);
            throw $exception;
        }
    }

    public function deletePrivateOriginal(string $diskName, string $path): void
    {
        if ($diskName !== '' && $path !== '') {
            Storage::disk($diskName)->delete($path);
        }
    }

    /**
     * Resolve new private-file references, or reconstruct a legacy original
     * from the old LONGBLOB/chunk tables without deleting or rewriting them.
     *
     * @return array{path:string,temporary:bool}
     */
    public function resolveForProcessing(object $content): array
    {
        if (is_string($content->storage_disk ?? null) && $content->storage_disk !== ''
            && is_string($content->storage_path ?? null) && $content->storage_path !== '') {
            $path = $this->localPath((string) $content->storage_disk, (string) $content->storage_path);
            $this->assertOriginalMatches($path, (string) $content->sha256);

            return ['path' => $path, 'temporary' => false];
        }

        return $this->materializeLegacyOriginal($content);
    }

    private function materializeLegacyOriginal(object $content): array
    {
        $runId = (string) $content->import_run_id;
        $path = storage_path('app/private/import-work/'.$runId.'.source');
        $directory = dirname($path);
        if (! is_dir($directory) && ! mkdir($directory, 0700, true) && ! is_dir($directory)) {
            throw new RuntimeException('The private import working directory could not be created.');
        }

        $output = fopen($path, 'wb');
        if ($output === false) {
            throw new RuntimeException('The legacy workbook could not be materialized for processing.');
        }

        $hash = hash_init('sha256');
        $bytes = 0;
        try {
            $legacy = DB::table('import_file_contents')->where('id', $content->id)->value('contents');
            if (is_string($legacy) && $legacy !== '') {
                $this->writeVerifiedChunk($output, $legacy, $hash, $bytes);
            } else {
                $expectedOffset = 0;
                foreach (DB::table('import_file_content_chunks')->where('import_file_content_id', $content->id)
                    ->orderBy('chunk_index')->cursor(['byte_offset', 'byte_length', 'sha256', 'contents']) as $chunk) {
                    if ((int) $chunk->byte_offset !== $expectedOffset) {
                        throw new RuntimeException('The legacy workbook chunks are incomplete or out of order.');
                    }
                    $contents = (string) $chunk->contents;
                    if (strlen($contents) !== (int) $chunk->byte_length
                        || ! hash_equals((string) $chunk->sha256, hash('sha256', $contents))) {
                        throw new RuntimeException('A legacy workbook chunk failed its checksum.');
                    }
                    $this->writeVerifiedChunk($output, $contents, $hash, $bytes);
                    $expectedOffset += strlen($contents);
                }
            }
        } catch (Throwable $exception) {
            fclose($output);
            @unlink($path);
            throw $exception;
        }
        fclose($output);

        $actualSha256 = hash_final($hash);
        if ($bytes === 0 || ! hash_equals((string) $content->sha256, $actualSha256)) {
            @unlink($path);
            throw new RuntimeException('The reconstructed legacy workbook did not match its stored checksum.');
        }

        return ['path' => $path, 'temporary' => true];
    }

    /** @param resource $output */
    private function writeVerifiedChunk($output, string $contents, $hash, int &$bytes): void
    {
        $length = strlen($contents);
        $written = 0;
        while ($written < $length) {
            $result = fwrite($output, substr($contents, $written, self::LEGACY_CHUNK_BYTES));
            if ($result === false || $result === 0) {
                throw new RuntimeException('The legacy workbook could not be reconstructed completely.');
            }
            hash_update($hash, substr($contents, $written, $result));
            $bytes += $result;
            $written += $result;
        }
    }

    private function localPath(string $diskName, string $path): string
    {
        $configuration = config('filesystems.disks.'.$diskName);
        if (($configuration['driver'] ?? null) !== 'local') {
            throw new RuntimeException('Workbook processing currently requires a private local filesystem disk.');
        }

        $resolved = Storage::disk($diskName)->path($path);
        if (! is_file($resolved) || ! is_readable($resolved)) {
            throw new RuntimeException('The private workbook file is missing or unreadable.');
        }

        return $resolved;
    }

    private function assertOriginalMatches(string $path, string $expectedSha256): void
    {
        $actualSha256 = hash_file('sha256', $path);
        if (! is_string($actualSha256) || ! hash_equals($expectedSha256, $actualSha256)) {
            throw new RuntimeException('The private workbook failed its stored checksum.');
        }
    }
}
