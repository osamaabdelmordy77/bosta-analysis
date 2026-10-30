import React from 'react';
import { UploadedFile } from '../types';
import { Upload, FolderKanban, ShieldCheck, Trash2 } from 'lucide-react';

interface HeaderProps {
  files: UploadedFile[];
  totalShipments: number;
  filteredShipments: number;
  onOpenUpload: () => void;
  onOpenFileManager: () => void;
  onOpenDuplicateInfo: () => void;
  onClearAll: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  files,
  totalShipments,
  filteredShipments,
  onOpenUpload,
  onOpenFileManager,
  onOpenDuplicateInfo,
  onClearAll,
}) => {
  const dates = files.map((f) => f.detectedDate).filter(Boolean).sort();
  const dateRangeStr =
    dates.length > 0
      ? dates.length === 1
        ? dates[0]
        : `${dates[0]} to ${dates[dates.length - 1]}`
      : '';

  return (
    <header className="top">
      <div className="brand">
        <div className="logo">
          <svg viewBox="0 0 24 24">
            <path d="M3 7l9-4 9 4-9 4-9-4z" />
            <path d="M3 7v10l9 4 9-4V7" />
            <path d="M12 11v10" />
          </svg>
        </div>
        <span>Shipment Operations Dashboard</span>
      </div>

      <div className="sp" />

      {files.length > 0 && (
        <div className="chip" title={`Files: ${files.length} | Range: ${dateRangeStr}`}>
          <b>{files.length} {files.length === 1 ? 'file' : 'files'}</b>
          <span>·</span>
          <span>{dateRangeStr || 'No dates'}</span>
          <span>·</span>
          <b>
            {filteredShipments.toLocaleString()} / {totalShipments.toLocaleString()}
          </b>{' '}
          shipments
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn sm"
          onClick={onOpenDuplicateInfo}
          title="Learn how duplicate files and tracking records are handled"
        >
          <ShieldCheck className="w-4 h-4 text-sky-400" />
          <span>Duplicate Logic</span>
        </button>

        {files.length > 0 && (
          <button
            type="button"
            className="btn sm"
            onClick={onOpenFileManager}
            title="Manage uploaded files and edit dates"
          >
            <FolderKanban className="w-4 h-4 text-indigo-400" />
            <span>Files ({files.length})</span>
          </button>
        )}

        <button
          type="button"
          className="btn pri sm"
          onClick={onOpenUpload}
        >
          <Upload className="w-4 h-4" />
          <span>{files.length > 0 ? 'Upload More Files' : 'Upload Excel Files'}</span>
        </button>

        {files.length > 0 && (
          <button
            type="button"
            className="btn danger sm"
            onClick={onClearAll}
            title="Clear all uploaded data and start fresh"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>
        )}
      </div>
    </header>
  );
};
