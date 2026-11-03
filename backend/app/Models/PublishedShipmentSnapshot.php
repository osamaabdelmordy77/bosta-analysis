<?php

namespace App\Models;

/** Read-only report source; use this model so the organization scope stays enabled. */
class PublishedShipmentSnapshot extends TenantModel
{
    protected $table = 'published_shipment_snapshots';

    public $timestamps = false;
}
