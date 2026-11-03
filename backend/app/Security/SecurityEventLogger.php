<?php

namespace App\Security;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class SecurityEventLogger
{
    public function record(string $event, ?int $userId, Request $request, array $metadata = []): void
    {
        $key = (string) (config('auth.session_reference_key') ?: config('app.key'));
        $ip = (string) $request->ip();
        $metadata = array_intersect_key($metadata, array_flip([
            'reason', 'result', 'actor_id', 'source', 'revoked_count',
        ]));

        Log::channel('security')->notice($event, [
            'user_id' => $userId,
            'ip_fingerprint' => $ip === '' ? null : hash_hmac('sha256', $ip, $key),
            'event_id' => (string) Str::uuid(),
            'metadata' => $metadata,
        ]);
    }
}
