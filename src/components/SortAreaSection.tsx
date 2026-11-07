import React, { useMemo, useState } from 'react';
import { Download, RotateCcw } from 'lucide-react';
import type { ShipmentRecord } from '../types';
import { SORT_AREAS, UNKNOWN_AREA, MISSING_RECEIVED_DATE, classifySortAreas, filterAreaDates, summarizeAreaDates, type AreaDateFilters } from '../utils/sortAreas';
import { ShipmentExplorerSection } from './ShipmentExplorerSection';
import { downloadSortArea } from '../utils/sortAreaExport';

const EMPTY_DATES: AreaDateFilters = { from: '', to: '', exact: '', weekday: '' };
const WEEKDAYS = [
  ['Saturday', 'السبت'], ['Sunday', 'الأحد'], ['Monday', 'الإثنين'],
  ['Tuesday', 'الثلاثاء'], ['Wednesday', 'الأربعاء'], ['Thursday', 'الخميس'], ['Friday', 'الجمعة'],
] as const;
const PAGE_SIZE = 31;
export function SortAreaSection({ shipments }: { shipments: ShipmentRecord[] }) {
  const [area, setArea] = useState('A');
  const [hub, setHub] = useState('');
  const [dates, setDates] = useState<AreaDateFilters>(EMPTY_DATES);
  const [inspection, setInspection] = useState<{ date: string; hub: string } | null>(null);
  const [page, setPage] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const classified = useMemo(() => classifySortAreas(shipments), [shipments]);
  const invalidRange = Boolean(dates.from && dates.to && dates.from > dates.to);
  const dateEntries = useMemo(() => invalidRange ? [] : filterAreaDates(classified, dates), [classified, dates, invalidRange]);
  const areaCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of dateEntries) counts.set(entry.area, (counts.get(entry.area) ?? 0) + 1);
    return counts;
  }, [dateEntries]);
  const rankedAreas = useMemo(() => [...SORT_AREAS, { code: UNKNOWN_AREA, name: 'Unmapped / بدون تصنيف' }]
    .sort((left, right) => (areaCounts.get(right.code) ?? 0) - (areaCounts.get(left.code) ?? 0)
      || left.code.localeCompare(right.code)), [areaCounts]);
  const areaEntries = useMemo(() => dateEntries.filter((entry) => entry.area === area), [dateEntries, area]);
  const areaDefinition = SORT_AREAS.find((definition) => definition.code === area);
  const hubs = useMemo(() => areaDefinition ? [...areaDefinition.hubs] : [...new Set(classified.filter((entry) => entry.area === UNKNOWN_AREA).map((entry) => entry.hub))].sort((a, b) => a.localeCompare(b)), [areaDefinition, classified]);
  const hubCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of areaEntries) counts.set(entry.hub, (counts.get(entry.hub) ?? 0) + 1);
    return counts;
  }, [areaEntries]);
  const entries = useMemo(() => hub ? areaEntries.filter((entry) => entry.hub === hub) : areaEntries, [areaEntries, hub]);
  const daily = useMemo(() => summarizeAreaDates(entries), [entries]);
  const displayedHubs = hub ? [hub] : hubs;
  const pageCount = Math.max(1, Math.ceil(daily.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const records = useMemo(() => entries.filter((entry) => !inspection || (entry.date === inspection.date && (!inspection.hub || entry.hub === inspection.hub))).map((entry) => entry.shipment), [entries, inspection]);
  const missingDates = classified.reduce((count, entry) => count + (!entry.date ? 1 : 0), 0);
  const updateDate = (key: keyof AreaDateFilters, value: string) => { setDates((previous) => ({ ...previous, [key]: value })); setInspection(null); setPage(0); };
  const selectArea = (code: string) => { setArea(code); setHub(''); setInspection(null); setPage(0); };
  const selectHub = (name: string) => { setHub(name); setInspection(null); setPage(0); };
  const download = async (code: string, hubName = '') => {
    setDownloading(true);
    setDownloadError('');
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      const selected = dateEntries.filter((entry) => entry.area === code && (!hubName || entry.hub === hubName));
      const dateLabel = `${dates.exact || `${dates.from || 'all'}-to-${dates.to || 'all'}`}${dates.weekday ? `-${dates.weekday}` : ''}`;
      downloadSortArea(selected, `${hubName ? 'hub' : 'area'}-${code === UNKNOWN_AREA ? 'Unmapped' : code}${hubName ? `-${hubName}` : ''}-${dateLabel}`);
    } catch (cause) {
      setDownloadError(cause instanceof Error ? cause.message : 'Unable to download shipments. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  return <div className="sort-area">
    <section className="receive-filter-panel" aria-label="Area received date filters">
      <div className="receive-filter-heading">
        <div><span className="source-kind">Assigned Hub → Area → Received date</span><h2>Area</h2><p>Choose an area letter, then a hub. Daily groups use the date from Received Time, independently of the report date.</p></div>
        <button className="btn sm" type="button" onClick={() => { setDates(EMPTY_DATES); setHub(''); setInspection(null); setPage(0); }}><RotateCcw size={14} /> Reset area filters</button>
      </div>
      <div className="receive-filter-grid">
        <label className="page-filter-control"><span>Received date from</span><input type="date" value={dates.from} onInput={(event) => updateDate('from', event.currentTarget.value)} /></label>
        <label className="page-filter-control"><span>Received date to (inclusive)</span><input type="date" value={dates.to} onInput={(event) => updateDate('to', event.currentTarget.value)} /></label>
        <label className="page-filter-control"><span>Specific received date</span><input type="date" value={dates.exact} onInput={(event) => updateDate('exact', event.currentTarget.value)} /></label>
      </div>
      <p className="volume-note">Sort page filters also apply. Area classification always uses Assigned Hub. Counts are imported records; repeated tracking numbers in different reports remain separate records.</p>
      {missingDates > 0 && <p className="volume-note">{missingDates.toLocaleString()} records have missing / invalid Received Time. They remain in a separate undated group unless a received date or weekday filter is applied.</p>}
      {invalidRange && <p className="volume-error" role="alert">The start date must be on or before the end date.</p>}
      <p className="volume-note">Download any area or hub as Excel with its shipment details and daily hub summary. Downloads use the active Sort and received date filters.</p>
      {downloading && <p className="volume-note" role="status">Preparing Excel download…</p>}
      {downloadError && <p className="volume-error" role="alert">{downloadError}</p>}
    </section>

    <div className="sort-area-letters" role="group" aria-label="Choose area">
      {rankedAreas.map((definition) => <div className="sort-area-download-card" key={definition.code}><button className={`sort-area-letter${area === definition.code ? ' is-active' : ''}`} type="button" aria-pressed={area === definition.code} onClick={() => selectArea(definition.code)}>
        <strong>{definition.code === UNKNOWN_AREA ? 'Unmapped' : definition.code}</strong><span dir="auto">{definition.name}</span><small>{(areaCounts.get(definition.code) ?? 0).toLocaleString()} shipments</small>
      </button><button className="btn sm sort-card-download" type="button" aria-label={`Download area ${definition.code === UNKNOWN_AREA ? 'Unmapped' : definition.code} shipments`} disabled={downloading || !(areaCounts.get(definition.code) ?? 0)} onClick={() => void download(definition.code)}><Download size={14} /> Download Excel</button></div>)}
    </div>

    <section className="sec" aria-label="Area hubs">
      <div className="receive-filter-heading"><div><h3>{area === UNKNOWN_AREA ? 'Unmapped hubs' : `${area} · ${areaDefinition?.name}`}</h3><p className="lead">{areaEntries.length.toLocaleString()} records · {hubs.length} hubs · select a hub to narrow the daily breakdown.</p></div><button className="btn sm" type="button" aria-pressed={!hub} onClick={() => selectHub('')}>All hubs in this area</button></div>
      <div className="sort-hub-grid">{hubs.map((name) => <div className="sort-hub-download-card" key={name}><button className={`sort-hub-card${hub === name ? ' is-active' : ''}`} type="button" aria-pressed={hub === name} onClick={() => selectHub(name)}><span>{name}</span><strong>{(hubCounts.get(name) ?? 0).toLocaleString()}</strong></button><button className="btn sm sort-card-download" type="button" aria-label={`Download ${name} shipments`} disabled={downloading || !(hubCounts.get(name) ?? 0)} onClick={() => void download(area, name)}><Download size={14} /> Download Excel</button></div>)}</div>
      {area === UNKNOWN_AREA && <p className="volume-note">These Assigned Hub names do not match the supplied area lists. Missing Assigned Hub is included here; no area is guessed from Current Hub or a hub-name prefix.</p>}
    </section>

    <section className="sec" aria-label="Area daily shipments">
      <div className="receive-filter-heading"><div><h3>Shipments by received date</h3><p className="lead">{hub || 'All hubs'} · {entries.length.toLocaleString()} records. Select a count to show its shipment details below.</p></div><span className="shipment-row-count">{daily.filter((row) => row.date).length} received dates</span></div>
      <div className="dt-wrap"><table className="sort-area-daily"><thead><tr><th>Received date</th><th>Weekday</th>{displayedHubs.map((name) => <th key={name}>{name}</th>)}<th>Total shipments</th><th>Items</th></tr></thead><tbody>
        {daily.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((row) => <tr key={row.date || 'undated'}>
          <td>{row.date || MISSING_RECEIVED_DATE}</td><td>{row.weekday || '—'}</td>
          {displayedHubs.map((name) => <td key={name}><button className="volume-count" type="button" disabled={!row.counts[name]} aria-label={`Show ${name}, ${row.date || MISSING_RECEIVED_DATE}: ${row.counts[name] ?? 0} shipments`} onClick={() => setInspection({ date: row.date, hub: name })}>{(row.counts[name] ?? 0).toLocaleString()}</button></td>)}
          <td><button className="volume-count" type="button" aria-label={`Show all hubs, ${row.date || MISSING_RECEIVED_DATE}: ${row.total} shipments`} onClick={() => setInspection({ date: row.date, hub: '' })}><strong>{row.total.toLocaleString()}</strong></button></td><td>{row.items.toLocaleString()}</td>
        </tr>)}
      </tbody><tfoot><tr><th>Total</th><td />{displayedHubs.map((name) => <td key={name}>{(hubCounts.get(name) ?? 0).toLocaleString()}</td>)}<td>{entries.length.toLocaleString()}</td><td>{daily.reduce((sum, row) => sum + row.items, 0).toLocaleString()}</td></tr></tfoot></table></div>
      {!daily.length && <p className="volume-empty" role="status">No shipments match this area, hub and date selection.</p>}
      <div className="dt-tools"><button className="btn sm" type="button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous dates</button><span>Page {currentPage + 1} of {pageCount}</span><button className="btn sm" type="button" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>Next dates</button></div>
    </section>
    <div className="receive-filter-heading"><div><h3>Shipment details</h3><p className="lead">{area === UNKNOWN_AREA ? 'Unmapped' : `Area ${area}`} · {inspection?.hub || hub || 'All hubs'} · {inspection ? inspection.date || MISSING_RECEIVED_DATE : 'All selected received dates'} · {dates.weekday || 'All weekdays'} · {records.length.toLocaleString()} records</p></div>
      <div className="receive-filter-actions">
        <label className="page-filter-control"><span>Day of week · يوم الاستلام</span><select value={dates.weekday || ''} onChange={(event) => updateDate('weekday', event.target.value)}><option value="">All weekdays · كل الأيام</option>{WEEKDAYS.map(([value, label]) => <option key={value} value={value}>{label} · {value}</option>)}</select></label>
        {inspection && <button className="btn sm" type="button" onClick={() => setInspection(null)}>Show all selected dates</button>}
      </div>
    </div>
    <ShipmentExplorerSection key={`${area}-${hub}-${inspection?.date ?? 'all'}-${inspection?.hub ?? ''}`} shipments={records} showReceiveFields />
  </div>;
}
