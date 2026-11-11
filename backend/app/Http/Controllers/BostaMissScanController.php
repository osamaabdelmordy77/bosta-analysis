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

    public function sealsPage(Request $request, OrganizationContext $context): JsonResponse
    {
        $request->merge(['page' => $request->route('page')]);
        $input = $request->validate([
            'source_hub_id' => ['required', 'string', 'max:100'],
            'destination_hub_id' => ['nullable', 'string', 'max:100'],
            'all_states' => ['sometimes', 'boolean'],
            'page' => ['required', 'integer', 'min:1', 'max:1000'],
        ]);
        $token = $this->token($request, $context);
        if ($token === null) return $this->notConnected();

        $payload = [
            'pageId' => (int) $input['page'],
            'pageLimit' => 500,
            'sourceHubId' => $input['source_hub_id'],
            'nextPassthroughHubId' => $input['source_hub_id'],
            'searchType' => 'Seals',
        ];
        if (! ($input['all_states'] ?? false)) {
            $payload['type'] = 'Normal,Bulky';
            $payload['state'] = 'Pending';
        }
        if (is_string($input['destination_hub_id'] ?? null) && $input['destination_hub_id'] !== '') {
            $payload['destinationHubId'] = $input['destination_hub_id'];
        }

        $result = $this->call($token, 'get', '/seals/search', $payload);
        if ($result instanceof JsonResponse) return $result;

        return $this->success(['result' => $result]);
    }

    public function masterSealsPage(Request $request, OrganizationContext $context): JsonResponse
    {
        $request->merge(['page' => $request->route('page')]);
        $input = $request->validate([
            'destination_hub_id' => ['required', 'string', 'max:100'],
            'created_at_start' => ['required', 'string', 'max:80'],
            'created_at_end' => ['required', 'string', 'max:80'],
            'page' => ['required', 'integer', 'min:1', 'max:10000'],
        ]);
        $token = $this->token($request, $context);
        if ($token === null) return $this->notConnected();

        $result = $this->call($token, 'get', '/seals/master', [
            'page' => (int) $input['page'],
            'limit' => 50,
            'destinationHubId' => $input['destination_hub_id'],
            'createdAtStart' => $input['created_at_start'],
            'createdAtEnd' => $input['created_at_end'],
        ]);
        if ($result instanceof JsonResponse) return $result;

        return $this->success(['result' => $result]);
    }

    public function masterSealManifest(Request $request, string $organization, string $sealNumber, OrganizationContext $context): JsonResponse
    {
        $token = $this->token($request, $context);
        if ($token === null) return $this->notConnected();
        $result = $this->call($token, 'get', '/seals/master/'.rawurlencode($sealNumber).'/manifest');
        if ($result instanceof JsonResponse) return $result;

        return $this->success(['result' => $result]);
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

    public function historyCount(Request $request, OrganizationContext $context): JsonResponse
    {
        $input = $request->validate([
            'hub_id' => ['required', 'string', 'max:100'],
            'state_codes' => ['required', 'array', 'min:1', 'max:3'],
            'state_codes.*' => ['required', 'string', 'max:30'],
        ]);
        $token = $this->token($request, $context);
        if ($token === null) return $this->notConnected();
        $result = $this->call($token, 'post', '/deliveries/count', [
            'hubs' => [$input['hub_id']], 'stateCodes' => array_values($input['state_codes']),
        ]);
        if ($result instanceof JsonResponse) return $result;

        return $this->success(['count' => max(0, (int) ($result['deliveriesCount'] ?? $result['count'] ?? $result['total'] ?? 0))]);
    }

    public function historyPage(Request $request, OrganizationContext $context): JsonResponse
    {
        $request->merge(['page' => $request->route('page')]);
        $input = $request->validate([
            'hub_id' => ['required', 'string', 'max:100'],
            'state_codes' => ['required', 'array', 'min:1', 'max:3'],
            'state_codes.*' => ['required', 'string', 'max:30'],
            'page' => ['required', 'integer', 'min:1', 'max:1000'],
            'page_limit' => ['required', 'integer', 'min:1', 'max:200'],
        ]);
        $token = $this->token($request, $context);
        if ($token === null) return $this->notConnected();
        $result = $this->call($token, 'post', '/deliveries/search', [
            'hubs' => [$input['hub_id']], 'stateCodes' => array_values($input['state_codes']),
            'pageNumber' => (int) $input['page'], 'pageLimit' => (int) $input['page_limit'],
        ]);
        if ($result instanceof JsonResponse) return $result;
        $rows = array_is_list($result) ? $result : ($result['deliveries'] ?? $result['data'] ?? $result['result'] ?? []);

        return $this->success(['deliveries' => is_array($rows) ? $rows : []]);
    }

    public function historyDetails(Request $request, OrganizationContext $context): JsonResponse
    {
        $input = $request->validate([
            'ids' => ['required', 'array', 'min:1', 'max:100'],
            'ids.*' => ['required', 'string', 'max:100'],
        ]);
        $token = $this->token($request, $context);
        if ($token === null) return $this->notConnected();

        $ids = array_values(array_unique(array_map('strval', $input['ids'])));
        $client = Http::withToken($token)->acceptJson()->timeout(35)->withHeaders([
            'Cache-Control' => 'no-cache, no-store', 'Pragma' => 'no-cache',
        ]);
        try {
            $response = $client->get(self::API.'/admin/deliveries', ['ids' => implode(',', $ids)]);
            if ($response->status() === 304) {
                $response = $client->get(self::API.'/admin/deliveries', [
                    'ids' => implode(',', $ids), '_refresh' => (string) now()->valueOf(),
                ]);
            }
        } catch (ConnectionException) {
            return response()->json(['message' => 'Could not reach Bosta API.'], 502);
        }
        if ($response->status() === 401) return response()->json(['message' => 'Bosta token is invalid or expired. Reconnect it.'], 401);
        if ($response->status() === 403) return response()->json(['message' => 'Bosta denied access for this token.'], 403);
        if (! $response->successful()) return response()->json(['message' => 'Bosta API request failed.'], 502);
        $result = $response->json();
        $rows = is_array($result) ? (array_is_list($result) ? $result : ($result['deliveries'] ?? $result['data'] ?? $result['result'] ?? [])) : [];

        return $this->success(['deliveries' => is_array($rows) ? $rows : []]);
    }

    public function historyLookup(Request $request, OrganizationContext $context): JsonResponse
    {
        $input = $request->validate([
            'hub_id' => ['required', 'string', 'max:100'],
            'tracking_numbers' => ['required', 'array', 'min:1', 'max:30'],
            'tracking_numbers.*' => ['required', 'string', 'max:100'],
        ]);
        $token = $this->token($request, $context);
        if ($token === null) return $this->notConnected();

        $trackingNumbers = array_values(array_unique(array_map('strval', $input['tracking_numbers'])));
        $query = implode('&', array_map(
            static fn (string $number): string => 'trackingNumbers%5B%5D='.rawurlencode($number),
            $trackingNumbers,
        ));
        $url = self::API.'/admin/deliveries/tailored/scan-deliveries?'.$query
            .'&searchType=TransferToHubScan&destinationHub='.rawurlencode($input['hub_id']);
        try {
            $response = Http::withToken($token)->acceptJson()->timeout(35)->get($url);
        } catch (ConnectionException) {
            return response()->json(['message' => 'Could not reach Bosta API.'], 502);
        }
        if ($response->status() === 401) return response()->json(['message' => 'Bosta token is invalid or expired. Reconnect it.'], 401);
        if ($response->status() === 403) return response()->json(['message' => 'Bosta denied access for this token.'], 403);
        if (! $response->successful()) return response()->json(['message' => 'Bosta API request failed.'], 502);
        $result = $response->json();
        if (is_array($result) && ($result['success'] ?? true) === false) {
            return response()->json(['message' => (string) ($result['message'] ?? 'Bosta rejected the tracking-number lookup.')], 502);
        }
        $rows = is_array($result) ? (array_is_list($result) ? $result : ($result['deliveries'] ?? $result['data'] ?? $result['result'] ?? [])) : [];

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
        $rows = $this->findRows($result);
        if (! is_array($rows)) return [];
        return array_values(array_filter(array_map(static function ($hub): ?array {
            if (! is_array($hub) || ! is_scalar($hub['_id'] ?? null)) return null;
            return ['id' => (string) $hub['_id'], 'name' => (string) ($hub['name'] ?? $hub['_id'])];
        }, $rows)));
    }

    private function findRows(mixed $value, int $depth = 0): array
    {
        if ($depth > 5 || $value === null) return [];
        if (! is_array($value)) return [];
        if (array_is_list($value)) return $value;

        foreach (['data', 'result', 'message', 'hubs', 'items', 'results', 'seals'] as $key) {
            if (array_key_exists($key, $value)) {
                $rows = $this->findRows($value[$key], $depth + 1);
                if ($rows !== []) return $rows;
            }
        }
        foreach ($value as $nested) {
            $rows = $this->findRows($nested, $depth + 1);
            if ($rows !== []) return $rows;
        }

        return [];
    }

    private function call(string $token, string $method, string $path, array $payload = []): array|JsonResponse
    {
        try {
            $client = Http::withToken($token)->acceptJson()->timeout(35);
            $isMasterSealRequest = str_starts_with($path, '/seals/master');
            if ($isMasterSealRequest) {
                $client = $client->withHeaders(['Cache-Control' => 'no-cache, no-store', 'Pragma' => 'no-cache']);
            }
            $response = $method === 'get'
                ? $client->get(self::API.$path, $payload)
                : $client->post(self::API.$path, $payload);
            if ($response->status() === 304 && $isMasterSealRequest) {
                $response = $client->get(self::API.$path, [...$payload, '_refresh' => (string) now()->valueOf()]);
            }
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
