import React, { useMemo, useState } from 'react';
import { ArrowDownToLine, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Filter, Layers3, PackageCheck, RefreshCw, Search, Truck, TriangleAlert } from 'lucide-react';
import { MasterSealDispatch } from '../types/dispatch';
import { MasterSealBranchGroup, ShipmentExportCategory, useMasterSealDispatches } from '../hooks/useMasterSealDispatches';
import { TrackingNumberLink } from '../components/TrackingNumberLink';

const ROWS_PER_PAGE = 50;

export const WrongShipmentsPage: React.FC = () => {
  const {
    date, setDate, groups, dispatches, totalDispatches,
    totalExpectedShipments, totalReceivedShipments, totalMissedShipments,
    totalTrackingNumbers, manifestsLoaded, manifestFailures, isLoading, loadingDetail, error, lastUpdated, refresh, exportCsv, exportShipmentCsv, exportMasterTrackingWorkbook,
  } = useMasterSealDispatches();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const filteredDispatches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return dispatches;
    return dispatches.filter((item) =>
      item.sourceHubName.toLowerCase().includes(query) ||
      item.sealNumber.toLowerCase().includes(query) ||
      item.destinationHubName.toLowerCase().includes(query),
    );
  }, [dispatches, search]);
  const pages = Math.max(1, Math.ceil(filteredDispatches.length / ROWS_PER_PAGE));
  const currentPage = Math.min(page, pages);
  const visibleDispatches = filteredDispatches.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE);

  return (
    <div className="space-y-6 pb-8" dir="ltr">
      <header className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-white to-sky-50 p-5 shadow-sm sm:p-7">
        <div className="absolute -right-10 -top-16 h-52 w-52 rounded-full bg-sky-100/70 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-bold text-sky-800">
              <Truck className="h-4 w-4" /> ALEX SORTING FACILITY · OUTBOUND DISPATCHES
            </div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">Shipments from Alex to Destination Hubs</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Official Master Seal records filtered from Alex Sorting Facility and grouped by destination hub.
            </p>
            <p className="mt-3 text-xs font-semibold text-slate-500">Shipment totals come from each Master Seal manifest, not from the number of child seals.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5">
              <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">Dispatch date · Cairo time</span>
              <input
                type="date"
                aria-label="Dispatch date"
                value={date}
                onChange={(event) => {
                  if (!event.target.value) return;
                  setPage(1);
                  setDate(event.target.value);
                }}
                className="mt-0.5 block w-full cursor-pointer bg-transparent text-sm font-black text-slate-800 outline-none"
              />
            </label>
            <button type="button" onClick={refresh} disabled={isLoading} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:border-sky-300 hover:bg-sky-50 disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button type="button" onClick={exportCsv} disabled={isLoading || !dispatches.length} className="inline-flex items-center gap-2 rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-sky-800 disabled:opacity-50">
              <Download className="h-4 w-4" /> Export CSV
            </button>
            <button type="button" onClick={() => exportMasterTrackingWorkbook()} disabled={isLoading || totalTrackingNumbers === 0} className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-800 shadow-sm transition hover:bg-emerald-100 disabled:opacity-50">
              <FileSpreadsheet className="h-4 w-4" /> Download All Tracking Numbers
            </button>
          </div>
        </div>
      </header>

      {isLoading && <div className="flex items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-900"><RefreshCw className="h-4 w-4 shrink-0 animate-spin" />{loadingDetail}</div>}
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</div>}
      {manifestFailures > 0 && !isLoading && <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />Could not load manifests for {manifestFailures} of {totalDispatches} Master Seals. Branch totals are partial until the data is refreshed successfully.</div>}
      {!isLoading && totalExpectedShipments > 0 && totalTrackingNumbers === 0 && <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950"><TriangleAlert className="mt-1 h-4 w-4 shrink-0" /><span>The API returned shipment counts but no tracking numbers for the current seal contents. Tracking numbers removed after dispatch are not present in the current seal search. Master Seal Export sends its file by email and does not return a downloadable file to the browser.</span></div>}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric title="Master Seals Dispatched" value={totalDispatches} note="From Alex today" icon={<Layers3 className="h-5 w-5" />} tone="sky" />
        <Metric title="Shipments Sent" value={totalExpectedShipments} note={`${manifestsLoaded} manifests loaded`} icon={<ArrowDownToLine className="h-5 w-5" />} tone="sky" exportLabel="Export All Branches CSV" onExport={() => exportShipmentCsv('sent')} exportDisabled={isLoading || totalExpectedShipments === 0} />
        <Metric title="Received at Destination" value={totalReceivedShipments} note="Manifest received count" icon={<CheckCircle2 className="h-5 w-5" />} tone="emerald" exportLabel="Export All Destinations CSV" onExport={() => exportShipmentCsv('received')} exportDisabled={isLoading || totalReceivedShipments === 0} />
        <Metric title="Still Outstanding" value={totalMissedShipments} note="Manifest missed count" icon={<PackageCheck className="h-5 w-5" />} tone="amber" exportLabel="Export All Branches CSV" onExport={() => exportShipmentCsv('remaining')} exportDisabled={isLoading || totalMissedShipments === 0} />
      </section>
      <p className="-mt-3 text-xs text-slate-500">Summary card exports include all branches; branch-level actions export only that branch. Tracking numbers are included when returned by seal search. Received and outstanding figures are manifest totals, not per-tracking statuses.</p>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <h2 className="font-black text-slate-900">Breakdown by Destination Hub</h2>
            <p className="mt-1 text-xs text-slate-500">Expand a destination to review its Master Seals, child seals, and tracking numbers.</p>
          </div>
          <label className="relative block w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} placeholder="Search branch or Master Seal…" className="w-full rounded-xl border border-slate-300 py-2.5 pl-10 pr-3 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100" />
          </label>
        </div>
        <div className="divide-y divide-slate-100">
          {groups.map((group) => <BranchGroup key={group.branch} group={group} onExport={exportShipmentCsv} onExportMaster={exportMasterTrackingWorkbook} />)}
          {!isLoading && groups.every((group) => group.dispatches.length === 0) && <div className="px-4 py-12 text-center text-sm text-slate-500">No Master Seals from Alex to the destination hubs were found for today.</div>}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2"><Filter className="h-4 w-4 text-sky-700" /><h2 className="font-bold text-slate-900">Dispatch Register</h2><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{filteredDispatches.length.toLocaleString('en-US')}</span></div>
          {lastUpdated && <span className="text-xs text-slate-500">Updated {new Date(lastUpdated).toLocaleTimeString('en-US', { timeZone: 'Africa/Cairo' })}</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Destination Hub</th><th className="px-4 py-3">Master Seal</th><th className="px-4 py-3">Dispatched At</th><th className="px-4 py-3 text-center">Sent</th><th className="px-4 py-3 text-center">Received</th><th className="px-4 py-3 text-center">Outstanding</th><th className="px-4 py-3 text-center">Data Status</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {visibleDispatches.map((item) => <DispatchRow key={item._id} item={item} />)}
              {!isLoading && filteredDispatches.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">No matching dispatches found.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs text-slate-500">Showing {visibleDispatches.length.toLocaleString('en-US')} of {filteredDispatches.length.toLocaleString('en-US')} · 50 rows per page</p>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage <= 1} className="rounded-lg border border-slate-300 bg-white p-2 hover:bg-slate-100 disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
            <span>Page {currentPage.toLocaleString('en-US')} of {pages.toLocaleString('en-US')}</span>
            <button type="button" onClick={() => setPage((value) => Math.min(pages, value + 1))} disabled={currentPage >= pages} className="rounded-lg border border-slate-300 bg-white p-2 hover:bg-slate-100 disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </section>
    </div>
  );
};

const BranchGroup: React.FC<{
  group: MasterSealBranchGroup;
  onExport: (category: ShipmentExportCategory, branchName?: string) => void;
  onExportMaster: (masterSealNumber?: string) => void;
}> = ({ group, onExport, onExportMaster }) => (
  <details className="group">
    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-4 px-4 py-4 transition hover:bg-slate-50 sm:px-5 [&::-webkit-details-marker]:hidden">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-700"><Truck className="h-5 w-5" /></span>
        <div>
          <h3 className="font-bold text-slate-900">{group.branch}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{group.dispatches.length.toLocaleString('en-US')} Master Seals · {group.manifestsLoaded} manifests loaded</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge title="Sent" value={group.expectedShipments} tone="sky" />
        <Badge title="Received" value={group.receivedShipments} tone="emerald" />
        <Badge title="Outstanding" value={group.missedShipments} tone="amber" />
        <ChevronDown className="h-4 w-4 text-slate-400 transition group-open:rotate-180" />
      </div>
    </summary>

    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-white px-4 py-3 sm:px-5">
      <span className="mr-1 text-xs font-bold text-slate-500">Branch exports:</span>
      <BranchExportButton label="Sent" onClick={() => onExport('sent', group.branch)} disabled={group.expectedShipments === 0} />
      <BranchExportButton label="Received" onClick={() => onExport('received', group.branch)} disabled={group.receivedShipments === 0} />
      <BranchExportButton label="Outstanding" onClick={() => onExport('remaining', group.branch)} disabled={group.missedShipments === 0} />
    </div>

    <MasterTrackingDownloads dispatches={group.dispatches} onExport={onExportMaster} />
    <TrackingContents dispatches={group.dispatches} />

    {group.dispatches.length > 0 && (
      <div className="overflow-x-auto border-t border-slate-100 bg-slate-50/70">
        <table className="w-full min-w-[980px] text-left text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="px-5 py-2.5">Master Seal / Child Seal</th>
              <th className="px-5 py-2.5">Type</th>
              <th className="px-5 py-2.5">Date</th>
              <th className="px-5 py-2.5 text-center">Sent</th>
              <th className="px-5 py-2.5 text-center">Received</th>
              <th className="px-5 py-2.5 text-center">Outstanding</th>
              <th className="px-5 py-2.5 text-center">Manifest</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/70">
            {group.dispatches.map((item) => (
              <React.Fragment key={item._id}>
                <tr className="bg-white">
                  <td className="px-5 py-3 font-mono font-bold text-sky-800" dir="ltr">{item.sealNumber || '—'}</td>
                  <td className="px-5 py-3 text-slate-600">Master Seal</td>
                  <td className="px-5 py-3 text-slate-600">{formatDate(item.createdAt)}</td>
                  <td className="px-5 py-3 text-center font-mono font-bold">{item.manifest?.expectedTrackingNumbersCount ?? '—'}</td>
                  <td className="px-5 py-3 text-center font-mono font-bold text-emerald-700">{item.manifest?.receivedTrackingNumbersCount ?? '—'}</td>
                  <td className="px-5 py-3 text-center font-mono font-bold text-amber-700">{item.manifest?.missedTrackingNumberCount ?? '—'}</td>
                  <td className="px-5 py-3 text-center">
                    {item.manifest ? <span className="font-bold text-emerald-700">Loaded</span> : item.manifestError ? <span className="font-bold text-rose-700" title={item.manifestError}>Failed</span> : <span className="font-bold text-sky-700">Loading</span>}
                  </td>
                </tr>
                {item.manifest?.seals.map((seal) => (
                  <tr key={`${item._id}-${seal.sealNumber}`}>
                    <td className="px-5 py-2.5 pl-10 font-mono text-slate-700" dir="ltr">↳ {seal.sealNumber}</td>
                    <td className="px-5 py-2.5 text-slate-600">{seal.sealType || 'Seal'}</td>
                    <td className="px-5 py-2.5 text-slate-500">{seal.destinationHubName || '—'}</td>
                    <td className="px-5 py-2.5 text-center font-mono">{seal.expectedTrackingNumbersCount}</td>
                    <td className="px-5 py-2.5 text-center font-mono text-emerald-700">{seal.receivedTrackingNumbersCount}</td>
                    <td className="px-5 py-2.5 text-center font-mono text-amber-700">{seal.missedTrackingNumberCount}</td>
                    <td className="px-5 py-2.5 text-center text-slate-400">{seal.trackingNumbers?.length ? `${seal.trackingNumbers.length} tracking numbers` : 'Counts only'}</td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </details>
);

const MasterTrackingDownloads: React.FC<{
  dispatches: MasterSealBranchGroup['dispatches'];
  onExport: (masterSealNumber?: string) => void;
}> = ({ dispatches, onExport }) => {
  const masters = dispatches.map((master) => ({
    master,
    count: (master.manifest?.seals || []).reduce((total, seal) => total + (seal.trackingNumbers?.length || 0), 0),
  }));
  if (masters.length === 0) return null;
  return (
    <div className="grid gap-2 border-t border-slate-100 bg-white p-4 sm:grid-cols-2 xl:grid-cols-3 sm:px-5">
      {masters.map(({ master, count }) => (
        <div key={master._id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate font-mono text-xs font-bold text-slate-800" dir="ltr">{master.sealNumber}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {count > 0 ? `${count} of ${master.manifest?.expectedTrackingNumbersCount || 0} tracking numbers loaded` : `Manifest reports ${master.manifest?.expectedTrackingNumbersCount || 0} shipments; tracking IDs unavailable`}
            </p>
          </div>
          <button type="button" onClick={() => onExport(master.sealNumber)} disabled={count === 0} title={count === 0 ? 'No tracking numbers were returned by the API' : 'Download this workbook locally'} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40">
            <FileSpreadsheet className="h-3.5 w-3.5" />{count > 0 ? 'Download Excel' : 'Unavailable'}
          </button>
        </div>
      ))}
    </div>
  );
};

const TrackingContents: React.FC<{ dispatches: MasterSealDispatch[] }> = ({ dispatches }) => {
  const mastersWithSeals = dispatches.filter((master) => (master.manifest?.seals.length || 0) > 0);
  if (mastersWithSeals.length === 0) return null;
  return (
    <section className="space-y-3 border-t border-slate-100 bg-slate-50/70 p-4 sm:px-5">
      <div>
        <h4 className="text-sm font-black text-slate-800">Tracking Numbers Inside Seals</h4>
        <p className="mt-1 text-xs text-slate-500">Tracking IDs are loaded from child-seal search. The manifest itself may provide counts only.</p>
      </div>
      {mastersWithSeals.map((master) => (
        <div key={master._id} className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="mb-2 font-mono text-xs font-black text-sky-800" dir="ltr">Master Seal: {master.sealNumber}</p>
          <div className="space-y-2">
            {master.manifest?.seals.map((seal) => (
              <TrackingSeal key={`${master._id}-${seal.sealNumber}`} sealNumber={seal.sealNumber} expectedCount={seal.expectedTrackingNumbersCount} trackingNumbers={seal.trackingNumbers || []} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
};

const TrackingSeal: React.FC<{ sealNumber: string; expectedCount: number; trackingNumbers: string[] }> = ({ sealNumber, expectedCount, trackingNumbers }) => (
  <details className="rounded-lg border border-slate-200 bg-slate-50">
    <summary className="cursor-pointer px-3 py-2.5 text-xs font-bold text-slate-700">
      <span dir="ltr" className="font-mono">{sealNumber}</span>
      <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-sky-800">{trackingNumbers.length} of {expectedCount} tracking numbers</span>
    </summary>
    {trackingNumbers.length > 0
      ? <TrackingNumberPages trackingNumbers={trackingNumbers} />
      : <p className="border-t border-slate-200 px-3 py-3 text-xs font-semibold text-amber-800">The API returned counts only; this seal’s tracking list is unavailable.</p>}
  </details>
);

const TrackingNumberPages: React.FC<{ trackingNumbers: string[] }> = ({ trackingNumbers }) => {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(trackingNumbers.length / 50));
  const currentPage = Math.min(page, pages);
  const visible = trackingNumbers.slice((currentPage - 1) * 50, currentPage * 50);
  return (
    <div className="border-t border-slate-200 p-3">
      <div className="grid gap-x-4 font-mono text-xs text-slate-700 sm:grid-cols-2 lg:grid-cols-3" dir="ltr">
        {visible.map((trackingNumber, index) => <div key={trackingNumber} className="border-b border-slate-100 py-1.5">{((currentPage - 1) * 50 + index + 1).toLocaleString('en-US')}. <TrackingNumberLink trackingNumber={trackingNumber} /></div>)}
      </div>
      {pages > 1 && <div className="mt-3 flex items-center justify-between text-xs text-slate-500"><span>Page {currentPage} of {pages} · 50 tracking numbers</span><div className="flex gap-1"><button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1} className="rounded border border-slate-300 bg-white px-2 py-1 disabled:opacity-40">Previous</button><button type="button" onClick={() => setPage((value) => Math.min(pages, value + 1))} disabled={currentPage === pages} className="rounded border border-slate-300 bg-white px-2 py-1 disabled:opacity-40">Next</button></div></div>}
    </div>
  );
};

const BranchExportButton: React.FC<{ label: string; onClick: () => void; disabled: boolean }> = ({ label, onClick, disabled }) => (
  <button type="button" onClick={onClick} disabled={disabled} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40">
    <Download className="h-3.5 w-3.5" />{label} CSV
  </button>
);

const DispatchRow: React.FC<{ item: MasterSealDispatch }> = ({ item }) => (
  <tr className="transition hover:bg-sky-50/40"><td className="px-4 py-3 font-semibold text-slate-800">{item.destinationHubName || 'Unknown'}</td><td className="px-4 py-3 font-mono font-bold text-sky-800" dir="ltr">{item.sealNumber || '—'}</td><td className="px-4 py-3 text-slate-600">{formatDate(item.createdAt)}</td><td className="px-4 py-3 text-center font-mono font-bold">{item.manifest?.expectedTrackingNumbersCount ?? '—'}</td><td className="px-4 py-3 text-center font-mono font-bold text-emerald-700">{item.manifest?.receivedTrackingNumbersCount ?? '—'}</td><td className="px-4 py-3 text-center font-mono font-bold text-amber-700">{item.manifest?.missedTrackingNumberCount ?? '—'}</td><td className="px-4 py-3 text-center">{item.manifest ? <span className="font-bold text-emerald-700">Loaded</span> : item.manifestError ? <span className="font-bold text-rose-700" title={item.manifestError}>Failed</span> : <span className="font-bold text-sky-700">Loading</span>}</td></tr>
);

const Metric: React.FC<{
  title: string;
  value: number;
  note: string;
  icon: React.ReactNode;
  tone: 'sky' | 'emerald' | 'amber' | 'slate';
  onExport?: () => void;
  exportLabel?: string;
  exportDisabled?: boolean;
}> = ({ title, value, note, icon, tone, onExport, exportLabel = 'Export CSV', exportDisabled }) => {
  const colors = { sky: 'bg-sky-50 text-sky-700 ring-sky-100', emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100', amber: 'bg-amber-50 text-amber-700 ring-amber-100', slate: 'bg-slate-100 text-slate-700 ring-slate-200' };
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><div className="flex items-start justify-between"><div><p className="text-sm font-bold text-slate-600">{title}</p><p className="mt-3 text-3xl font-black tracking-tight text-slate-900">{value.toLocaleString('en-US')}</p><p className="mt-1 text-xs text-slate-500">{note}</p></div><span className={`rounded-xl p-3 ring-1 ${colors[tone]}`}>{icon}</span></div>{onExport && <button type="button" onClick={onExport} disabled={exportDisabled} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-45"><Download className="h-3.5 w-3.5" />{exportLabel}</button>}</div>;
};

const Badge: React.FC<{ title: string; value: number; tone: 'sky' | 'emerald' | 'amber' }> = ({ title, value, tone }) => {
  const colors = { sky: 'bg-sky-50 text-sky-800', emerald: 'bg-emerald-50 text-emerald-800', amber: 'bg-amber-50 text-amber-800' };
  return <span className={`rounded-lg px-2.5 py-1.5 font-semibold ${colors[tone]}`}>{title}: <b className="font-black">{value.toLocaleString('en-US')}</b></span>;
};

function formatDate(value: string): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('en-US', { timeZone: 'Africa/Cairo' });
}
