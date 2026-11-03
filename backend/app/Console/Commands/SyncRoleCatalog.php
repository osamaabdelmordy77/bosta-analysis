<?php

namespace App\Console\Commands;

use App\Security\RoleCatalog;
use Illuminate\Console\Command;

class SyncRoleCatalog extends Command
{
    protected $signature = 'security:sync-role-catalog';

    protected $description = 'Synchronize the fixed role and permission catalog for every organization.';

    public function handle(RoleCatalog $catalog): int
    {
        $count = $catalog->syncAllOrganizations();
        $this->info("Synchronized the fixed access catalog for {$count} organizations.");

        return self::SUCCESS;
    }
}
