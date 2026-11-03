<?php

use Illuminate\Support\Facades\Route;

Route::get('/', fn () => response()->json([
    'application' => 'Bosta Analysis API',
    'status' => 'ready',
]));
