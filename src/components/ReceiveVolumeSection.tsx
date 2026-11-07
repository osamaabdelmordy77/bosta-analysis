import React, { useMemo, useState } from 'react';
import { Download, RotateCcw } from 'lucide-react';
import type { ShipmentRecord } from '../types';
import { downloadReceiveVolumePivot } from '../services/api';
import { classifyReceiveVolume, compareReceiveVolume, filterReceiveVolume, filterVolumeInspection, summarizeReceiveVolume, VOLUME_WINDOWS, WEEKDAYS, type VolumeFilters } from '../utils/receiveVolume';
import { downloadVolumeGroup } from '../utils/receiveVolumeExport';
import { ShipmentExplorerSection } from './ShipmentExplorerSection';

const EMPTY: VolumeFilters = { from: '', to: '', date: '', weekdays: [] };
export function ReceiveVolumeSection({ shipments, organizationSlug }: { shipments: ShipmentRecord[]; organizationSlug: string }) {
  const [filters, setFilters] = useState<VolumeFilters>(EMPTY);
  const [dimension, setDimension] = useState<'date' | 'weekday' | 'week'>('date');
  const [selectedWindow, setSelectedWindow] = useState('all');
  const [inspectionWeekday, setInspectionWeekday] = useState('all');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const classified = useMemo(() => classifyReceiveVolume(shipments), [shipments]);
  const invalidRange = Boolean(filters.from && filters.to && filters.from > filters.to);
  const entries = useMemo(() => invalidRange ? [] : filterReceiveVolume(classified, filters), [classified, filters, invalidRange]);
  const summary = useMemo(() => summarizeReceiveVolume(entries), [entries]);
  const comparison = useMemo(() => compareReceiveVolume(summary, dimension), [summary, dimension]);
  const totals = useMemo(() => VOLUME_WINDOWS.map((window) => summary.reduce((count, row) => count + (row.window === window ? row.shipments : 0), 0)), [summary]);
  const displayedEntries = useMemo(() => filterVolumeInspection(entries, selectedWindow, inspectionWeekday), [entries, selectedWindow, inspectionWeekday]);
  const displayed = useMemo(() => displayedEntries.map((entry) => entry.shipment), [displayedEntries]);
  const pages = Math.max(1, Math.ceil(comparison.length / 31));
  const currentPage = Math.min(page, pages - 1);
  const missing = classified.reduce((count, row) => count + (!row.date ? 1 : 0), 0);
  const update = (key: keyof VolumeFilters, value: string | string[]) => { setFilters((previous) => ({ ...previous, [key]: value })); setPage(0); };
  const runDownload = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to download. Please try again.'); } finally { setBusy(false); }
  };
  return <div className="receive-volume">
    <section className="receive-filter-panel" aria-label="Volume filters">
      <div className="receive-filter-heading">
        <div><span className="source-kind">Received Time analysis</span><h2>Volume</h2><p>Count imported shipment records by their received date and source clock time. Parent Receive filters also apply.</p></div>
        <div className="receive-filter-actions">
          <button className="btn sm" type="button" onClick={() => { setFilters(EMPTY); setPage(0); setSelectedWindow('all'); setInspectionWeekday('all'); }}><RotateCcw size={14} /> Reset volume filters</button>
          <button className="btn primary sm" type="button" disabled={busy || !entries.length || invalidRange} onClick={() => void runDownload(() => downloadReceiveVolumePivot(organizationSlug, summary))}><Download size={14} /> {busy ? 'Preparing…' : 'Download comparisons + Pivot Tables'}</button>
        </div>
      </div>
      <div className="receive-filter-grid">
        <label className="page-filter-control"><span>Received date from</span><input type="date" value={filters.from} onInput={(event) => update('from', event.currentTarget.value)} /></label>
        <label className="page-filter-control"><span>Received date to (inclusive)</span><input type="date" value={filters.to} onInput={(event) => update('to', event.currentTarget.value)} /></label>
        <label className="page-filter-control"><span>Specific received date</span><input type="date" value={filters.date} onInput={(event) => update('date', event.currentTarget.value)} /></label>
      </div>
      <fieldset className="volume-weekdays"><legend>Days of week (none selected = all)</legend>{WEEKDAYS.map((day) => <label key={day}><input type="checkbox" checked={filters.weekdays.includes(day)} onChange={(event) => update('weekdays', event.target.checked ? [...filters.weekdays, day] : filters.weekdays.filter((value) => value !== day))} />{day}</label>)}</fieldset>
      <p className="volume-note">Intervals: 14:00 ≤ time &lt; 17:00 and 17:00 ≤ time &lt; 19:00. Exactly 19:00 belongs to “From 19:00”. Weeks run Saturday–Friday. Different dates remain separate in the daily comparison. Counts represent imported records, including repeated tracking numbers across report snapshots.</p>
      {missing > 0 && <p className="volume-note">{missing.toLocaleString()} records in the current Receive selection have missing / invalid Received Time. They appear in a separate group without date filters; date or weekday filters exclude them.</p>}
      {invalidRange && <p role="alert" className="volume-error">The start date must be on or before the end date.</p>}
      {error && <p role="alert" className="volume-error">{error}</p>}
    </section>
    <div className="volume-cards">
      {VOLUME_WINDOWS.map((window, index) => <article className="volume-card" key={window}>
        <span>{window}</span><strong>{totals[index].toLocaleString()}</strong><small>{entries.length ? (totals[index] / entries.length * 100).toFixed(1) : '0.0'}% of filtered records</small>
        <div><button className="btn sm" type="button" onClick={() => setSelectedWindow(window)}>View records</button><button className="btn sm" type="button" disabled={busy || !totals[index]} onClick={() => void runDownload(() => downloadVolumeGroup(entries.filter((entry) => entry.window === window), window))}><Download size={13} /> Download</button></div>
      </article>)}
    </div>
    <section className="sec" aria-label="Volume comparison">
      <div className="receive-filter-heading"><div><h3>Volume comparison</h3><p className="lead">{entries.length.toLocaleString()} records · {new Set(entries.filter((entry) => entry.date).map((entry) => entry.date)).size} received dates. Select a count to download that group.</p></div>
        <label className="page-filter-control"><span>Compare by</span><select value={dimension} onChange={(event) => { setDimension(event.target.value as typeof dimension); setPage(0); }}><option value="date">Date + weekday</option><option value="weekday">Day of week (all selected dates)</option><option value="week">Week starting Saturday</option></select></label>
      </div>
      <div className="dt-wrap"><table className="volume-comparison-table"><thead><tr><th>{dimension === 'date' ? 'Received date' : dimension === 'week' ? 'Week starting' : 'Weekday'}</th>{dimension === 'date' && <th>Weekday</th>}{VOLUME_WINDOWS.map((window) => <th key={window}>{window}</th>)}<th>Total</th><th>14–19 share</th><th>Change vs previous row</th><th>Download</th></tr></thead>
        <tbody>{comparison.slice(currentPage * 31, (currentPage + 1) * 31).map((row, index) => {
          const previous = comparison[currentPage * 31 + index - 1];
          const change = previous && previous.key !== 'Missing / invalid time' && row.key !== 'Missing / invalid time' && dimension !== 'weekday' && previous.total ? ((row.total - previous.total) / previous.total * 100) : null;
          const matchesRow = (entry: typeof entries[number]) => (entry[dimension] || 'Missing / invalid time') === row.key;
          return <tr key={row.key}><td>{row.key}</td>{dimension === 'date' && <td>{row.weekday || '—'}</td>}{row.counts.map((count, windowIndex) => <td key={VOLUME_WINDOWS[windowIndex]}><button className="volume-count" type="button" disabled={!count || busy} aria-label={`Download ${row.key}, ${VOLUME_WINDOWS[windowIndex]}: ${count} records`} onClick={() => void runDownload(() => downloadVolumeGroup(entries.filter((entry) => matchesRow(entry) && entry.window === VOLUME_WINDOWS[windowIndex]), `${row.key}-${VOLUME_WINDOWS[windowIndex]}`))}>{count.toLocaleString()}</button></td>)}<td><strong>{row.total.toLocaleString()}</strong></td><td>{((row.counts[1] + row.counts[2]) / row.total * 100).toFixed(1)}%</td><td>{change === null ? '—' : `${change > 0 ? '+' : ''}${change.toFixed(1)}%`}</td><td><button className="btn sm" type="button" disabled={busy} onClick={() => void runDownload(() => downloadVolumeGroup(entries.filter(matchesRow), row.key))}><Download size={13} /> Records</button></td></tr>;
        })}</tbody><tfoot><tr><th>Total</th>{dimension === 'date' && <td />}{totals.map((count, index) => <td key={index}>{count.toLocaleString()}</td>)}<td>{entries.length.toLocaleString()}</td><td colSpan={3} /></tr></tfoot></table></div>
      {!comparison.length && <p className="volume-empty" role="status">No records match the selected Receive and Volume filters.</p>}
      <div className="dt-tools"><button className="btn sm" type="button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {pages}</span><button className="btn sm" type="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next</button></div>
    </section>
    <div className="receive-filter-heading">
      <div className="receive-filter-actions">
        <label className="page-filter-control"><span>Records to inspect</span><select value={selectedWindow} onChange={(event) => setSelectedWindow(event.target.value)}><option value="all">All time groups</option>{VOLUME_WINDOWS.map((window) => <option key={window}>{window}</option>)}</select></label>
        <label className="page-filter-control"><span>Day of week · يوم الاستلام</span><select value={inspectionWeekday} onChange={(event) => setInspectionWeekday(event.target.value)}><option value="all">All weekdays · كل الأيام</option>{WEEKDAYS.map((day) => <option key={day} value={day}>{day}</option>)}</select></label>
      </div>
      <span className="shipment-row-count" role="status">{displayedEntries.length.toLocaleString()} matching records</span>
      <button className="btn sm" disabled={busy || !displayedEntries.length} type="button" onClick={() => void runDownload(() => downloadVolumeGroup(displayedEntries, `${selectedWindow}-${inspectionWeekday}`))}><Download size={14} /> Download displayed records</button>
    </div>
    <p className="volume-note">The table and Download displayed records use both selectors above, together with the active Receive and Volume filters.</p>
    <ShipmentExplorerSection shipments={displayed} showReceiveFields />
  </div>;
}
