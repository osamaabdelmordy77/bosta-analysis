<?php

namespace App\Tenancy;

use LogicException;

final class OrganizationContext
{
    private ?string $organizationId = null;

    private ?int $userId = null;

    private ?int $roleId = null;

    public function set(string $organizationId, ?int $userId = null, ?int $roleId = null): void
    {
        $this->organizationId = $organizationId;
        $this->userId = $userId;
        $this->roleId = $roleId;
    }

    public function id(): ?string
    {
        return $this->organizationId;
    }

    public function requireId(): string
    {
        return $this->organizationId ?? throw new LogicException('An organization context is required for this operation.');
    }

    public function userId(): ?int
    {
        return $this->userId;
    }

    public function roleId(): ?int
    {
        return $this->roleId;
    }

    public function clear(): void
    {
        $this->organizationId = null;
        $this->userId = null;
        $this->roleId = null;
    }
}
