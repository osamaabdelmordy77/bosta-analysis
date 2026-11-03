<?php

namespace App\Tenancy;

use LogicException;

final class OrganizationContext
{
    private ?string $organizationId = null;

    public function set(string $organizationId): void
    {
        $this->organizationId = $organizationId;
    }

    public function id(): ?string
    {
        return $this->organizationId;
    }

    public function requireId(): string
    {
        return $this->organizationId ?? throw new LogicException('An organization context is required for this operation.');
    }

    public function clear(): void
    {
        $this->organizationId = null;
    }
}
