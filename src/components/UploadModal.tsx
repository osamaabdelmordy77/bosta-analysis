import React, { useState, useRef } from 'react';
import { extractDateFromFilename } from '../utils/dateExtractor';
import { Upload, X, AlertCircle, FileSpreadsheet, Calendar, Loader2 } from 'lucide-react';
import { ModalDialog } from './ModalDialog';

export interface PendingFile {
  id: string;
  file: File;
  name: string;
  size: number;
  detectedDate: string; // YYYY-MM-DD
  isManualDate: boolean;
  status: 'idle' | 'uploading' | 'done' | 'error';
  error?: string;
  recordCount?: number;
  uploadProgress?: number;
}

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProcessFiles: (files: PendingFile[], onProgress: (id: string, loaded: number, total: number) => void) => Promise<void>;
  existingFilenames: Set<string>;
}

export const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  onClose,
  onProcessFiles,
  existingFilenames,
}) => {
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFilesAdded = async (rawFiles: FileList | File[]) => {
    const fileArray = Array.from(rawFiles).filter((f) => /\.(xlsx|xls|csv)$/i.test(f.name));

    if (fileArray.length === 0) {
      setProcessingError('Choose an Excel workbook (.xlsx, .xls) or CSV file (.csv).');
      return;
    }

    setProcessingError(null);
    const newPending: PendingFile[] = fileArray.map((file) => {
      const detectedFromFilename = extractDateFromFilename(file.name);
      const today = new Date().toISOString().slice(0, 10);
      const detected = detectedFromFilename;
      return {
        id: `${file.name}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        file,
        name: file.name,
        size: file.size,
        detectedDate: detected || today,
        isManualDate: !detected,
        status: 'idle',
      };
    });

    setPendingFiles((prev) => [...prev, ...newPending]);
  };

  const handleDateChange = (id: string, newDate: string) => {
    setPendingFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, detectedDate: newDate, isManualDate: true } : f))
    );
  };

  const handleRemoveFile = (id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleStartProcessing = async () => {
    if (pendingFiles.length === 0 || isProcessing) return;
    setIsProcessing(true);
    setProcessingError(null);
    try {
      await onProcessFiles(pendingFiles, (id, loaded, total) => {
        const uploadProgress = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : undefined;
        setPendingFiles((prev) => prev.map((file) => file.id === id ? { ...file, status: 'uploading', uploadProgress } : file));
      });
      setPendingFiles([]);
      onClose();
    } catch (err) {
      console.error(err);
      setProcessingError(err instanceof Error ? err.message : 'The import could not be completed.');
    } finally {
      setIsProcessing(false);
    }
  };

  const totalSize = pendingFiles.reduce((sum, f) => sum + f.size, 0);
  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <ModalDialog labelledBy="upload-modal-title" maxWidth={820} onClose={onClose} dismissable={!isProcessing}>
        <div className="modal-header">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center">
              <Upload className="w-4 h-4" />
            </div>
            <div>
              <h3 id="upload-modal-title">Upload Daily Shipment Reports</h3>
              <p className="text-xs text-slate-400 m-0">
                Upload single daily reports, full months, or multi-month historical archives.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="modal-close icon-button"
            onClick={onClose}
            disabled={isProcessing}
            aria-label="Close upload dialog"
          >
            <X className="w-5 h-5" />
          </button>
      </div>

        <div className="modal-body">
          {/* Drop Zone */}
          <div
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
              isDragging
                ? 'border-sky-400 bg-sky-950/20'
                : 'border-[#263760] bg-[#0c1533] hover:border-[#38bdf888]'
            }`}
            role="button"
            tabIndex={0}
            aria-label="Choose shipment report files or drop them here"
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setIsDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              if (e.dataTransfer.files) handleFilesAdded(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              type="file"
              ref={fileInputRef}
              multiple
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleFilesAdded(e.target.files);
                e.target.value = '';
              }}
            />
            <FileSpreadsheet className="w-10 h-10 text-sky-400 mx-auto mb-3" />
            <h4 className="text-base font-semibold text-white mb-1">
              Select or Drag &amp; Drop Excel (.xlsx, .xls) or CSV (.csv) Files
            </h4>
            <p className="text-xs text-slate-400 max-w-md mx-auto mb-4">
              Select multiple files simultaneously. Shipment date is extracted from the filename when available; otherwise choose it here.
            </p>
            <span className="btn pri sm pointer-events-none" aria-hidden="true">
              Browse Excel Files
            </span>
          </div>

          {/* Pending Files List */}
          {pendingFiles.length > 0 && (
            <div className="mt-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-300">
                  {pendingFiles.length} file{pendingFiles.length === 1 ? '' : 's'} queued (
                  {formatSize(totalSize)})
                </span>
                <button
                  type="button"
                  className="text-xs text-pink-400 hover:underline"
                  onClick={() => setPendingFiles([])}
                  disabled={isProcessing}
                >
                  Clear queue
                </button>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {pendingFiles.map((item) => {
                  const isExisting = existingFilenames.has(item.name);
                  return (
                    <div
                      key={item.id}
                      className="p-3 bg-[#0a1330] border border-[#1d2a4d] rounded-lg flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileSpreadsheet className="w-5 h-5 text-emerald-400 shrink-0" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-200 truncate" title={item.name}>
                              {item.name}
                            </span>
                            {isExisting && (
                              <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded border border-amber-500/30">
                                Overwrite existing
                              </span>
                            )}
                          </div>
                          <span className="text-slate-400">{formatSize(item.size)}</span>
                          {item.status === 'uploading' && item.uploadProgress !== undefined && (
                            <div className="mt-1 flex items-center gap-2 text-[10px] text-sky-300">
                              <span>Uploading {item.uploadProgress}%</span>
                              <div className="h-1 w-24 overflow-hidden rounded bg-slate-700">
                                <div className="h-full bg-sky-400" style={{ width: `${item.uploadProgress}%` }} />
                              </div>
                              </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {/* Date badge or editor */}
                        <div className="flex items-center gap-1.5 bg-[#101b3b] px-2.5 py-1 rounded border border-[#223363]">
                          <Calendar className="w-3.5 h-3.5 text-sky-400" />
                          <input
                            type="date"
                            value={item.detectedDate}
                            onChange={(e) => handleDateChange(item.id, e.target.value)}
                            disabled={isProcessing}
                            className="bg-transparent text-slate-100 text-xs border-none outline-none cursor-pointer"
                          />
                        </div>

                        {item.isManualDate && (
                          <span className="text-[10px] text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded" title="Date set manually">
                            Manual Date
                          </span>
                        )}

                        {!isProcessing && (
                          <button
                            type="button"
                            className="text-slate-500 hover:text-pink-400 p-1"
                            onClick={() => handleRemoveFile(item.id)}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {processingError && (
            <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="whitespace-pre-wrap">{processingError}</span>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn sm"
            onClick={onClose}
            disabled={isProcessing}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn pri sm"
            disabled={pendingFiles.length === 0 || isProcessing}
            onClick={handleStartProcessing}
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Uploading original files…</span>
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                <span>
                  Upload &amp; Queue {pendingFiles.length > 0 ? `(${pendingFiles.length})` : ''}
                </span>
              </>
            )}
          </button>
        </div>
    </ModalDialog>
  );
};
