<?php

namespace App\Http\Controllers;

use App\Tenancy\OrganizationContext;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Http;

class BostaMissScanController extends Controller
{
    private const API = 'https://beta-api.bosta.co/api/v0';

    public function status(Request $request, OrganizationContext $context): JsonResponse
    {
        return $this->success(['connected' => $this->token($request, $context) !== null]);
    }

    public function connect(Request $request, OrganizationContext $context): JsonResponse
    {
        $input = $request->validate(['token' => ['required', 'string', 'max:4096']]);
        $token = preg_replace('/^Bearer\s+/i', '', trim($input['token']));
        if ($token === '') {
            return response()->json(['message' => 'Enter a Bosta access token.'], 422);
        }

        $result = $this->call($token, 'get', '/hubs/list');
        if ($result instanceof JsonResponse) return $result;

        $request->session()->put($this->sessionKey($context), Crypt::encryptString($token));

        return $this->success(['connected' => true, 'hubs' => $this->hubsFrom($result)]);
    }

    public function disconnect(Request $request, OrganizationContext $context): JsonResponse
    {
        $request->session()->forget($this->sessionKey($context));

        return $this->success(['connected' => false]);
    }

    public function hubs(Request $request, OrganizationContext $context): JsonResponse
    {
        $token = $this->token($request, $context);
        if ($token === null) return $this->notConnected();
        $result = $this->call($token, 'get', '/hubs/list');
        if ($result instanceof JsonResponse) return $result;

        return $this->success(['hubs' => $this->hubsFrom($result)]);
    }

    public function count(Request $request, OrganizationContext $context): JsonResponse
    {
        $input = $request->validate(['hub_id' => ['required', 'string', 'max:100']]);
        $token = $this->token($request, $context);
        if ($token === null) return $this->notConnected();
        $result = $this->call($token, 'post', '/deliveries/count', [
            'hubs' => [$input['hub_id']], 'stateCodes' => ['24.2'],
        ]);
        if ($result instanceof JsonResponse) return $result;

        return $this->success(['count' => max(0, (int) ($result['deliveriesCount'] ?? $result['count'] ?? $result['total'] ?? 0))]);
    }

    public function page(Request $request, OrganizationContext $context): JsonResponse
    {
        $request->merge(['page' => $request->route('page')]);
        $input = $request->validate([
            'hub_id' => ['required', 'string', 'max:100'],
            'page' => ['required', 'integer', 'min:1', 'max:1000'],
        ]);
        $token = $this->token($request, $context);
        if ($token === null) return $this->notConnected();
        $result = $this->call($token, 'post', '/deliveries/search', [
            'hubs' => [$input['hub_id']], 'stateCodes' => ['24.2'],
            'pageNumber' => (int) $input['page'], 'pageLimit' => 200,
        ]);
        if ($result instanceof JsonResponse) return $result;
        $rows = array_is_list($result) ? $result : ($result['deliveries'] ?? $result['data'] ?? $result['result'] ?? []);

        return $this->success(['deliveries' => is_array($rows) ? $rows : []]);
    }

    public function details(Request $request, string $organization, string $deliveryId, OrganizationContext $context): JsonResponse
    {
        $token = $this->token($request, $context);
        if ($token === null) return $this->notConnected();
        $result = $this->call($token, 'get', '/admin/deliveries', ['ids' => $deliveryId]);
        if ($result instanceof JsonResponse) return $result;
        $rows = array_is_list($result) ? $result : ($result['deliveries'] ?? $result['data'] ?? $result['result'] ?? []);

        return $this->success(['delivery' => is_array($rows) ? ($rows[0] ?? null) : null]);
    }

    private function sessionKey(OrganizationContext $context): string
    {
        return 'bosta_miss_scan_token:'.$context->requireId();
    }

    private function token(Request $request, OrganizationContext $context): ?string
    {
        $encrypted = $request->session()->get($this->sessionKey($context));
        if (! is_string($encrypted)) return null;
        try {
            return Crypt::decryptString($encrypted);
        } catch (\Throwable) {
            $request->session()->forget($this->sessionKey($context));
            return null;
        }
    }

    private function notConnected(): JsonResponse
    {
        return response()->json(['message' => 'Connect your Bosta token first.'], 409);
    }

    private function hubsFrom(array $result): array
    {
        $rows = array_is_list($result) ? $result : ($result['result'] ?? $result['data'] ?? []);
        if (! is_array($rows)) return [];
        return array_values(array_filter(array_map(static function ($hub): ?array {
            if (! is_array($hub) || ! is_scalar($hub['_id'] ?? null)) return null;
            return ['id' => (string) $hub['_id'], 'name' => (string) ($hub['name'] ?? $hub['_id'])];
        }, $rows)));
    }

    private function call(string $token, string $method, string $path, array $payload = []): array|JsonResponse
    {
        try {
            $client = Http::withToken($token)->acceptJson()->timeout(35);
            $response = $method === 'get'
                ? $client->get(self::API.$path, $payload)
                : $client->post(self::API.$path, $payload);
        } catch (ConnectionException) {
            return response()->json(['message' => 'Could not reach Bosta API.'], 502);
        }

        if ($response->status() === 401) return response()->json(['message' => 'Bosta token is invalid or expired. Reconnect it.'], 401);
        if ($response->status() === 403) return response()->json(['message' => 'Bosta denied access for this token.'], 403);
        if (! $response->successful()) return response()->json(['message' => 'Bosta API request failed.'], 502);
        $data = $response->json();

        return is_array($data) ? $data : [];
    }
}
