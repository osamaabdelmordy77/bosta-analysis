import React, { useState, useMemo } from 'react';
import { ShipmentRecord } from '../types';
import { Download } from 'lucide-react';

interface ShipmentExplorerSectionProps {
  shipments: ShipmentRecord[];
}

export const ShipmentExplorerSection: React.FC<ShipmentExplorerSectionProps> = ({
  shipments,
}) => {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<keyof ShipmentRecord>('shipmentDate');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  const filteredShipments = useMemo(() => {
    let list = shipments;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) => {
        return (
          r.tracking.toLowerCase().includes(q) ||
          r.shipmentDate.includes(q) ||
          (r.business && r.business.toLowerCase().includes(q)) ||
          (r.assignedHub && r.assignedHub.toLowerCase().includes(q)) ||
          (r.pickupCity && r.pickupCity.toLowerCase().includes(q)) ||
          (r.dropCity && r.dropCity.toLowerCase().includes(q)) ||
          (r.shipType && r.shipType.toLowerCase().includes(q)) ||
          (r.packageType && r.packageType.toLowerCase().includes(q))
        );
      });
    }

    return [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string' && typeof bv === 'string') {
        return av.localeCompare(bv) * sortDir;
      }
      return ((av as number) - (bv as number)) * sortDir;
    });
  }, [shipments, search, sortKey, sortDir]);

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

  const exportCSV = () => {
    const headers = [
      'Shipment Date',
      'Tracking Number',
      'Business',
      'Shipment Type',
      'Package Type',
      'Package Size',
      'Pickup City',
      'Pickup Zone',
      'DropOff City',
      'Assigned Hub',
      'Items',
      'Source File',
    ];

    const rows = filteredShipments.map((r) => [
      r.shipmentDate,
      `"${r.tracking.replace(/"/g, '""')}"`,
      `"${(r.business || '').replace(/"/g, '""')}"`,
      `"${(r.shipType || '').replace(/"/g, '""')}"`,
      `"${(r.packageType || '').replace(/"/g, '""')}"`,
      `"${(r.packageSize || '').replace(/"/g, '""')}"`,
      `"${(r.pickupCity || '').replace(/"/g, '""')}"`,
      `"${(r.pickupZone || '').replace(/"/g, '""')}"`,
      `"${(r.dropCity || '').replace(/"/g, '""')}"`,
      `"${(r.assignedHub || '').replace(/"/g, '""')}"`,
      r.items,
      `"${r.fileName.replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `shipments_explorer_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="sec" id="listSection">
      <h3>Shipment Explorer</h3>
      <p className="lead">
        Every shipment matching the current filters (one row per distinct tracking number).
        Search, sort and export full records.
      </p>

      <div className="dt-tools">
        <input
          type="search"
          placeholder="Search by tracking, business, hub, city…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Rows:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
            className="bg-[#0a1330] border border-[#1d2a4d] rounded px-2 py-1 text-xs text-slate-200 outline-none"
          >
            <option value={15}>15</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>

        <button type="button" className="btn sm" onClick={exportCSV}>
          <Download className="w-3.5 h-3.5" />
          <span>Export Filtered CSV</span>
        </button>

        <span className="dt-info">
          {filteredShipments.length.toLocaleString()} matching shipment
          {filteredShipments.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="dt-wrap">
        <table>
          <thead>
            <tr>
              <th onClick={() => handleSort('shipmentDate')}>
                Shipment Date {sortKey === 'shipmentDate' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}
              </th>
              <th onClick={() => handleSort('tracking')}>
                Tracking Number {sortKey === 'tracking' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}
              </th>
              <th onClick={() => handleSort('business')}>
                Business {sortKey === 'business' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}
              </th>
              <th onClick={() => handleSort('shipType')}>
                Type {sortKey === 'shipType' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}
              </th>
              <th onClick={() => handleSort('packageType')}>
                Package Type {sortKey === 'packageType' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}
              </th>
              <th onClick={() => handleSort('packageSize')}>
                Size {sortKey === 'packageSize' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}
              </th>
              <th onClick={() => handleSort('pickupCity')}>
                Pickup City {sortKey === 'pickupCity' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}
              </th>
              <th onClick={() => handleSort('pickupZone')}>
                Pickup Zone {sortKey === 'pickupZone' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}
              </th>
              <th onClick={() => handleSort('dropCity')}>
                DropOff City {sortKey === 'dropCity' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}
              </th>
              <th onClick={() => handleSort('assignedHub')}>
                Hub {sortKey === 'assignedHub' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}
              </th>
              <th className="r" onClick={() => handleSort('items')}>
                Items {sortKey === 'items' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}
              </th>
            </tr>
          </thead>
          <tbody>
            {paginatedRows.length === 0 ? (
              <tr>
                <td colSpan={11} className="text-center text-slate-400 p-6">
                  No shipments found matching current filters
                </td>
              </tr>
            ) : (
              paginatedRows.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold text-slate-300">{r.shipmentDate}</td>
                  <td className="font-mono text-xs text-sky-400 select-all">{r.tracking}</td>
                  <td className="text-slate-200">{r.business || '—'}</td>
                  <td>{r.shipType || '—'}</td>
                  <td>{r.packageType || '—'}</td>
                  <td>{r.packageSize || '—'}</td>
                  <td>{r.pickupCity || '—'}</td>
                  <td>{r.pickupZone || '—'}</td>
                  <td>{r.dropCity || '—'}</td>
                  <td className="font-medium text-slate-300">{r.assignedHub || '—'}</td>
                  <td className="r font-semibold text-emerald-400">{r.items}</td>
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
    </section>
  );
};
