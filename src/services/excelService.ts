import { parseExcelBuffer, ParseResult } from '../utils/excelParser';

export interface ProcessFilePayload {
  file: File;
  fileId: string;
  shipmentDate: string;
  overrides?: Record<string, string>;
}

export interface ProgressCallback {
  (progress: {
    fileId: string;
    fileName: string;
    status: 'reading' | 'parsing' | 'done' | 'error';
    error?: string;
    result?: ParseResult;
  }): void;
}

export async function processExcelFile(
  payload: ProcessFilePayload,
  onProgress?: ProgressCallback
): Promise<ParseResult> {
  const { file, fileId, shipmentDate, overrides } = payload;

  onProgress?.({
    fileId,
    fileName: file.name,
    status: 'reading',
  });

  const buffer = await file.arrayBuffer();

  onProgress?.({
    fileId,
    fileName: file.name,
    status: 'parsing',
  });

  // Try Web Worker first
  if (typeof Worker !== 'undefined') {
    try {
      const worker = new Worker(
        new URL('../workers/excelWorker.ts', import.meta.url),
        { type: 'module' }
      );

      const result = await new Promise<ParseResult>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent) => {
          if (e.data.type === 'complete') {
            worker.terminate();
            resolve(e.data.result);
          } else if (e.data.type === 'error') {
            worker.terminate();
            reject(new Error(e.data.error));
          }
        };

        worker.onerror = (err) => {
          worker.terminate();
          reject(err);
        };

        worker.postMessage({
          buffer,
          fileId,
          fileName: file.name,
          shipmentDate,
          overrides,
        }, [buffer]);
      });

      onProgress?.({
        fileId,
        fileName: file.name,
        status: 'done',
        result,
      });

      return result;
    } catch {
      // Fallback to main thread execution if Worker creation failed (e.g. strict CSP or sandbox)
      const res = parseExcelBuffer(buffer, fileId, file.name, shipmentDate, overrides, {
        includeDashboardRecords: false,
      });
      onProgress?.({
        fileId,
        fileName: file.name,
        status: 'done',
        result: res,
      });
      return res;
    }
  }

  // Direct main thread fallback
  const res = parseExcelBuffer(buffer, fileId, file.name, shipmentDate, overrides, {
    includeDashboardRecords: false,
  });
  onProgress?.({
    fileId,
    fileName: file.name,
    status: 'done',
    result: res,
  });
  return res;
}
