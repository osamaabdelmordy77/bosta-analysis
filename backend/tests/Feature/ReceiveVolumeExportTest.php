<?php

namespace Tests\Feature;

use App\Models\User;
use App\Security\AuthorizationService;
use Mockery;
use Tests\TestCase;

class ReceiveVolumeExportTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        // Exercise the controller and export without touching any database.
        // Organization/auth middleware are already covered by access tests.
        $this->withoutMiddleware();
        $this->actingAs(new User(['name' => 'Volume test', 'email' => 'volume@example.test']));
    }

    public function test_authorized_filtered_aggregates_download_as_native_excel(): void
    {
        $this->authorize(true);
        $response = $this->postJson('/api/organizations/test/receive/volume/export', ['rows' => [$this->row()]]);
        $response->assertOk()->assertDownload('receive-volume-comparisons-pivots.xlsx');
        self::assertStringStartsWith('PK', $response->streamedContent());
    }

    public function test_export_requires_shipment_or_import_permission(): void
    {
        $this->authorize(false);
        $this->postJson('/api/organizations/test/receive/volume/export', ['rows' => [$this->row()]])->assertForbidden();
    }

    public function test_export_rejects_invalid_dates_groups_and_counts(): void
    {
        $this->authorize(true);
        $row = array_replace($this->row(), ['date' => '2026-02-30', 'window' => '=1+1', 'shipments' => -1]);
        $this->postJson('/api/organizations/test/receive/volume/export', ['rows' => [$row]])
            ->assertUnprocessable()->assertJsonValidationErrors(['rows.0.date', 'rows.0.window', 'rows.0.shipments']);
    }

    public function test_undated_records_can_be_exported_without_inventing_a_date(): void
    {
        $this->authorize(true);
        $row = array_replace($this->row(), ['date' => '', 'week' => '', 'weekday' => '', 'window' => 'Missing / invalid time']);
        $this->postJson('/api/organizations/test/receive/volume/export', ['rows' => [$row]])->assertOk();
    }

    private function authorize(bool $allowed): void
    {
        $authorization = Mockery::mock(AuthorizationService::class);
        $authorization->shouldReceive('hasPermission')->andReturn($allowed);
        $this->app->instance(AuthorizationService::class, $authorization);
    }

    private function row(): array
    {
        return ['date' => '2026-11-07', 'weekday' => 'Saturday', 'week' => '2026-11-07', 'window' => '14:00–17:00', 'shipments' => 2, 'items' => 3];
    }
}
