<?php

namespace App\Imports;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

class ImportFileContentStorage
{
    private const CHUNK_BYTES = 524288;

    /** @return array{chunks:int,bytes:int} */
    public function store(string $contentId, string $path): array
    {
        $stream = fopen($path, 'rb');
        if ($stream === false) {
            throw new RuntimeException('The uploaded workbook could not be read from its temporary file.');
        }

        $chunkIndex = 0;
        $byteOffset = 0;
        try {
            while (! feof($stream)) {
                $contents = fread($stream, self::CHUNK_BYTES);
                if ($contents === false) {
                    throw new RuntimeException('The uploaded workbook could not be read completely.');
                }
                if ($contents === '') {
                    continue;
                }

                $byteLength = strlen($contents);
                DB::table('import_file_content_chunks')->insert([
                    'id' => (string) Str::ulid(),
                    'import_file_content_id' => $contentId,
                    'chunk_index' => $chunkIndex,
                    'byte_offset' => $byteOffset,
                    'byte_length' => $byteLength,
                    'sha256' => hash('sha256', $contents),
                    'contents' => $contents,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                $chunkIndex++;
                $byteOffset += $byteLength;
            }
        } finally {
            fclose($stream);
        }

        if ($byteOffset === 0) {
            throw new RuntimeException('The uploaded workbook is empty.');
        }

        return ['chunks' => $chunkIndex, 'bytes' => $byteOffset];
    }
}
