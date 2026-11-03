export type BackendConnectionStatus = 'checking' | 'connected' | 'unavailable';

export async function checkBackendConnection(signal?: AbortSignal): Promise<void> {
  const response = await fetch('/up', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal,
  });

  if (!response.ok) {
    throw new Error(`Backend health check returned HTTP ${response.status}`);
  }
}
