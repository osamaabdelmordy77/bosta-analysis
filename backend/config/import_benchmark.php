<?php

return [
    'enabled' => (bool) env('IMPORT_BENCHMARK_ENABLED', false),
    'database' => env('IMPORT_BENCHMARK_DATABASE', 'bosta_analysis_benchmark'),
];
