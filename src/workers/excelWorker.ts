import { parseExcelBuffer } from '../utils/excelParser';

self.onmessage = async (e: MessageEvent) => {
  try {
    const { buffer, fileId, fileName, shipmentDate, overrides } = e.data;
    const result = parseExcelBuffer(buffer, fileId, fileName, shipmentDate, overrides, {
      includeDashboardRecords: false,
    });
    self.postMessage({ type: 'complete', result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ type: 'error', error: message });
  }
};
