<?php

return [
    'lookup_batch_keys' => (int) env('IMPORT_LOOKUP_BATCH_KEYS', 400),
    'max_batch_rows' => (int) env('IMPORT_DB_BATCH_ROWS', 400),
    'max_batch_bindings' => (int) env('IMPORT_DB_BATCH_BINDINGS', 4000),
    'max_batch_bytes' => (int) env('IMPORT_DB_BATCH_BYTES', 524288),
    'packet_margin_bytes' => (int) env('IMPORT_DB_PACKET_MARGIN_BYTES', 65536),
    'reader_temp_path' => env('IMPORT_READER_TEMP_PATH', storage_path('app/private/import-work')),
    'max_source_row_number' => (int) env('IMPORT_MAX_SOURCE_ROW_NUMBER', 200000),
    'xls_read_chunk_rows' => (int) env('IMPORT_XLS_READ_CHUNK_ROWS', 400),
    'worker_timeout' => (int) env('IMPORT_WORKER_TIMEOUT', 3600),
    'worker_tries' => (int) env('IMPORT_WORKER_TRIES', 3),
];
