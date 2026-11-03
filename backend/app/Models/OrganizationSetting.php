<?php

namespace App\Models;

class OrganizationSetting extends TenantModel
{
    protected function casts(): array
    {
        return ['setting_value' => 'array'];
    }
}
