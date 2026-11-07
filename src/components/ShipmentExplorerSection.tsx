import React, { useState, useMemo, useEffect } from 'react';
import { ShipmentRecord } from '../types';
import { Copy, FileSpreadsheet, X } from 'lucide-react';
import { formatElapsedMinutes, getElapsedMinutes, parseShipmentDateTime } from '../utils/receiveDateTime';

interface ShipmentExplorerSectionProps {
  shipments: ShipmentRecord[];
  showReceiveFields?: boolean;
}

export const ShipmentExplorerSection: React.FC<ShipmentExplorerSectionProps> = ({
  shipments,
  showReceiveFields = false,
}) => {
  const [sortKey, setSortKey] = useState<keyof ShipmentRecord>('shipmentDate');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [selectedRecord, setSelectedRecord] = useState<ShipmentRecord | null>(null);
  const [copyMessage, setCopyMessage] = useState('');

  useEffect(() => {
    if (!selectedRecord) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedRecord(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedRecord]);

  const filteredShipments = useMemo(() => {
    return [...shipments].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (sortKey === 'pickedUpDate' || sortKey === 'receivedTime') {
        const left = parseShipmentDateTime(av as string | null)?.getTime();
        const right = parseShipmentDateTime(bv as string | null)?.getTime();
        if (left == null && right == null) return 0;
        if (left == null) return 1;
        if (right == null) return -1;
        return (left - right) * sortDir;
      }
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string' && typeof bv === 'string') {
        return av.localeCompare(bv) * sortDir;
      }
      return ((av as number) - (bv as number)) * sortDir;
    });
  }, [shipments, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filteredShipments.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const paginatedRows = filteredShipments.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize
  );

  const handleSort = (key: keyof ShipmentRecord) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(key === 'items' ? -1 : 1);
    }
    setPage(0);
  };

  const copyTracking = async (tracking: string) => {
    try {
      await navigator.clipboard.writeText(tracking);
      setCopyMessage(`Tracking ${tracking} copied.`);
    } catch {
      setCopyMessage('Clipboard access is unavailable in this browser.');
    }
  };

  return (
    <section className="sec" id="listSection">
      <div className="shipment-table-heading">
        <div>
          <h3>Shipment records</h3>
          <p className="lead">Imported report snapshot. Select a row to inspect its available source details.</p>
        </div>
        <span className="shipment-row-count">{filteredShipments.length.toLocaleString()} records</span>
      </div>

      <div className="dt-tools">
        <div className="flex items-center gap-2">
          <span className="text-xs">Rows per page:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
            className="table-page-size"
          >
            <option value={15}>15</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>

        <span className="dt-info">Sorted by {String(sortKey)} {sortDir > 0 ? 'ascending' : 'descending'}</span>
      </div>

      <div className="dt-wrap">
        <table>
          <thead>
            <tr>
              <th aria-sort={sortKey === 'shipmentDate' ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'}>
                <button type="button" className="table-sort-button" onClick={() => handleSort('shipmentDate')}>Report date {sortKey === 'shipmentDate' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}</button>
              </th>
              {showReceiveFields && (
                <>
                  <th aria-sort={sortKey === 'pickedUpDate' ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="table-sort-button" onClick={() => handleSort('pickedUpDate')}>Picked-Up Date {sortKey === 'pickedUpDate' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}</button>
                  </th>
                  <th aria-sort={sortKey === 'receivedTime' ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="table-sort-button" onClick={() => handleSort('receivedTime')}>Received Time {sortKey === 'receivedTime' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}</button>
                  </th>
                  <th>Elapsed</th>
                  <th>Type</th>
                  <th>Package Size</th>
                  <th>Pickup Zone</th>
                  <th>Pickup City</th>
                </>
              )}
              <th aria-sort={sortKey === 'tracking' ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'}>
                <button type="button" className="table-sort-button" onClick={() => handleSort('tracking')}>Tracking {sortKey === 'tracking' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}</button>
              </th>
              <th aria-sort={sortKey === 'business' ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'}>
                <button type="button" className="table-sort-button" onClick={() => handleSort('business')}>Business {sortKey === 'business' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}</button>
              </th>
              <th>Route</th>
              <th aria-sort={sortKey === 'assignedHub' ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'}>
                <button type="button" className="table-sort-button" onClick={() => handleSort('assignedHub')}>Assigned center {sortKey === 'assignedHub' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}</button>
              </th>
              <th>Package</th>
              <th className="r" aria-sort={sortKey === 'items' ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'}>
                <button type="button" className="table-sort-button" onClick={() => handleSort('items')}>Items {sortKey === 'items' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}</button>
              </th>
            </tr>
          </thead>
          <tbody>
            {paginatedRows.length === 0 ? (
              <tr>
              <td colSpan={showReceiveFields ? 14 : 7} className="shipment-empty-row">
                  <strong>No shipment rows match these filters</strong>
                  <span>Remove a filter or clear all to return to the report data.</span>
                </td>
              </tr>
            ) : (
              paginatedRows.map((r) => (
                <tr key={r.id} tabIndex={0} onClick={() => setSelectedRecord(r)} onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedRecord(r);
                  }
                }}>
                  <td className="record-date-cell">{r.shipmentDate || 'Not set'}</td>
                  {showReceiveFields && (
                    <>
                      <td>{r.pickedUpDate || '—'}</td>
                      <td>{r.receivedTime || '—'}</td>
                      <td>{formatElapsedMinutes(getElapsedMinutes(r.pickedUpDate, r.receivedTime))}</td>
                      <td>{r.shipType || '—'}</td>
                      <td>{r.packageSize || '—'}</td>
                      <td>{r.pickupZone || '—'}</td>
                      <td>{r.pickupCity || '—'}</td>
                    </>
                  )}
                  <td><span className="tracking-value">{r.tracking || 'Not available'}</span>{Boolean(r.tracking) && <button type="button" className="copy-tracking-button" aria-label={`Copy tracking ${r.tracking}`} onClick={(event) => { event.stopPropagation(); void copyTracking(r.tracking); }}><Copy size={14} /></button>}</td>
                  <td>{r.business || '—'}</td>
                  <td>{r.pickupCity || '—'}{r.dropCity ? ` → ${r.dropCity}` : ''}</td>
                  <td>{r.assignedHub || '—'}</td>
                  <td>{[r.shipType, r.packageType, r.packageSize].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="r numeric-cell">{r.items.toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="dt-pg">
        <button
          type="button"
          className="btn sm"
          disabled={currentPage <= 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          ‹ Prev
        </button>
        <span>
          Page {currentPage + 1} of {pageCount}
        </span>
        <button
          type="button"
          className="btn sm"
          disabled={currentPage >= pageCount - 1}
          onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
        >
          Next ›
        </button>
      </div>
      {copyMessage && <div className="copy-feedback" role="status">{copyMessage}<button type="button" onClick={() => setCopyMessage('')} aria-label="Dismiss copy message"><X size={14} /></button></div>}
      {selectedRecord && (
        <div className="record-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedRecord(null); }}>
          <aside className="record-drawer" role="dialog" aria-modal="true" aria-labelledby="record-drawer-title">
            <header><div><span className="source-kind">Imported report record</span><h2 id="record-drawer-title">Shipment details</h2></div><button type="button" className="icon-button" onClick={() => setSelectedRecord(null)} aria-label="Close shipment details"><X size={19} /></button></header>
            <div className="record-drawer-source"><FileSpreadsheet size={17} /><div><strong>{selectedRecord.fileName || 'Source file unavailable'}</strong><span>Report date · {selectedRecord.shipmentDate || 'Not set'}</span></div></div>
            <dl className="record-detail-list">
              <div><dt>Tracking</dt><dd>{selectedRecord.tracking || 'Not available'}</dd></div>
              <div><dt>Shipment type</dt><dd>{selectedRecord.shipType || 'Not available'}</dd></div>
              <div><dt>Business</dt><dd>{selectedRecord.business || 'Not available'}</dd></div>
              <div><dt>Package</dt><dd>{[selectedRecord.packageType, selectedRecord.packageSize].filter(Boolean).join(' · ') || 'Not available'}</dd></div>
              <div><dt>Pickup city</dt><dd>{selectedRecord.pickupCity || 'Not available'}</dd></div>
              <div><dt>Pickup zone</dt><dd>{selectedRecord.pickupZone || 'Not available'}</dd></div>
              <div><dt>Picked-Up Date</dt><dd>{selectedRecord.pickedUpDate || 'Not available'}</dd></div>
              <div><dt>Received Time</dt><dd>{selectedRecord.receivedTime || 'Not available'}</dd></div>
              <div><dt>Elapsed</dt><dd>{formatElapsedMinutes(getElapsedMinutes(selectedRecord.pickedUpDate, selectedRecord.receivedTime))}</dd></div>
              <div><dt>Drop-off city</dt><dd>{selectedRecord.dropCity || 'Not available'}</dd></div>
              <div><dt>Assigned center</dt><dd>{selectedRecord.assignedHub || 'Not available'}</dd></div>
              <div><dt>Items</dt><dd>{selectedRecord.items.toLocaleString()}</dd></div>
              {selectedRecord.sourceSheetIndex !== undefined && <div><dt>Source sheet</dt><dd>{selectedRecord.sourceSheetIndex + 1}</dd></div>}
              {selectedRecord.sourceRowNumber !== undefined && <div><dt>Source row</dt><dd>{selectedRecord.sourceRowNumber}</dd></div>}
            </dl>
          </aside>
        </div>
      )}
    </section>
  );
};
