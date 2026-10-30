import React, { useState, useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import { AggregationResult, BizAgg } from '../types';
import { BLUE, LIGHT, PINK } from '../utils/chartSetup';
import { Download } from 'lucide-react';

interface BusinessSectionProps {
  data: AggregationResult;
  onFilterBiz: (bizName: string) => void;
}

export const BusinessSection: React.FC<BusinessSectionProps> = ({
  data,
  onFilterBiz,
}) => {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<keyof BizAgg>('rank');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [page, setPage] = useState(0);
  const pageSize = 12;

  const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
  const fmt1 = (n: number) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  const rows = data.bizRows;
  const hi = rows[0] || null;
  const lo = rows[rows.length - 1] || null;
  const top10Sum = rows.slice(0, 10).reduce((s, b) => s + b.n, 0);
  const totalVolume = data.totalShipments;
  const singleShipmentCount = rows.filter((b) => b.n === 1).length;

  // Median calculation
  const sortedCounts = useMemo(() => rows.map((r) => r.n).sort((a, b) => a - b), [rows]);
  const median = useMemo(() => {
    if (!sortedCounts.length) return 0;
    const mid = Math.floor(sortedCounts.length / 2);
    return sortedCounts.length % 2 !== 0
      ? sortedCounts[mid]
      : (sortedCounts[mid - 1] + sortedCounts[mid]) / 2;
  }, [sortedCounts]);

  // Chart 1: Bottom 10 Businesses
  const bot10 = useMemo(() => {
    return rows.slice().sort((a, b) => a.n - b.n || a.name.localeCompare(b.name)).slice(0, 10);
  }, [rows]);

  const bot10ChartData = {
    labels: bot10.map((b) => b.name),
    datasets: [
      {
        data: bot10.map((b) => b.n),
        backgroundColor: bot10.map((b) => (b.n >= data.avgShipmentsPerBiz ? LIGHT : PINK)),
        borderRadius: 3,
        maxBarThickness: 20,
      },
    ],
  };

  const bot10ChartOptions = {
    indexAxis: 'y' as const,
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 14, right: 10 } },
    onClick: (_e: unknown, elements: { index: number }[]) => {
      if (elements.length > 0) {
        const b = bot10[elements[0].index];
        if (b) onFilterBiz(b.name);
      }
    },
    plugins: {
      legend: { display: false },
      avgLine: { value: data.avgShipmentsPerBiz },
      valLabels: { show: true },
      tooltip: {
        callbacks: {
          label: (c: any) => {
            const b = bot10[c.dataIndex];
            return [
              `Shipments: ${c.parsed.x.toLocaleString()}`,
              `Share: ${pct(b.share)}`,
              `Items: ${fmt(b.items)}`,
            ];
          },
        },
      },
    },
    scales: {
      x: { grace: '14%', grid: { color: '#16224a' }, ticks: { precision: 0 } },
      y: { grid: { display: false }, ticks: { autoSkip: false } },
    },
  };

  // Chart 2: Distribution by volume bands
  const bands = [
    { label: '1', min: 1, max: 1 },
    { label: '2–5', min: 2, max: 5 },
    { label: '6–10', min: 6, max: 10 },
    { label: '11–25', min: 11, max: 25 },
    { label: '26–50', min: 26, max: 50 },
    { label: '51–100', min: 51, max: 100 },
    { label: '100+', min: 101, max: Infinity },
  ];

  const bandCounts = bands.map(() => 0);
  const bandShipments = bands.map(() => 0);

  rows.forEach((r) => {
    const idx = bands.findIndex((b) => r.n >= b.min && r.n <= b.max);
    if (idx >= 0) {
      bandCounts[idx]++;
      bandShipments[idx] += r.n;
    }
  });

  const distChartData = {
    labels: bands.map((b) => `${b.label} shipments`),
    datasets: [
      {
        label: 'Businesses',
        data: bandCounts,
        backgroundColor: BLUE,
        borderRadius: 3,
        yAxisID: 'y',
      },
      {
        label: '% of shipments',
        data: bandShipments.map((v) => (totalVolume > 0 ? (v / totalVolume) * 100 : 0)),
        backgroundColor: LIGHT,
        borderRadius: 3,
        yAxisID: 'y1',
      },
    ],
  };

  const distChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#c4cff0', boxWidth: 10 } },
      tooltip: {
        callbacks: {
          label: (c: any) =>
            c.datasetIndex === 1
              ? ` ${c.parsed.y.toFixed(1)}% of shipments`
              : ` ${fmt(c.parsed.y)} businesses`,
        },
      },
    },
    scales: {
      x: { grid: { display: false } },
      y: {
        grid: { color: '#16224a' },
        title: { display: true, text: 'Businesses' },
        ticks: { precision: 0 },
      },
      y1: {
        position: 'right' as const,
        grid: { display: false },
        title: { display: true, text: '% of shipments' },
        ticks: {
          callback: (v: any) => `${v}%`,
        },
      },
    },
  };

  // Table filtering and sorting
  const filteredRows = useMemo(() => {
    let list = rows;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((b) => b.name.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') {
        return av.localeCompare(bv) * sortDir;
      }
      return ((av as number) - (bv as number)) * sortDir;
    });
  }, [rows, search, sortKey, sortDir]);

  const maxShare = rows[0]?.share || 1;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const paginatedRows = filteredRows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  const handleSort = (key: keyof BizAgg) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 1 : -1);
    }
    setPage(0);
  };

  const exportCSV = () => {
    const headers = ['Rank', 'Business', 'Shipments', '% of Shipments', 'Cumulative %', 'Items', 'Items / Shipment'];
    const csvRows = filteredRows.map((b) => [
      b.rank,
      `"${b.name.replace(/"/g, '""')}"`,
      b.n,
      pct(b.share),
      pct(b.cum),
      b.items,
      b.ips.toFixed(2),
    ]);

    const csvContent = [headers.join(','), ...csvRows.map((r) => r.join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `business_ranking_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="sec" id="bizSection">
      <h3>Business Analysis</h3>
      <p className="lead">
        Businesses are counted by distinct name; each shipment belongs to exactly one business,
        so shares add up to 100%. Averages divide by businesses that have at least one shipment under current filters.
      </p>

      {/* Summary Tiles */}
      <div className="tiles">
        <div className="tile">
          <small>Average shipments per business</small>
          <b>{fmt1(data.avgShipmentsPerBiz)}</b>
          <span>Median {fmt1(median)} (large merchants lift the average)</span>
        </div>
        <div className="tile">
          <small>Highest-volume business</small>
          <b title={hi ? hi.name : '—'}>{hi ? hi.name : '—'}</b>
          <span>{hi ? `${fmt(hi.n)} shipments · ${pct(hi.share)}` : 'None'}</span>
        </div>
        <div className="tile">
          <small>Top 10 businesses’ share</small>
          <b>{totalVolume > 0 ? pct(top10Sum / totalVolume) : '—'}</b>
          <span>
            {fmt(top10Sum)} of {fmt(totalVolume)} shipments
          </span>
        </div>
        <div className="tile">
          <small>Single shipment businesses</small>
          <b>{fmt(singleShipmentCount)}</b>
          <span>{rows.length > 0 ? pct(singleShipmentCount / rows.length) : '0%'} of businesses</span>
        </div>
      </div>

      {/* Row of Charts */}
      <div className="row2">
        <div className="box">
          <h4>Bottom 10 businesses by shipment volume</h4>
          <div className="sub">Lowest-volume merchants with active shipments</div>
          <div className="cbox" style={{ height: '330px' }}>
            <Bar data={bot10ChartData} options={bot10ChartOptions} />
          </div>
        </div>

        <div className="box">
          <h4>Distribution of businesses by shipment volume</h4>
          <div className="sub">
            How many businesses fall in each volume band, and what share of shipments they generate
          </div>
          <div className="cbox" style={{ height: '330px' }}>
            <Bar data={distChartData} options={distChartOptions} />
          </div>
        </div>
      </div>

      {/* Full Business Table */}
      <h4 style={{ margin: '6px 0 8px' }}>Full business ranking</h4>
      <div className="dt-tools">
        <div className="relative">
          <input
            type="search"
            placeholder="Search business name…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </div>

        <button type="button" className="btn sm" onClick={exportCSV}>
          <Download className="w-3.5 h-3.5" />
          <span>Export CSV</span>
        </button>

        <span className="dt-info">{filteredRows.length.toLocaleString()} businesses</span>
      </div>

      <div className="dt-wrap">
        <table>
          <thead>
            <tr>
              <th onClick={() => handleSort('rank')}>
                Rank {sortKey === 'rank' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}
              </th>
              <th onClick={() => handleSort('name')}>
                Business {sortKey === 'name' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}
              </th>
              <th className="r" onClick={() => handleSort('n')}>
                Shipments {sortKey === 'n' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}
              </th>
              <th className="r" onClick={() => handleSort('share')}>
                % of shipments {sortKey === 'share' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}
              </th>
              <th className="r" onClick={() => handleSort('cum')}>
                Cumulative % {sortKey === 'cum' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}
              </th>
              <th className="r" onClick={() => handleSort('items')}>
                Items {sortKey === 'items' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}
              </th>
              <th className="r" onClick={() => handleSort('ips')}>
                Items / shipment {sortKey === 'ips' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}
              </th>
            </tr>
          </thead>
          <tbody>
            {paginatedRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-slate-400 p-4">
                  No businesses match search
                </td>
              </tr>
            ) : (
              paginatedRows.map((b) => (
                <tr
                  key={b.name}
                  className="cursor-pointer"
                  onClick={() => onFilterBiz(b.name)}
                  title={`Click to filter by ${b.name}`}
                >
                  <td>{b.rank}</td>
                  <td className="font-medium text-slate-200">{b.name}</td>
                  <td className="r">{fmt(b.n)}</td>
                  <td className="r">
                    <span
                      className="mb"
                      style={{
                        width: `${Math.max(1, Math.round((b.share / maxShare) * 60))}px`,
                      }}
                    />
                    {pct(b.share)}
                  </td>
                  <td className="r">{pct(b.cum)}</td>
                  <td className="r">{fmt(b.items)}</td>
                  <td className="r font-medium text-sky-300">{fmt1(b.ips)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
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
