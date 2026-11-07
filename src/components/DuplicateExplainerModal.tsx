import React from 'react';
import { ShieldCheck, X, FileCheck, Layers, CalendarCheck } from 'lucide-react';
import { ModalDialog } from './ModalDialog';

interface DuplicateExplainerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DuplicateExplainerModal: React.FC<DuplicateExplainerModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <ModalDialog labelledBy="duplicate-modal-title" maxWidth={720} onClose={onClose}>
        <div className="modal-header">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 id="duplicate-modal-title">Data Accuracy &amp; Duplicate Handling Architecture</h3>
              <p className="text-xs text-slate-400 m-0">
                How duplicate files and cross-day shipment tracking numbers are handled
              </p>
            </div>
          </div>
          <button type="button" className="modal-close icon-button" onClick={onClose} aria-label="Close duplicate handling details">
            <X className="w-5 h-5" />
          </button>
      </div>

        <div className="modal-body space-y-4 text-xs text-slate-300 leading-relaxed">
          <div className="p-3 bg-[#0a1330] border border-[#1d2a4d] rounded-lg">
            <div className="flex items-center gap-2 text-sky-400 font-semibold mb-1">
              <FileCheck className="w-4 h-4" />
              <span className="text-sm">1. Duplicate File Uploads (File Re-Ingestion)</span>
            </div>
            <p className="text-slate-300 m-0">
              When an Excel file with the same filename is uploaded again, MySQL creates a new import revision. The previous revision remains in history while the selected revision is shown in the active dashboard.
            </p>
          </div>

          <div className="p-3 bg-[#0a1330] border border-[#1d2a4d] rounded-lg">
            <div className="flex items-center gap-2 text-emerald-400 font-semibold mb-1">
              <Layers className="w-4 h-4" />
              <span className="text-sm">2. Duplicate Shipments Within the Same Daily File</span>
            </div>
            <p className="text-slate-300 m-0">
              Tracking Number identifies a shipment across its history. Duplicate rows in one import run are marked and preserved in the source-row history while only one shipment snapshot is counted in that run.
            </p>
          </div>

          <div className="p-3 bg-[#0a1330] border border-[#1d2a4d] rounded-lg">
            <div className="flex items-center gap-2 text-purple-400 font-semibold mb-1">
              <CalendarCheck className="w-4 h-4" />
              <span className="text-sm">3. Legitimate Tracking Numbers Across Different Dates</span>
            </div>
            <p className="text-slate-300 m-0">
              In logistics operations, a parcel may appear in different daily reports (e.g. transit handovers or multi-day tracking). <b>The system does not delete records simply because they share a Tracking Number across different dates.</b> Each daily file preserves its operational shipment records for that date, ensuring that daily performance, hub throughput, and monthly trends reflect genuine daily volume.
            </p>
          </div>

          <div className="p-3 bg-[#101b3b] border border-[#223363] rounded-lg">
            <h5 className="font-semibold text-slate-200 mb-1">Summary of Guarantees:</h5>
            <ul className="list-disc pl-4 space-y-1 text-slate-300">
              <li>No duplicate counts if the exact same daily file is uploaded multiple times.</li>
              <li>Accurate day-by-day operational throughput without dropping legitimate cross-day shipments.</li>
              <li>New uploads store the original Excel workbook and every source row in MySQL.</li>
              <li>Archiving a file removes it from active reports while retaining its data and audit history.</li>
            </ul>
          </div>

        </div>
        <div className="modal-footer">
          <button type="button" className="btn pri sm" onClick={onClose}>
            Got it
          </button>
        </div>
    </ModalDialog>
  );
};
