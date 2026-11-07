<?php

return [
    'enabled' => (bool) env('LOCAL_WORKSPACE_SEED_ENABLED', false),
    'organization_name' => env('LOCAL_WORKSPACE_ORGANIZATION_NAME'),
    'organization_slug' => env('LOCAL_WORKSPACE_ORGANIZATION_SLUG'),
    'role' => env('LOCAL_WORKSPACE_ORGANIZATION_ROLE', 'analyst'),
    'admin_name' => env('LOCAL_WORKSPACE_ADMIN_NAME'),
    'admin_email' => env('LOCAL_WORKSPACE_ADMIN_EMAIL'),
    'admin_password' => env('LOCAL_WORKSPACE_ADMIN_PASSWORD'),
];
