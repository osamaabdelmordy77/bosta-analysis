import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, RefreshCw, Truck, Upload } from 'lucide-react';
import { getManifestCars, getManifestHistory, getManifestReport, uploadManifest, type CarsSheetSnapshot } from '../services/api';
import type { ManifestCar, ManifestReport, ManifestSummary, SealResult } from '../types/loadingManifest';
import { downloadManifest, SEAL_LABELS } from '../utils/loadingManifestExport';

function cairoToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function LoadingManifestSection({ organizationSlug, canUpload }: { organizationSlug: string; canUpload: boolean }) {
  const [date, setDate] = useState(cairoToday);
  const [sheetName, setSheetName] = useState('');
  const [source, setSource] = useState<{ snapshot: CarsSheetSnapshot; cars: ManifestCar[] } | null>(null);
  const [history, setHistory] = useState<ManifestSummary[]>([]);
  const [vehicles, setVehicles] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [uploadCar, setUploadCar] = useState<ManifestCar | null>(null);
  const [report, setReport] = useState<ManifestReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    setLoading(true); setConfirmed(false); setSource(null);
    if (!date) { setLoading(false); return; }
    getManifestCars(organizationSlug, date, sheetName || undefined).then((result) => { if (active) { setSource(result); setError(''); } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load CARS.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organizationSlug, reload, date, sheetName]);
  useEffect(() => {
    let active = true;
    setHistory([]); setReport(null); setConfirmed(false); setVehicles({});
    if (date) getManifestHistory(organizationSlug, date).then((result) => { if (active) setHistory(result.uploads); }).catch((cause) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, [organizationSlug, date]);

  const upload = async (file: File) => {
    if (!source || source.snapshot.sheet_date !== date || !source.snapshot.sheet_name || !uploadCar || !confirmed || !date || !vehicles[uploadCar.key]?.trim()) return;
    setBusy(true); setError('');
    try {
      if (file.size > 10 * 1024 * 1024 || !file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Upload an XLSX manifest up to 10 MB.');
      const result = await uploadManifest(organizationSlug, file, date, uploadCar, vehicles[uploadCar.key].trim(), source.snapshot.fetched_at, source.snapshot.sheet_name);
      setReport(result);
      setHistory((previous) => [result, ...previous]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Upload failed.'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const open = async (item: ManifestSummary) => {
    setBusy(true); setError('');
    try { setReport(await getManifestReport(organizationSlug, item.date, item.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reopen comparison.'); }
    finally { setBusy(false); }
  };
  return <div className="manifest-page">
    <section className="receive-filter-panel">
      <div className="receive-filter-heading"><div><span className="source-kind">CARS × Master Seal export</span><h2>mainfest</h2><p>مقارنة سيلات كل عربية مع ملفها، مع حفظ نسخة مستقلة لكل رفع ويوم.</p></div><button className="btn sm" type="button" disabled={loading || busy} onClick={() => { setSource(null); setReload((value) => value + 1); }}><RefreshCw size={14} /> Refresh CARS</button></div>
      <label className="page-filter-control"><span>Comparison day · يوم العربية</span><input type="date" value={date} disabled={busy} onInput={(event) => { setDate(event.currentTarget.value); setSheetName(''); }} /></label>
      {source && <label className="page-filter-control"><span>CARS dated tab · تبويب اليوم</span><select disabled={busy} value={source.snapshot.sheet_name || ''} onChange={(event) => { const tab = source.snapshot.available_sheets?.find((item) => item.name === event.target.value); if (tab?.date) { setDate(tab.date); setSheetName(tab.name); } }}><option value="">Choose a dated tab</option>{source.snapshot.available_sheets?.filter((tab) => tab.date).sort((a,b) => b.date!.localeCompare(a.date!)).map((tab) => <option key={tab.name} value={tab.name}>{tab.date} · {tab.name}</option>)}</select></label>}
      <p className="volume-note">CARS يُقرأ من تبويب اليوم المختار فقط. أسماء تبويبات الأيام تُقرأ بصيغة يوم-شهر-سنة؛ التبويبات دون سنة لا تُربط تلقائيًا. رقم اللوحة تأكيد يدوي، والـMaster Seal فحص مستقل. تاريخ اسم الملف يُفحص باحتمالي MM-DD وDD-MM عند الالتباس.</p>
      <label className="manifest-confirm"><input type="checkbox" checked={confirmed} disabled={!date || !source?.snapshot.sheet_name || source.snapshot.sheet_date !== date || loading || busy} onChange={(event) => setConfirmed(event.target.checked)} /><span>أؤكد العربية المطلوبة من تبويب <strong>{source?.snapshot.sheet_name || '—'}</strong> ليوم <strong>{date || '—'}</strong>.</span></label>
      {source && <p className="volume-note">CARS tab: <strong>{source.snapshot.sheet_name || 'No matching tab'}</strong> · day: {source.snapshot.sheet_date || '—'} · fetched: {new Date(source.snapshot.fetched_at).toLocaleString()} · <a href={source.snapshot.source_url} target="_blank" rel="noopener noreferrer">Open Google Sheet</a></p>}
      {source && !source.snapshot.sheet_name && <p className="volume-error" role="status">{source.snapshot.selection_required ? 'أكثر من تبويب لنفس اليوم؛ اختار التبويب المطلوب.' : 'لا يوجد تبويب مطابق لهذا اليوم. اختار يومًا من التبويبات المتاحة؛ لن تُستخدم بيانات يوم آخر.'}</p>}
      {error && <div className="volume-error" role="alert">{error}</div>}
      {(loading || busy) && <p role="status">{busy ? 'Processing / loading comparison…' : 'Loading CARS…'}</p>}
      {!canUpload && <p className="volume-note">عرض النتائج متاح؛ رفع ملفات جديدة يحتاج صلاحية إدارة الاستيراد.</p>}
    </section>
    <input type="file" accept=".xlsx" ref={input} hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />
    <div className="cars-grid" aria-label="Manifest car uploads">
      {source?.cars.map((car) => <article className="cars-card manifest-car" key={car.key}>
        <span className="cars-card-title"><Truck size={17} /> {car.key}{car.label && car.label !== car.key ? ` · ${car.label}` : ''}</span><strong>{new Set(car.seals.map((seal) => seal.seal.trim().toUpperCase())).size} seals</strong>
        <span>Master Seal: <b>{car.master_seal || 'Missing — cannot confirm master match'}</b></span><small>{car.details.join(' · ')}</small>
        <label className="page-filter-control"><span>رقم العربية / اللوحة · {car.key}</span><input value={vehicles[car.key] || ''} disabled={busy} maxLength={80} onChange={(event) => setVehicles((previous) => ({ ...previous, [car.key]: event.target.value }))} placeholder="رقم العربية الفعلي (تأكيد يدوي)" /></label>
        <button className="btn pri sm" type="button" disabled={!canUpload || !confirmed || source.snapshot.sheet_date !== date || !vehicles[car.key]?.trim() || busy || loading} onClick={() => { setUploadCar(car); input.current?.click(); }}><Upload size={14} /> Upload for {car.key}</button>
        <small>{history.filter((item) => item.car === car.key).length} saved uploads for {date}</small>
      </article>)}
    </div>
    {source && source.cars.length === 0 && <p className="volume-empty">No CAR groups found in the current CARS sheet.</p>}
    <section className="sec"><h3>Saved comparisons · {date}</h3><p className="volume-note">كل رفع محفوظ مستقلًا؛ إعادة الرفع لا تستبدل نتيجة سابقة. النتائج القديمة تستخدم نسخة CARS المحفوظة وقت المقارنة.</p>
      <div className="responsive-table-wrap"><table><thead><tr><th>Car</th><th>Vehicle / plate</th><th>File</th><th>Created</th><th>Identity checks</th><th>Open</th></tr></thead><tbody>{history.map((item) => <tr key={item.id}><td>{item.car}</td><td>{item.vehicle_number}</td><td>{item.filename}</td><td>{new Date(item.created_at).toLocaleString()}</td><td>{item.verified_identity ? 'Checks passed; day / vehicle user-confirmed' : 'Mismatch — review'}</td><td><button className="btn sm" type="button" disabled={busy} onClick={() => void open(item)}>View result</button></td></tr>)}{!history.length && <tr><td colSpan={6}>No saved comparisons for this day.</td></tr>}</tbody></table></div>
    </section>
    {report && <ManifestResult key={report.id} report={report} />}
  </div>;
}

export function ManifestResult({ report }: { report: ManifestReport }) {
  const [seal, setSeal] = useState('');
  const [result, setResult] = useState<SealResult | 'all'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [exportError, setExportError] = useState('');
  const seals = report.seals.filter((item) => result === 'all' || item.result === result);
  const tracks = useMemo(() => report.records.filter((row) => (!seal || row.seal.trim().toUpperCase() === seal.trim().toUpperCase()) && (!search.trim() || [row.tracking, row.seal, row.master_seal, row.source_hub, row.destination_hub, row.status].some((value) => value.toLowerCase().includes(search.trim().toLowerCase())))), [report, seal, search]);
  const pages = Math.max(1, Math.ceil(tracks.length / 100));
  const currentPage = Math.min(page, pages - 1);
  const exportFile = (selected = '') => { try { setExportError(''); downloadManifest(report, selected); } catch { setExportError('Could not create Excel export.'); } };
  return <section className="manifest-result" aria-label="Manifest comparison result">
    <div className="receive-filter-heading"><div><h2>{report.car} · {report.vehicle_number} · {report.date}</h2><p className="lead">{report.filename} · CARS tab: {report.cars_snapshot.sheet_name || 'Legacy result — day tab not verified'} · saved {new Date(report.created_at).toLocaleString()}</p></div><button className="btn pri" type="button" onClick={() => exportFile()}><Download size={15} /> Download full comparison Excel</button></div>
    <div className={`manifest-identity ${report.verified_identity && report.cars_snapshot.sheet_date === report.date ? 'workspace-notice' : 'volume-error'}`} role="status"><strong>{report.verified_identity && report.cars_snapshot.sheet_date === report.date ? 'Master Seal and dated CARS tab matched; no filename conflict' : 'Review identity / source day before relying on this result'}</strong><p>Master Seal: CARS <b>{report.checks.master_seal.cars || 'Missing'}</b> · file <b>{report.checks.master_seal.file.join(', ') || 'Missing'}</b> · {report.checks.master_seal.match ? 'MATCH' : 'MISMATCH'}</p><p>CARS source tab: {report.cars_snapshot.sheet_name || 'Not recorded in this legacy result'} · tab date: {report.cars_snapshot.sheet_date || 'Unverified'}</p><p>File date candidates: {report.checks.date.filename_candidates.join(' / ') || 'No date in filename'} · {report.checks.date.match ? 'Selected day accepted' : 'DATE MISMATCH'}</p><p>Car in filename: {report.checks.car.filename || 'Not present; selected at upload'} · {report.checks.car.match ? 'No car conflict' : 'CAR MISMATCH'}. Vehicle / plate is user-confirmed. Legacy results without a dated source tab must be re-uploaded for a verified daily comparison.</p></div>
    {exportError && <p className="volume-error" role="alert">{exportError}</p>}
    <div className="cars-summary">{Object.entries(report.totals).map(([key, count]) => <div key={key}><span>{key.replaceAll('_', ' ')}</span><strong>{count.toLocaleString()}</strong></div>)}</div>
    <p className="volume-note">المقارنة تخص وجود السيل في المصدرين، وليست إثبات تحميل فعلي أو تسليم. عمود Number في CARS تسلسل صفوف، ولا يُستخدم كعدد شحنات. تراكات السيل الناقص غير معروفة لأن CARS لا يحتويها.</p>
    <div className="sec"><div className="receive-filter-heading"><h3>Seal comparison</h3><label className="page-filter-control"><span>Seal result</span><select value={result} onChange={(event) => setResult(event.target.value as typeof result)}><option value="all">All seals</option>{Object.entries(SEAL_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
      <div className="responsive-table-wrap"><table><thead><tr><th>Seal</th><th>Result</th><th>CARS rows</th><th>File rows</th><th>Unique tracks</th><th>Duplicates</th><th>Other cars in CARS</th><th>Details</th></tr></thead><tbody>{seals.map((item) => <tr key={item.seal}><td>{item.seal}</td><td>{SEAL_LABELS[item.result]}</td><td>{item.sheet_rows.join(', ') || '—'}</td><td>{item.file_rows}</td><td>{item.result === 'missing_from_file' ? 'Unknown' : item.unique_trackings}</td><td>{item.duplicate_rows}</td><td>{item.other_cars.join(', ') || '—'}</td><td><button className="btn sm" type="button" onClick={() => { setSeal(item.seal); setSearch(''); setPage(0); }}>View tracks</button></td></tr>)}{!seals.length && <tr><td colSpan={8}>No seals match this result filter.</td></tr>}</tbody></table></div>
    </div>
    <div className="sec"><div className="receive-filter-heading"><div><h3>Tracking details · {seal || 'All seals'}</h3><p>{tracks.length.toLocaleString()} rows</p></div><div className="receive-filter-actions"><button className="btn sm" type="button" onClick={() => { setSeal(''); setSearch(''); setPage(0); }}>All seals</button>{seal && <button className="btn sm" type="button" onClick={() => exportFile(seal)}><Download size={14} /> Download this seal</button>}</div></div>
      <label className="page-filter-control"><span>Search tracking / seal / hub / status</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} /></label>
      <div className="responsive-table-wrap"><table><thead><tr><th>Master Seal</th><th>Seal</th><th>Tracking</th><th>Type</th><th>Source hub</th><th>Destination hub</th><th>Status</th><th>Source sheet / row</th></tr></thead><tbody>{tracks.slice(currentPage * 100, (currentPage + 1) * 100).map((row, index) => <tr key={`${row.source_sheet}-${row.source_row}-${index}`}><td>{row.master_seal}</td><td>{row.seal}</td><td>{row.tracking || 'Missing'}</td><td>{row.seal_type}</td><td>{row.source_hub}</td><td>{row.destination_hub}</td><td>{row.status}</td><td>{row.source_sheet} / {row.source_row}</td></tr>)}{!tracks.length && <tr><td colSpan={8}>No tracking rows available in this uploaded file for this selection.</td></tr>}</tbody></table></div>
      <div className="dt-tools"><button className="btn sm" type="button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</button><span>{currentPage + 1} / {pages}</span><button className="btn sm" type="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next</button></div>
    </div>
    {report.issues.length > 0 && <section className="sec"><h3>Data issues · {report.issues.length}</h3><ul>{report.issues.map((issue, index) => <li key={index}>{issue.sheet} {issue.source_row ?? ''}: {issue.issue}</li>)}</ul></section>}
  </section>;
}
