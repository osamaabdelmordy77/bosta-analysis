import { enrichLoadingCheckRows, normalizeSystemSeals } from '../utils/loadingCheck';
import type { LoadingCheckSeal } from '../utils/loadingCheck';

type WorkerRequest =
  | { id: number; type: 'normalize'; value: unknown }
  | { id: number; type: 'enrich'; rows: string[][]; seals: LoadingCheckSeal[] };

type WorkerReply = { id: number; result?: unknown; error?: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerReply) => void;
};

scope.onmessage = (event) => {
  const request = event.data;
  try {
    const result = request.type === 'normalize'
      ? normalizeSystemSeals(request.value)
      : enrichLoadingCheckRows(request.rows, request.seals);
    scope.postMessage({ id: request.id, result });
  } catch (error) {
    scope.postMessage({ id: request.id, error: error instanceof Error ? error.message : 'Background processing failed.' });
  }
};
