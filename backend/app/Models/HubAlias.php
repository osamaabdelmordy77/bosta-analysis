<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HubAlias extends TenantModel
{
    public function hub(): BelongsTo
    {
        return $this->belongsTo(Hub::class);
    }
}
