import React, { useMemo, useRef, useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, Loader2, Trash2, Upload, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { TrackingNumberLink } from '../components/TrackingNumberLink';

const OUTPUT_HEADERS = [
  'Tracking Number',
  'Warehouse Tarnsit Seal Number',
  'In Transit To',
  'Assigned Hub',
  'Last Transfer Date',
] as const;
type OutputHeader = (typeof OUTPUT_HEADERS)[number];
type MailRow = Record<OutputHeader, string>;
const ALL_BULKY_SEALS = '__ALL_BULKY_SEALS__';

const headerAliases: Record<OutputHeader, string[]> = {
  'Tracking Number': ['tracking number', 'trackingnumber', 'awb', 'barcode'],
  'Warehouse Tarnsit Seal Number': [
    'warehouse tarnsit seal number',
    'warehouse transit seal number',
    'transit seal number',
    'seal number',
  ],
  'In Transit To': ['in transit to', 'intransitto', 'destination hub', 'destination'],
  'Assigned Hub': ['assigned hub', 'assignedhub'],
  'Last Transfer Date': ['last transfer date', 'lasttransferdate', 'last transfer'],
};

function normalizeHeader(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}

function getCell(row: Record<string, unknown>, header: OutputHeader): string {
  const entries = Object.entries(row);
  const aliases = headerAliases[header].map(normalizeHeader);
  const entry = entries.find(([key]) => aliases.includes(normalizeHeader(key)));
  return String(entry?.[1] ?? '').trim();
}

function formatDateOnly(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${String(parsed.d).padStart(2, '0')}/${String(parsed.m).padStart(2, '0')}/${parsed.y}`;
  }
  const text = String(value).trim();
  const datePart = text.split(/[T, ]/)[0];
  return datePart || text;
}

function normalizeRows(rows: Record<string, unknown>[]): MailRow[] {
  return rows.map((row) => ({
    'Tracking Number': getCell(row, 'Tracking Number'),
    'Warehouse Tarnsit Seal Number': getCell(row, 'Warehouse Tarnsit Seal Number'),
    'In Transit To': getCell(row, 'In Transit To'),
    'Assigned Hub': getCell(row, 'Assigned Hub'),
    'Last Transfer Date': formatDateOnly(getCell(row, 'Last Transfer Date')),
  })).filter((row) => Object.values(row).some(Boolean));
}

function splitTrackingNumbers(value: string): Set<string> {
  return new Set(value.split(/[\s,;\n\r]+/).map(normalizeTrackingNumber).filter(Boolean));
}

function normalizeTrackingNumber(value: string): string {
  const trackingNumber = value.trim();
  return trackingNumber.replace(/^[^-]+-[^-]+-/, '');
}

function normalizeTrackingInput(value: string): string {
  return value.split(/[\s,;\n\r]+/).map(normalizeTrackingNumber).filter(Boolean).join('\n');
}

function uniqueValues(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

type CheckGroupProps = {
  hub: string;
  rows: MailRow[];
  sealInput: string;
  trackingInputs: Record<string, string>;
  isOpen: boolean;
  openSeal: string;
  onToggle: () => void;
  onSealSelect: (seal: string) => void;
  onSealChange: (value: string) => void;
  onTrackingChange: (seal: string, value: string) => void;
};

const CheckGroup: React.FC<CheckGroupProps> = ({ hub, rows, sealInput, trackingInputs, isOpen, openSeal, onToggle, onSealSelect, onSealChange, onTrackingChange }) => {
  const sourceSeals = uniqueValues(rows.map((row) => row['Warehouse Tarnsit Seal Number']));
  const enteredSeals = uniqueValues(sealInput.split(/[\s,;\n\r]+/));
  const bulkySeals = sourceSeals.filter((seal) => seal.toLowerCase().startsWith('bulky'));
  const normalSeals = sourceSeals.filter((seal) => !seal.toLowerCase().startsWith('bulky'));
  const sourceSealKeys = new Set(normalSeals.map((value) => value.toLowerCase()));
  const enteredSealKeys = new Set(enteredSeals.map((value) => value.toLowerCase()));
  const matchedSeals = normalSeals.filter((value) => enteredSealKeys.has(value.toLowerCase()));
  const missingSeals = normalSeals.filter((value) => !enteredSealKeys.has(value.toLowerCase()));
  const extraSeals = enteredSeals.filter((value) => !sourceSealKeys.has(value.toLowerCase()) && !bulkySeals.some((seal) => seal.toLowerCase() === value.toLowerCase()));
  const displayedNormalSeals = uniqueValues([...normalSeals, ...extraSeals]);

  const trackingRowsForSeal = (seal: string) => rows.filter((row) => row['Warehouse Tarnsit Seal Number'].trim().toLowerCase() === seal.toLowerCase());
  const trackingSource = (seal: string) => uniqueValues(trackingRowsForSeal(seal).map((row) => normalizeTrackingNumber(row['Tracking Number'])));
  const trackingComparison = (seal: string) => {
    const sourceValues = seal === ALL_BULKY_SEALS
      ? uniqueValues(rows.filter((row) => row['Warehouse Tarnsit Seal Number'].trim().toLowerCase().startsWith('bulky')).map((row) => normalizeTrackingNumber(row['Tracking Number'])))
      : trackingSource(seal);
    const enteredValues = uniqueValues((trackingInputs[seal] || '').split(/[\s,;\n\r]+/).map(normalizeTrackingNumber));
    const sourceKeys = new Set(sourceValues.map((value) => value.toLowerCase()));
    const enteredKeys = new Set(enteredValues.map((value) => value.toLowerCase()));
    return {
      sourceValues,
      enteredValues,
      matched: sourceValues.filter((value) => enteredKeys.has(value.toLowerCase())),
      missing: sourceValues.filter((value) => !enteredKeys.has(value.toLowerCase())),
      extra: enteredValues.filter((value) => !sourceKeys.has(value.toLowerCase())),
    };
  };

  const renderSealList = (title: string, seals: string[]) => (
    <div>
      <p className="mb-2 text-sm font-black text-slate-700">{title} ({seals.length})</p>
      <div className="flex flex-wrap gap-2">
        {title.startsWith('Bulky') && seals.length > 0 && <button type="button" onClick={() => onSealSelect(ALL_BULKY_SEALS)} className="rounded-md bg-amber-600 px-2 py-1 text-xs font-bold text-white shadow-sm hover:bg-amber-700">The Whole</button>}
        {seals.map((seal) => <button key={seal} type="button" onClick={() => seal.toLowerCase().startsWith('bulky') && onSealSelect(seal)} className={`rounded-md px-2 py-1 text-xs font-bold shadow-sm ${seal.toLowerCase().startsWith('bulky') ? 'bg-amber-100 text-amber-900 hover:bg-amber-200' : 'bg-white text-slate-700'}`}>{seal}</button>)}
      </div>
    </div>
  );

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-3 px-4 py-4 text-right hover:bg-slate-50">
        <div>
          <p className="font-black text-slate-900">{hub}</p>
          <p className="mt-1 text-xs text-slate-500">{sourceSeals.length.toLocaleString('en-US')} unique seals / {bulkySeals.length} bulky</p>
        </div>
        <ChevronDown className={`h-5 w-5 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="space-y-4 border-t border-slate-200 p-4">
          <div>
            <p className="mb-3 text-sm font-black text-slate-700">The Values in the File</p>
            <div className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-2">
              {renderSealList('Bulky Seals - Select a seal to view tracking numbers', bulkySeals)}
              {renderSealList('Normal Seals', displayedNormalSeals)}
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-black text-slate-700">Enter the Seals for Matching
                <textarea value={sealInput} onChange={(event) => onSealChange(event.target.value)} placeholder="Enter a number in each line or separate them with a comma" rows={4} className="mt-2 w-full resize-y rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
              </label>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-emerald-50 px-2 py-2 text-emerald-800"><p className="font-black">Matched</p><p className="mt-1 text-lg font-black">{matchedSeals.length}</p></div>
                <div className="rounded-lg bg-amber-50 px-2 py-2 text-amber-800"><p className="font-black">Missing</p><p className="mt-1 text-lg font-black">{missingSeals.length}</p></div>
                <div className="rounded-lg bg-rose-50 px-2 py-2 text-rose-800"><p className="font-black">Extra</p><p className="mt-1 text-lg font-black">{extraSeals.length}</p></div>
              </div>
              {(missingSeals.length > 0 || extraSeals.length > 0) && <div className="mt-3 space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                {missingSeals.length > 0 && <p className="font-bold text-amber-800">The Missing Seals: <span className="font-black">{missingSeals.join(', ')}</span></p>}
                {extraSeals.length > 0 && <p className="font-bold text-rose-800">The Extra Seals: <span className="font-black">{extraSeals.join(', ')}</span></p>}
              </div>}
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
              <p className="text-sm font-black text-amber-900">Matching Tracking Numbers within the Seal</p>
              <p className="mt-1 text-xs text-slate-600">Click on any seal that starts with Bulky to show the tracking details.</p>
              {(openSeal === ALL_BULKY_SEALS || openSeal.toLowerCase().startsWith('bulky')) && (() => {
                const comparison = trackingComparison(openSeal);
                return <div className="mt-3">
                  <label className="block text-sm font-bold text-slate-700">{openSeal === ALL_BULKY_SEALS ? 'All the Bulky Seals' : openSeal}
                    <textarea value={trackingInputs[openSeal] || ''} onChange={(event) => onTrackingChange(openSeal, normalizeTrackingInput(event.target.value))} placeholder="Enter the tracking numbers that are inside this seal" rows={4} className="mt-2 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm" />
                  </label>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-lg bg-emerald-100 px-2 py-2 text-emerald-800"><p className="font-black">Matched</p><p className="mt-1 text-lg font-black">{comparison.matched.length}</p></div><div className="rounded-lg bg-amber-100 px-2 py-2 text-amber-800"><p className="font-black">Missing</p><p className="mt-1 text-lg font-black">{comparison.missing.length}</p></div><div className="rounded-lg bg-rose-100 px-2 py-2 text-rose-800"><p className="font-black">Extra</p><p className="mt-1 text-lg font-black">{comparison.extra.length}</p></div></div>
                  {comparison.missing.length > 0 && <p className="mt-2 text-xs text-slate-600">The Missing: {comparison.missing.join(', ')}</p>}
                  {comparison.extra.length > 0 && <p className="mt-1 text-xs text-slate-600">The Extra: {comparison.extra.join(', ')}</p>}
                </div>;
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function safeFilename(value: string): string {
  return value.replace(/[<>:"/\\|?*]+/g, '-').trim() || 'Unknown_Hub';
}

function downloadRows(filename: string, rows: MailRow[]): void {
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: [...OUTPUT_HEADERS] });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Mails');
  XLSX.writeFile(workbook, filename);
}

export const MailsPage: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<MailRow[]>([]);
  const [trackingInput, setTrackingInput] = useState('');
  const [removedCount, setRemovedCount] = useState(0);
  const [isReading, setIsReading] = useState(false);
  const [error, setError] = useState('');
  const [openChecks, setOpenChecks] = useState<Record<string, boolean>>({});
  const [selectedBulkySeals, setSelectedBulkySeals] = useState<Record<string, string>>({});
  const [checkInputs, setCheckInputs] = useState<Record<string, string>>({});

  const hubs = useMemo(() => {
    const grouped = new Map<string, MailRow[]>();
    rows.forEach((row) => {
      const hub = row['In Transit To'] || 'Unknown Hub';
      const group = grouped.get(hub) || [];
      group.push(row);
      grouped.set(hub, group);
    });
    return [...grouped.entries()].sort(([first], [second]) => first.localeCompare(second));
  }, [rows]);

  const readFile = async (file: File) => {
    setIsReading(true);
    setError('');
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet) throw new Error('The file does not contain a valid Sheet.');
      const sourceRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' });
      const normalized = normalizeRows(sourceRows);
      if (normalized.length === 0) throw new Error('No rows or columns were found.');
      setRows(normalized);
      setFileName(file.name);
      setRemovedCount(0);
      setTrackingInput('');
      setOpenChecks({});
      setSelectedBulkySeals({});
      setCheckInputs({});
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : 'Could not read the file.');
      setRows([]);
      setFileName('');
    } finally {
      setIsReading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeTrackingNumbers = () => {
    const numbers = splitTrackingNumbers(trackingInput);
    if (numbers.size === 0) return;
    const remaining = rows.filter((row) => !numbers.has(row['Tracking Number']));
    setRemovedCount((current) => current + rows.length - remaining.length);
    setRows(remaining);
    setTrackingInput('');
  };

  const clearAll = () => {
    setRows([]);
    setFileName('');
    setTrackingInput('');
    setRemovedCount(0);
    setError('');
    setOpenChecks({});
    setSelectedBulkySeals({});
    setCheckInputs({});
  };

  return (
    <div className="space-y-5" dir="ltr">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-600">Operations Tool</p>
        <h1 className="mt-1 text-2xl font-black text-slate-900">Mails</h1>
        <p className="mt-1 text-sm text-slate-500">Upload the file, delete the required shipments, then download a complete or separate file for each Hub.</p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(event) => event.target.files?.[0] && void readFile(event.target.files[0])} />
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isReading} className="flex min-h-32 w-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-sky-300 bg-sky-50 px-4 text-sky-800 hover:bg-sky-100 disabled:opacity-60">
          {isReading ? <Loader2 className="h-8 w-8 animate-spin" /> : <Upload className="h-8 w-8" />}
          <span className="mt-2 text-sm font-black">{isReading ? 'Reading file...' : 'Upload CSV or XLSX'}</span>
          <span className="mt-1 text-xs text-slate-500">{fileName || 'The headers will be auto-detected'}</span>
        </button>
      </section>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800">{error}</div>}

      {rows.length > 0 && (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="block flex-1 text-sm font-bold text-slate-700">Enter the Tracking Numbers to Delete
                <textarea value={trackingInput} onChange={(event) => setTrackingInput(event.target.value)} placeholder="Enter a number in each line or separate them with a comma" rows={3} className="mt-2 w-full resize-y rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
              </label>
              <button type="button" onClick={removeTrackingNumbers} className="inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-black text-white hover:bg-rose-700"><Trash2 className="h-4 w-4" />Delete Rows</button>
            </div>
            {removedCount > 0 && <p className="mt-3 text-xs font-bold text-emerald-700">Deleted {removedCount} rows.</p>}
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-emerald-600" /><h2 className="font-black text-slate-900">{rows.length.toLocaleString('en-US')} shipments / {hubs.length} hubs</h2></div>
              <div className="flex gap-2"><button type="button" onClick={clearAll} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"><X className="h-4 w-4" />Clear</button><button type="button" onClick={() => downloadRows('All_Hubs.xlsx', rows)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700"><Download className="h-4 w-4" />Download Complete File</button></div>
            </div>
            <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-right text-sm"><thead className="bg-slate-50 text-xs font-black text-slate-500"><tr>{OUTPUT_HEADERS.map((header) => <th key={header} className="px-4 py-3">{header}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.slice(0, 100).map((row, index) => <tr key={`${row['Tracking Number']}-${index}`} className="hover:bg-slate-50">{OUTPUT_HEADERS.map((header) => <td key={header} className="whitespace-nowrap px-4 py-3 text-slate-700">{header === 'Tracking Number' && row[header] ? <TrackingNumberLink trackingNumber={row[header]} /> : row[header] || '-'}</td>)}</tr>)}</tbody></table></div>
            {rows.length > 100 && <p className="px-4 py-3 text-xs text-slate-500">The first 100 rows are displayed for preview. All rows will be exported.</p>}
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {hubs.map(([hub, hubRows]) => <div key={hub} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div><p className="text-sm font-black text-slate-800">{hub}</p><p className="mt-1 text-xs text-slate-500">{hubRows.length.toLocaleString('en-US')} shipments</p></div><button type="button" title={`Download ${hub}`} onClick={() => downloadRows(`${safeFilename(hub)}.xlsx`, hubRows)} className="rounded-lg p-2 text-emerald-700 hover:bg-emerald-50"><Download className="h-5 w-5" /></button></div>)}
          </section>

          <section className="space-y-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-600">Validation</p>
              <h2 className="mt-1 text-xl font-black text-slate-900">CHECK SEALS</h2>
              <p className="mt-1 text-sm text-slate-500">The Seals are grouped without repetition by Hub. Only the Bulky Seals can be matched with the tracking numbers inside them.</p>
            </div>
            {hubs.map(([hub, hubRows]) => {
              const key = `seal:${hub}`;
              return <CheckGroup key={key} hub={hub} rows={hubRows} sealInput={checkInputs[key] || ''} trackingInputs={checkInputs} isOpen={Boolean(openChecks[hub])} openSeal={selectedBulkySeals[hub] || ''} onToggle={() => setOpenChecks((current) => ({ ...current, [hub]: !current[hub] }))} onSealSelect={(seal) => { setOpenChecks((current) => ({ ...current, [hub]: true })); setSelectedBulkySeals((current) => ({ ...current, [hub]: seal })); }} onSealChange={(value) => setCheckInputs((current) => ({ ...current, [key]: value }))} onTrackingChange={(seal, value) => setCheckInputs((current) => ({ ...current, [seal]: value }))} />;
            })}
          </section>
        </>
      )}
    </div>
  );
};
