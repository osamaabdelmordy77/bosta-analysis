import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock3, Copy, Download, ExternalLink, Filter, KeyRound, RefreshCw, ScanLine, Search, X } from 'lucide-react';
import {
  ApiError, BostaHubOption, BostaLiveDelivery, getBostaConnection,
  getBostaDeliveryDetails, getBostaHubs, getBostaMissScanCount, getBostaMissScanPage,
} from '../services/api';
import { buildMissScanRows, deliveryHistory, duration, historyLabel, historyTime, MissScanRow } from '../utils/missScan';
import { classifyAssignedHub, SORT_AREAS, UNKNOWN_AREA } from '../utils/sortAreas';

const PAGE_SIZE = 100;
const BOSTA_PAGE_SIZE = 200;
const DEFAULT_HUB = '030000000133';

function csvCell(value: string | number): string {
  const text = String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function MultiFilter({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (value: string[]) => void }) {
  return <details className="miss-filter-menu"><summary>{label} <span>{value.length ? `(${value.length})` : 'All'}</span></summary><div className="miss-filter-options">
    <button type="button" onClick={() => onChange([])}>All {label.toLowerCase()}</button>
    {options.map((option) => <label key={option}><input type="checkbox" checked={value.includes(option)} onChange={() => onChange(value.includes(option) ? value.filter((item) => item !== option) : [...value, option])} />{option}</label>)}
  </div></details>;
}

export const MissScanSection: React.FC<{ organizationSlug: string; sortingVolume?: boolean }> = ({ organizationSlug, sortingVolume = false }) => {
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);
  const [restricted, setRestricted] = useState(false);
  const [hubs, setHubs] = useState<BostaHubOption[]>([]);
  const [hubId, setHubId] = useState('');
  const [deliveries, setDeliveries] = useState<BostaLiveDelivery[]>([]);
  const [loadedHubId, setLoadedHubId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [search, setSearch] = useState('');
  const [businessSearch, setBusinessSearch] = useState('');
  const [businesses, setBusinesses] = useState<string[]>([]);
  const [assignedHubs, setAssignedHubs] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [minimumHours, setMinimumHours] = useState(0);
  const [minimumDays, setMinimumDays] = useState(0);
  const [sortingArea, setSortingArea] = useState('A');
  const [sortingAreaHub, setSortingAreaHub] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<MissScanRow | null>(null);
  const [details, setDetails] = useState<BostaLiveDelivery | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([getBostaConnection(organizationSlug), getBostaHubs(organizationSlug).catch(() => [])])
      .then(([ready, options]) => {
        if (!active) return;
        const available = ready && options.length === 0 ? [{ id: DEFAULT_HUB, name: 'Alex Sorting Facility' }] : options;
        setConnected(ready);
        setHubs(available);
        setHubId(available.find((hub) => hub.id === DEFAULT_HUB)?.id || available[0]?.id || '');
      })
      .catch((reason: unknown) => { if (active) { setRestricted(reason instanceof ApiError && reason.status === 403); setError(reason instanceof Error ? reason.message : 'Could not check Bosta connection.'); } })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [organizationSlug]);

  const loadDeliveries = useCallback(async (selectedHub: string): Promise<BostaLiveDelivery[]> => {
    const [count, first] = await Promise.all([
      getBostaMissScanCount(organizationSlug, selectedHub),
      getBostaMissScanPage(organizationSlug, selectedHub, 1),
    ]);
    const all = [...first];
    const pages = Math.min(1000, Math.max(1, Math.ceil(count / BOSTA_PAGE_SIZE)));
    for (let start = 2; start <= pages; start += 6) {
      const batch = await Promise.all(Array.from({ length: Math.min(6, pages - start + 1) }, (_, offset) => getBostaMissScanPage(organizationSlug, selectedHub, start + offset)));
      all.push(...batch.flat());
    }
    let nextPage = pages + 1;
    let lastSize = pages === 1 ? first.length : all.length % BOSTA_PAGE_SIZE || BOSTA_PAGE_SIZE;
    while (lastSize === BOSTA_PAGE_SIZE && nextPage <= 1000) {
      const next = await getBostaMissScanPage(organizationSlug, selectedHub, nextPage++);
      all.push(...next);
      lastSize = next.length;
    }
    return [...new Map(all.map((item) => [item.trackingNumber || item._id, item])).values()];
  }, [organizationSlug]);

  useEffect(() => {
    if (!connected || !hubId) return;
    let active = true;
    setLoading(true);
    setError(null);
    loadDeliveries(hubId)
      .then((rows) => { if (active) { setDeliveries(rows); setLoadedHubId(hubId); setUpdatedAt(Date.now()); setClock(Date.now()); } })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load Bosta shipments.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [connected, hubId, refresh, loadDeliveries]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClock(Date.now());
      if (connected && !loading && document.visibilityState === 'visible') setRefresh((value) => value + 1);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [connected, loading]);

  useEffect(() => {
    if (!selected) { setDetails(null); return; }
    let active = true;
    setDetails(selected.delivery);
    getBostaDeliveryDetails(organizationSlug, selected.delivery._id)
      .then((result) => { if (active && result) setDetails(result); })
      .catch(() => {});
    return () => { active = false; };
  }, [selected, organizationSlug]);

  const hub = hubs.find((item) => item.id === hubId);
  const rows = useMemo(() => buildMissScanRows(loadedHubId === hubId ? deliveries : [], hubId, hub?.name || '', clock), [deliveries, loadedHubId, hubId, hub?.name, clock]);
  const areaRows = useMemo(() => rows.map((row) => ({ row, ...classifyAssignedHub(row.assignedHub) })), [rows]);
  const businessOptions = useMemo(() => [...new Set(rows.map((row) => row.business))].sort(), [rows]);
  const hubOptions = useMemo(() => [...new Set(rows.map((row) => row.assignedHub))].sort(), [rows]);
  const typeOptions = useMemo(() => [...new Set(rows.map((row) => row.type))].sort(), [rows]);
  const filteredBase = useMemo(() => areaRows.filter(({ row }) => {
    const term = search.trim().toLowerCase();
    return row.minutes >= Math.max(minimumHours * 60, minimumDays * 1440)
      && (!term || [row.trackingNumber, row.business, row.assignedHub].some((value) => value.toLowerCase().includes(term)))
      && (!businessSearch || row.business.toLowerCase().includes(businessSearch.trim().toLowerCase()))
      && (!businesses.length || businesses.includes(row.business))
      && (!types.length || types.includes(row.type));
  }), [areaRows, search, businessSearch, businesses, types, minimumHours, minimumDays]);
  const filtered = useMemo(() => filteredBase
    .filter(({ row, area, hub: assignedHub }) => sortingVolume
      ? area === sortingArea && (!sortingAreaHub || assignedHub === sortingAreaHub)
      : !assignedHubs.length || assignedHubs.includes(row.assignedHub))
    .map(({ row }) => row), [filteredBase, sortingVolume, sortingArea, sortingAreaHub, assignedHubs]);
  const areaCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of filteredBase) counts.set(entry.area, (counts.get(entry.area) ?? 0) + 1);
    return counts;
  }, [filteredBase]);
  const sortingAreas = useMemo(() => [...SORT_AREAS, { code: UNKNOWN_AREA, name: 'Unmapped / بدون تصنيف', hubs: [] as string[] }]
    .sort((left, right) => (areaCounts.get(right.code) ?? 0) - (areaCounts.get(left.code) ?? 0)
      || left.code.localeCompare(right.code)), [areaCounts]);
  const sortingAreaHubs = useMemo(() => {
    const definition = SORT_AREAS.find((item) => item.code === sortingArea);
    return definition
      ? [...definition.hubs]
      : [...new Set(filteredBase.filter((entry) => entry.area === UNKNOWN_AREA).map((entry) => entry.hub))].sort((left, right) => left.localeCompare(right));
  }, [filteredBase, sortingArea]);
  const sortingHubCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of filteredBase) {
      if (entry.area === sortingArea) counts.set(entry.hub, (counts.get(entry.hub) ?? 0) + 1);
    }
    return counts;
  }, [filteredBase, sortingArea]);
  const selectedSortingArea = sortingAreas.find((item) => item.code === sortingArea);
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clearFilters = () => { setSearch(''); setBusinessSearch(''); setBusinesses([]); setAssignedHubs([]); setTypes([]); setMinimumHours(0); setMinimumDays(0); setSortingArea('A'); setSortingAreaHub(''); setPage(1); };
  const exportCsv = () => {
    const header = ['#', 'Tracking Number', 'Business Name', 'Type', 'Scanned From', 'Assigned Hub', 'Received Time', 'Waiting Duration', 'Minutes Waiting'];
    const lines = [header, ...filtered.map((row, index) => [index + 1, row.trackingNumber, row.business, row.type, row.device, row.assignedHub, row.receivedAt.toLocaleString(), duration(row.minutes), row.minutes])];
    const blob = new Blob(['\ufeff' + lines.map((line) => line.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `bosta-${sortingVolume ? 'sorting-volume' : 'miss-scan'}-${new Date().toISOString().slice(0, 10)}.csv`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  if (checking) return <section className="miss-panel" role="status">Checking Bosta connection…</section>;
  if (restricted) return <section className="miss-panel" role="alert">Your role does not allow viewing organization-wide live shipments.</section>;
  return <div className="miss-scan">
    <section className="miss-panel miss-intro"><div><span className="source-kind">Bosta Admin live API</span><h2>{sortingVolume ? 'Sorting Volume by area' : 'Miss Scan inspection'}</h2><p>{sortingVolume ? 'Review Miss Scan workload grouped by area and each assigned hub.' : 'Received at the warehouse without a Ready to Dispatch scan. These shipments may be delayed.'}</p></div>
      {connected && <div className="miss-actions"><button type="button" className="btn sm" onClick={() => setRefresh((value) => value + 1)} disabled={loading}><RefreshCw size={15} /> Refresh</button></div>}
    </section>
    {error && <div className="workspace-notice" role="alert">{error}</div>}
    {!connected && <section className="miss-panel miss-connect"><KeyRound size={20} /><div><h3>Connect your Bosta account</h3><p>Use the shared Bosta token field in the fixed header. It is stored in this browser and validated through the secure organization session.</p></div></section>}
    {connected && <>
      <div className="miss-summary">{[['Total Miss Scan', rows.length, ScanLine], ['Over 1 hour', rows.filter((row) => row.minutes >= 60).length, Clock3], ['Over 2 hours', rows.filter((row) => row.minutes >= 120).length, AlertTriangle], ['Over 3 hours', rows.filter((row) => row.minutes >= 180).length, AlertTriangle]].map(([label, value, Icon]) => {
        const SummaryIcon = Icon as typeof ScanLine;
        return <div className="miss-summary-card" key={label as string}><SummaryIcon size={19} /><span>{label as string}</span><strong>{(value as number).toLocaleString()}</strong></div>;
      })}</div>
      <section className="miss-panel"><div className="miss-filter-heading"><div><Filter size={17} /><strong>Filtering late shipments</strong><span>{filtered.length.toLocaleString()} / {rows.length.toLocaleString()}</span></div><span>{loading ? 'Updating…' : updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString()}` : 'Waiting for data'}</span></div>
        <div className="miss-filters"><label className="miss-search"><Search size={16} /><input type="search" placeholder="Search tracking, business or hub" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label><label className="miss-search"><Search size={16} /><input type="search" placeholder="Search business name" value={businessSearch} onChange={(event) => { setBusinessSearch(event.target.value); setPage(1); }} /></label>
          <label>{sortingVolume ? 'Scanning hub' : 'Hub'} <select value={hubId} onChange={(event) => { setHubId(event.target.value); setPage(1); }}>{hubs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <MultiFilter label="Business" options={businessOptions} value={businesses} onChange={(value) => { setBusinesses(value); setPage(1); }} />
          <label>Since <select value={minimumHours} onChange={(event) => { setMinimumHours(Number(event.target.value)); setPage(1); }}>{[0, 1, 2, 3, 6, 12].map((value) => <option key={value} value={value}>{value ? `Over ${value} hours` : 'All hours'}</option>)}</select></label>
          <label>At least <select value={minimumDays} onChange={(event) => { setMinimumDays(Number(event.target.value)); setPage(1); }}>{[0, 1, 2, 3, 7].map((value) => <option key={value} value={value}>{value ? `Over ${value} days` : 'All days'}</option>)}</select></label>
          {!sortingVolume && <MultiFilter label="Assigned hub" options={hubOptions} value={assignedHubs} onChange={(value) => { setAssignedHubs(value); setPage(1); }} />}
          <MultiFilter label="Type" options={typeOptions} value={types} onChange={(value) => { setTypes(value); setPage(1); }} />
          <button type="button" className="btn sm" onClick={clearFilters}>Clear filters</button>
        </div>
      </section>
      {sortingVolume && <section className="miss-panel miss-sort-area"><div className="miss-table-heading"><div><h3>Work by area and assigned hub</h3><p>{filteredBase.length.toLocaleString()} deliveries across all areas · area counts reflect the active search and filters.</p></div></div>
        <div className="sort-area-letters" role="group" aria-label="Choose sorting area">
          {sortingAreas.map((item) => <button key={item.code} className={`sort-area-letter${sortingArea === item.code ? ' is-active' : ''}`} type="button" aria-pressed={sortingArea === item.code} onClick={() => { setSortingArea(item.code); setSortingAreaHub(''); setPage(1); }}>
            <strong>{item.code === UNKNOWN_AREA ? 'Unmapped' : item.code}</strong><span dir="auto">{item.name}</span><small>{(areaCounts.get(item.code) ?? 0).toLocaleString()} deliveries</small>
          </button>)}
        </div>
        <div className="miss-area-hubs-heading"><div><h4>{sortingArea === UNKNOWN_AREA ? 'Unmapped hubs' : `${sortingArea} · ${selectedSortingArea?.name}`}</h4><p>{(areaCounts.get(sortingArea) ?? 0).toLocaleString()} Miss Scan deliveries · {sortingAreaHubs.length} hubs</p></div><button className="btn sm" type="button" aria-pressed={!sortingAreaHub} onClick={() => { setSortingAreaHub(''); setPage(1); }}>All hubs in this area</button></div>
        <div className="sort-hub-grid">{sortingAreaHubs.map((name) => <button key={name} className={`sort-hub-card${sortingAreaHub === name ? ' is-active' : ''}`} type="button" aria-pressed={sortingAreaHub === name} onClick={() => { setSortingAreaHub(sortingAreaHub === name ? '' : name); setPage(1); }}><span>{name}</span><strong>{(sortingHubCounts.get(name) ?? 0).toLocaleString()}</strong></button>)}</div>
        {sortingAreaHubs.length === 0 && <p className="volume-empty" role="status">No assigned hubs match the active filters for this area.</p>}
      </section>}
      <section className="miss-panel miss-table-panel"><div className="miss-table-heading"><div><h3>{sortingVolume ? 'Sorting Volume deliveries' : 'Miss Scan deliveries'}</h3><p>{sortingVolume ? `${sortingArea === UNKNOWN_AREA ? 'Unmapped' : `Area ${sortingArea}`} · ${sortingAreaHub || 'All hubs'} · ` : 'Received without Ready scan · '}{filtered.length.toLocaleString()} deliveries</p></div><button type="button" className="btn sm" onClick={exportCsv}><Download size={15} /> Export CSV</button></div><div className="responsive-table-wrap"><table><thead><tr>{['#', 'Tracking number', 'Business', 'Type', 'Scanned from', 'Assigned hub', 'Received time', 'Waiting time', 'Delay level'].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{shown.map((row, index) => <tr key={row.delivery._id}><td>{(page - 1) * PAGE_SIZE + index + 1}</td><td><div className="miss-tracking"><button type="button" onClick={() => setSelected(row)}>{row.trackingNumber}</button><button type="button" title="Copy tracking number" onClick={() => void navigator.clipboard.writeText(row.trackingNumber)}><Copy size={13} /></button><a href={`https://beta-admin.bosta.co/deliveries/${encodeURIComponent(row.trackingNumber)}/details`} target="_blank" rel="noopener noreferrer" title="Open in Bosta Admin"><ExternalLink size={13} /></a></div></td><td>{row.business}</td><td>{row.type}</td><td>{row.device}</td><td>{row.assignedHub}</td><td>{row.receivedAt.toLocaleString()}</td><td>{duration(row.minutes)}</td><td><span className={`miss-delay ${row.minutes >= 180 ? 'high' : row.minutes >= 120 ? 'medium' : row.minutes >= 60 ? 'low' : ''}`}>{row.minutes >= 180 ? 'Over 3 hours' : row.minutes >= 120 ? 'Over 2 hours' : row.minutes >= 60 ? 'Over 1 hour' : 'Under 1 hour'}</span></td></tr>)}{shown.length === 0 && <tr><td colSpan={9}>No Miss Scan deliveries match these filters.</td></tr>}</tbody></table></div>
        {pageCount > 1 && <div className="miss-pagination"><button type="button" className="btn sm" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {pageCount}</span><button type="button" className="btn sm" disabled={page === pageCount} onClick={() => setPage((value) => value + 1)}>Next</button></div>}
      </section>
    </>}
    {selected && <div className="miss-modal-backdrop" onClick={() => setSelected(null)}><section className="miss-modal" role="dialog" aria-modal="true" aria-label="Delivery details" onClick={(event) => event.stopPropagation()}><div className="miss-table-heading"><div><h3>Delivery details</h3><p>{selected.trackingNumber}</p></div><button type="button" className="btn sm" onClick={() => setSelected(null)}><X size={16} /> Close</button></div><div className="miss-details"><p><strong>Status:</strong> {String(details?.state?.value || 'Not available')} · {String(details?.state?.code || '—')}</p><p><strong>Assigned hub:</strong> {selected.assignedHub}</p><p><strong>Received:</strong> {selected.receivedAt.toLocaleString()}</p><p><strong>Business:</strong> {selected.business}</p><h4>Delivery history</h4>{deliveryHistory(details || selected.delivery).map((event, index) => <div className="miss-history" key={index}><strong>{historyLabel(event) || String(event.code || event.state || 'Status')}</strong><span>{historyTime(event)?.toLocaleString() || 'Time unavailable'}</span></div>)}</div></section></div>}
  </div>;
};
