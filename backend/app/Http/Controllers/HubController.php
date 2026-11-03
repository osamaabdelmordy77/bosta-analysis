<?php

namespace App\Http\Controllers;

use App\Models\Hub;
use App\Security\HubAccessService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

class HubController extends Controller
{
    public function index(Request $request, HubAccessService $access): JsonResponse
    {
        Gate::authorize('viewAny', Hub::class);

        $hubs = $access->scopeHubs(Hub::query(), $request->user())
            ->select(['hubs.id', 'hubs.canonical_name', 'hubs.external_code'])
            ->orderBy('hubs.id')
            ->cursorPaginate(100)
            ->through(fn (Hub $hub): array => $this->payload($hub));

        return $this->success([
            'hubs' => $hubs->items(),
            'pagination' => [
                'next_cursor' => $hubs->nextCursor()?->encode(),
                'previous_cursor' => $hubs->previousCursor()?->encode(),
            ],
        ]);
    }

    public function show(Request $request, string $organization, string $hub, HubAccessService $access): JsonResponse
    {
        $record = $access->findVisibleHubOrFail($request->user(), $hub);
        Gate::authorize('view', $record);

        return $this->success(['hub' => $this->payload($record)]);
    }

    /**
     * @return array<string, mixed>
     */
    private function payload(Hub $hub): array
    {
        return [
            'id' => (string) $hub->id,
            'name' => Str::limit((string) $hub->canonical_name, 255, ''),
            'external_code' => $hub->external_code === null ? null : Str::limit((string) $hub->external_code, 100, ''),
        ];
    }
}
