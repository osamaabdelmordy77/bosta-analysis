import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, RefreshCw, Search, Truck } from 'lucide-react';
import { CarsSheetSnapshot, getCarsSheet } from '../services/api';

interface CarGroup {
  name: string;
  start: number;
  end: number;
  columns: number[];
  headers: string[];
  masterSeal: string | null;
  details: string[];
  entries: Array<{ sourceRow: number; values: string[] }>;
  sealCount: number;
}

function buildCars(rows: string[][]): CarGroup[] {
  const carNumber = (value: string, index: number) => value.match(/\b(?:car|alex)\s*(\d+)\b/i)?.[1]
    || (/^\s*car\s*$/i.test(value) ? rows[0]?.[index + 1]?.trim().match(/^\d+$/)?.[0] : undefined);
  const starts = (rows[0] || []).flatMap((value, index) => carNumber(value, index) ? [index] : []);
  return starts.map((start, carIndex) => {
    const end = starts[carIndex + 1] ?? Math.max(...rows.map((row) => row.length), start + 1);
    const columns = Array.from({ length: end - start }, (_, index) => start + index)
      .filter((column) => rows.some((row, rowIndex) => rowIndex > 0 && Boolean(row[column]?.trim())));
    const meta = (rows[1] || []).slice(start, end).map((value) => value.trim()).filter(Boolean);
    const marker = meta.findIndex((value) => /master\s*seal/i.test(value));
    const masterSeal = marker >= 0 ? meta.slice(marker + 1).at(-1) || null : null;
    const details = meta.filter((value) => !/master\s*seal/i.test(value) && value !== masterSeal);
    const localHeaderRow = rows[2]?.slice(start, end).some((value) => /^(seal|number)$/i.test(value.trim())) ? 2 : 3;
    const headers = columns.map((column) => {
      const label = rows[localHeaderRow]?.[column]?.trim();
      return label || `Column ${column + 1}`;
    });
    const entries = rows.slice(localHeaderRow + 1).flatMap((row, offset) => {
      const values = columns.map((column) => row[column]?.trim() || '');
      return values.some(Boolean) ? [{ sourceRow: localHeaderRow + offset + 2, values }] : [];
    });
    return {
      name: `CAR ${Number(carNumber(rows[0][start], start))} · ${rows[0][start].trim().replace(/\s+/g, ' ').toUpperCase()}`,
      start,
      end,
      columns,
      headers,
      masterSeal,
      details,
      entries,
      sealCount: entries.filter((entry) => Boolean(entry.values[0]) && !/^(seal|number)$/i.test(entry.values[0])).length,
    };
  });
}

export const CarsSheetSection: React.FC<{ organizationSlug: string }> = ({ organizationSlug }) => {
  const [snapshot, setSnapshot] = useState<CarsSheetSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [selectedCar, setSelectedCar] = useState(0);
  const [search, setSearch] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
  const [sheetName, setSheetName] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true); setSnapshot(null); setSelectedCar(0); setSearch(''); setShowRaw(false);
    if (!date) { setLoading(false); return; }
    getCarsSheet(organizationSlug, date, sheetName || undefined)
      .then((result) => { if (active) { setSnapshot(result); setError(null); } })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load the Google Sheet.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organizationSlug, reload, date, sheetName]);

  const cars = useMemo(() => buildCars(snapshot?.rows || []), [snapshot]);
  const car = cars[selectedCar] || cars[0];
  const query = search.trim().toLocaleLowerCase();
  const entries = car?.entries.filter((entry) => !query || entry.values.some((value) => value.toLocaleLowerCase().includes(query)) || String(entry.sourceRow).includes(query)) || [];
  const totalSeals = cars.reduce((sum, item) => sum + item.sealCount, 0);
  const rowWidth = Math.max(0, ...(snapshot?.rows.map((row) => row.length) || []));

  return (
    <section className="cars-sheet" aria-label="Cars Google Sheet">
      <div className="cars-sheet-header">
        <div>
          <span className="source-kind">Linked Google Sheet</span>
          <h2>CARS</h2>
          <p>Master seals and cars from the selected day's worksheet only. Empty source cells remain empty.</p>
        </div>
        <div className="cars-sheet-actions">
          <button type="button" className="btn sm" onClick={() => { setLoading(true); setReload((value) => value + 1); }} disabled={loading}>
            <RefreshCw size={15} /> Refresh
          </button>
          {snapshot && <a className="btn sm" href={snapshot.source_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} /> Open sheet</a>}
        </div>
      </div>
      <div className="receive-filter-grid">
        <label className="page-filter-control"><span>CARS day · اليوم</span><input type="date" value={date} onInput={(event) => { setDate(event.currentTarget.value); setSheetName(''); }} /></label>
        {snapshot && <label className="page-filter-control"><span>Source worksheet · تبويب اليوم</span><select value={snapshot.sheet_name || ''} onChange={(event) => { const tab = snapshot.available_sheets?.find((item) => item.name === event.target.value); if (tab?.date) { setDate(tab.date); setSheetName(tab.name); } }}><option value="">Choose dated tab</option>{snapshot.available_sheets?.filter((tab) => tab.date).sort((a,b) => b.date!.localeCompare(a.date!)).map((tab) => <option key={tab.name} value={tab.name}>{tab.date} · {tab.name}</option>)}</select></label>}
      </div>
      {snapshot && <p className="volume-note">Source tab: <strong>{snapshot.sheet_name || 'No matching dated tab'}</strong> · date: {snapshot.sheet_date || date}. Tab dates use day-month-year. Undated tabs are not combined with daily tabs.</p>}
      {snapshot && !snapshot.sheet_name && <p className="volume-error">{snapshot.selection_required ? 'More than one tab matches this day. Choose the exact tab.' : 'No tab matches this day. Select an available dated worksheet.'}</p>}

      {error && <div className="workspace-notice" role="alert">{error}{snapshot && ' Showing the last loaded copy.'}</div>}
      {loading && !snapshot && <div className="cars-sheet-message" role="status">Loading cars from Google Sheets…</div>}
      {!loading && !snapshot && !error && <div className="cars-sheet-message">The Google Sheet is empty.</div>}
      {snapshot && cars.length === 0 && <div className="cars-sheet-message">No car groups were found in the sheet.</div>}

      {snapshot && cars.length > 0 && <>
        <div className="cars-summary">
          <div><span>Cars</span><strong>{cars.length}</strong></div>
          <div><span>Seal entries</span><strong>{totalSeals.toLocaleString()}</strong></div>
          <div><span>Source rows</span><strong>{snapshot.rows.length.toLocaleString()}</strong></div>
          <div><span>Fetched</span><strong className="cars-summary-time">{new Date(snapshot.fetched_at).toLocaleString()}</strong></div>
        </div>

        <div className="cars-grid" role="group" aria-label="Choose a car">
          {cars.map((item, index) => <button type="button" key={`${item.start}-${item.name}`} className={`cars-card${car === item ? ' is-active' : ''}`} aria-pressed={car === item} onClick={() => { setSelectedCar(index); setSearch(''); setShowRaw(false); }}>
            <span className="cars-card-title"><Truck size={17} /> {item.name}</span>
            <strong>{item.sealCount.toLocaleString()} seals</strong>
            <small>Master seal: {item.masterSeal || '—'}</small>
          </button>)}
        </div>

        {car && <div className="cars-detail">
          <div className="cars-detail-heading">
            <div>
              <span className="source-kind">Selected car</span>
              <h3>{car.name}</h3>
              <p>Master seal: <strong>{car.masterSeal || 'Not listed'}</strong>{car.details.length > 0 && <> · {car.details.join(' · ')}</>}</p>
            </div>
            <span className="data-count">{entries.length.toLocaleString()} of {car.entries.length.toLocaleString()} rows</span>
          </div>
          <div className="cars-toolbar">
            <label className="cars-search"><Search size={16} /><span className="sr-only">Search this car</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search seals, numbers or source rows" /></label>
            <button type="button" className="btn sm" aria-expanded={showRaw} onClick={() => setShowRaw((value) => !value)}>{showRaw ? 'Hide original grid' : 'Show original grid'}</button>
          </div>
          <div className="responsive-table-wrap cars-table-wrap"><table><thead><tr><th>Sheet row</th>{car.headers.map((header, index) => <th key={car.columns[index]}>{header}</th>)}</tr></thead><tbody>
            {entries.map((entry) => <tr key={entry.sourceRow}><td className="cars-row-number">{entry.sourceRow}</td>{entry.values.map((value, index) => <td key={car.columns[index]}>{value || <span className="cars-empty-cell">—</span>}</td>)}</tr>)}
            {entries.length === 0 && <tr><td colSpan={car.headers.length + 1}>No rows match this search.</td></tr>}
          </tbody></table></div>
        </div>}

        {showRaw && <div className="cars-detail cars-raw-grid"><div className="cars-detail-heading"><div><span className="source-kind">Original layout</span><h3>Complete source grid</h3><p>Every row and column as returned by Google Sheets.</p></div></div><div className="responsive-table-wrap cars-table-wrap"><table><thead><tr><th>Row</th>{Array.from({ length: rowWidth }, (_, index) => <th key={index}>{index + 1}</th>)}</tr></thead><tbody>{snapshot.rows.map((row, rowIndex) => <tr key={rowIndex}><td className="cars-row-number">{rowIndex + 1}</td>{Array.from({ length: rowWidth }, (_, columnIndex) => <td key={columnIndex}>{row[columnIndex] || <span className="cars-empty-cell">—</span>}</td>)}</tr>)}</tbody></table></div></div>}
      </>}
    </section>
  );
};
