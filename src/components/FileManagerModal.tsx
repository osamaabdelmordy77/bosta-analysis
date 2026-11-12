import React, { useState } from 'react';
import { UploadedFile } from '../types';
import { FolderKanban, Trash2, Calendar, FileSpreadsheet, X, Check, Edit2 } from 'lucide-react';
import { ModalDialog } from './ModalDialog';

interface FileManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  files: UploadedFile[];
  canEditFiles: boolean;
  canArchiveFiles: boolean;
  canClearAll: boolean;
  onDeleteFile: (fileId: string) => Promise<void>;
  onUpdateFileDate: (fileId: string, newDate: string) => Promise<void>;
  onClearAll: () => void;
}

export const FileManagerModal: React.FC<FileManagerModalProps> = ({
  isOpen,
  onClose,
  files,
  canEditFiles,
  canArchiveFiles,
  canClearAll,
  onDeleteFile,
  onUpdateFileDate,
  onClearAll,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState<string>('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (!isOpen) return null;

  const totalRecords = files.reduce((sum, f) => sum + f.recordCount, 0);
  const totalDuplicates = files.reduce((sum, f) => sum + f.duplicateCount, 0);
  const showActions = canEditFiles || canArchiveFiles;

  const startEdit = (file: UploadedFile) => {
    setEditingId(file.id);
    setEditDate(file.detectedDate);
  };

  const saveEdit = async (fileId: string) => {
    if (!editDate) return;
    await onUpdateFileDate(fileId, editDate);
    setEditingId(null);
  };

  const handleDelete = async (fileId: string) => {
    setDeletingId(fileId);
    try {
      await onDeleteFile(fileId);
    } finally {
      setDeletingId(null);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <ModalDialog labelledBy="file-manager-modal-title" maxWidth={850} onClose={onClose}>
        <div className="modal-header">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
              <FolderKanban className="w-4 h-4" />
            </div>
            <div>
              <h3 id="file-manager-modal-title">Uploaded Daily Shipment Files</h3>
              <p className="text-xs text-slate-400 m-0">
                {files.length} file{files.length === 1 ? '' : 's'} stored in MySQL ·{' '}
                {totalRecords.toLocaleString()} total shipments
              </p>
            </div>
          </div>
          <button type="button" className="modal-close icon-button" onClick={onClose} aria-label="Close file manager">
            <X className="w-5 h-5" />
          </button>
      </div>

        <div className="modal-body">
          {/* Quick Stats Banner */}
          <div className="file-manager-summary grid grid-cols-3 gap-3 mb-4">
            <div className="p-3 bg-[#0a1330] border border-[#1d2a4d] rounded-lg">
              <small className="text-slate-400 text-xs block">Total Files Uploaded</small>
              <b className="text-lg text-white font-bold">{files.length}</b>
            </div>
            <div className="p-3 bg-[#0a1330] border border-[#1d2a4d] rounded-lg">
              <small className="text-slate-400 text-xs block">Stored Shipment Records</small>
              <b className="text-lg text-white font-bold">{totalRecords.toLocaleString()}</b>
            </div>
            <div className="p-3 bg-[#0a1330] border border-[#1d2a4d] rounded-lg">
              <small className="text-slate-400 text-xs block">Duplicate Rows Marked</small>
              <b className="text-lg text-white font-bold">{totalDuplicates.toLocaleString()}</b>
            </div>
          </div>

          {/* Files List */}
          <div className="dt-wrap" style={{ maxHeight: '380px' }}>
            <table>
              <thead>
                <tr>
                  <th>File Name</th>
                  <th>Shipment Date</th>
                  <th className="r">Shipment Records</th>
                  <th className="r">Size</th>
                  <th>Uploaded At</th>
                  {showActions && <th className="r">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {files.length === 0 ? (
                  <tr>
                    <td colSpan={showActions ? 6 : 5} className="text-center text-slate-400 p-8">
                      No files currently uploaded. Use &quot;Upload Excel Files&quot; to begin.
                    </td>
                  </tr>
                ) : (
                  files.map((file) => {
                    const isEditing = canEditFiles && editingId === file.id;
                    const isDeleting = deletingId === file.id;

                    return (
                      <tr key={file.id}>
                        <td>
                          <div className="flex items-center gap-2">
                            <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />
                            <span className="font-medium text-slate-200 truncate" title={file.name}>
                              {file.name}
                            </span>
                          </div>
                        </td>
                        <td>
                          {isEditing ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="date"
                                value={editDate}
                                onChange={(e) => setEditDate(e.target.value)}
                                className="bg-[#0a1330] border border-[#2c3e6b] text-xs text-white px-2 py-0.5 rounded outline-none"
                              />
                              <button
                                type="button"
                                className="p-1 text-emerald-400 hover:text-emerald-300"
                                onClick={() => saveEdit(file.id)}
                                title="Save date"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                className="p-1 text-slate-400 hover:text-white"
                                onClick={() => setEditingId(null)}
                                title="Cancel"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sky-400 font-mono">
                                {file.detectedDate}
                              </span>
                              {canEditFiles && <button
                                type="button"
                                className="text-slate-500 hover:text-slate-200 p-0.5"
                                onClick={() => startEdit(file)}
                                title="Edit shipment date for all records in this file"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>}
                            </div>
                          )}
                        </td>
                        <td className="r font-semibold text-slate-200">
                          {file.recordCount.toLocaleString()}
                        </td>
                        <td className="r text-slate-400 text-xs">{formatSize(file.size)}</td>
                        <td className="text-slate-400 text-xs">
                          {new Date(file.uploadedAt).toLocaleDateString()} {new Date(file.uploadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        {showActions && <td className="r">
                          {canArchiveFiles && <button
                            type="button"
                            className="btn sm danger"
                            onClick={() => handleDelete(file.id)}
                            disabled={isDeleting}
                            title="Archive this file from the active dashboard; its history is preserved"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Archive</span>
                          </button>}
                        </td>}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="modal-footer justify-between">
          {canClearAll && <button
            type="button"
            className="btn danger sm"
            onClick={onClearAll}
            disabled={files.length === 0}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear All Stored Data</span>
          </button>}

          <button type="button" className="btn sm" onClick={onClose}>
            Done
          </button>
        </div>
    </ModalDialog>
  );
};
