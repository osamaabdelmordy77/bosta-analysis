import React, { useState, useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import { AggregationResult, HubAgg } from '../types';
import { LIGHT, PINK, GREY } from '../utils/chartSetup';
import { Download, Search } from 'lucide-react';

interface HubSectionProps {
  data: AggregationResult;
  hubBasis: string;
  onFilterHub: (hubName: string) => void;
}

export const HubSection: React.FC<HubSectionProps> = ({
  data,
  hubBasis,
  onFilterHub,
}) => {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<keyof HubAgg>('rank');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [page, setPage] = useState(0);
  const pageSize = 12;

  const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
  const fmt1 = (n: number) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  // Summary Tiles calculations
  const activeHubs = useMemo(() => data.hubRows.filter((h) => h.n > 0), [data.hubRows]);
  const hi = activeHubs[0] || null;
  const lo = activeHubs[activeHubs.length - 1] || null;
  const top10Sum = activeHubs.slice(0, 10).reduce((s, h) => s + h.n, 0);
  const totalVolume = data.totalShipments;

  // Chart 1: Top 10 Hubs
  const top10 = activeHubs.slice(0, 10);
  const top10ChartData = {
    labels: top10.map((h) => h.name),
    datasets: [
      {
        data: top10.map((h) => h.n),
        backgroundColor: top10.map((h) => (h.n >= data.avgShipmentsPerHub ? LIGHT : PINK)),
        borderRadius: 3,
        maxBarThickness: 20,
      },
    ],
  };

  const top10ChartOptions = {
    indexAxis: 'y' as const,
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 14, right: 10 } },
    onClick: (_e: unknown, elements: { index: number }[]) => {
      if (elements.length > 0) {
        const h = top10[elements[0].index];
        if (h) onFilterHub(h.name);
      }
    },
    plugins: {
      legend: { display: false },
      avgLine: { value: data.avgShipmentsPerHub },
      valLabels: { show: true },
      tooltip: {
        callbacks: {
          label: (c: any) => {
            const h = top10[c.dataIndex];
            return [
              `Shipments: ${c.parsed.x.toLocaleString()}`,
              `Share: ${pct(h.share)}`,
              `Items: ${fmt(h.items)}`,
              `Status: ${h.status}`,
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

  // Chart 2: Bottom 10 Active Hubs
  const bot10 = activeHubs.slice().sort((a, b) => a.n - b.n || a.name.localeCompare(b.name)).slice(0, 10);
  const bot10ChartData = {
    labels: bot10.map((h) => h.name),
    datasets: [
      {
        data: bot10.map((h) => h.n),
        backgroundColor: bot10.map((h) => (h.n >= data.avgShipmentsPerHub ? LIGHT : PINK)),
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
        const h = bot10[elements[0].index];
        if (h) onFilterHub(h.name);
      }
    },
    plugins: {
      legend: { display: false },
      avgLine: { value: data.avgShipmentsPerHub },
      valLabels: { show: true },
      tooltip: {
        callbacks: {
          label: (c: any) => {
            const h = bot10[c.dataIndex];
            return [
              `Shipments: ${c.parsed.x.toLocaleString()}`,
              `Share: ${pct(h.share)}`,
              `Items: ${fmt(h.items)}`,
              `Status: ${h.status}`,
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

  // Chart 3: All Hubs Vertical Bar Comparison
  const allHubsChartData = {
    labels: data.hubRows.map((h) => h.name),
    datasets: [
      {
        data: data.hubRows.map((h) => h.n),
        backgroundColor: data.hubRows.map((h) =>
          h.n === 0 ? GREY : h.n >= data.avgShipmentsPerHub ? LIGHT : PINK
        ),
        borderRadius: 3,
        maxBarThickness: 28,
      },
    ],
  };

  const allHubsChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    onClick: (_e: unknown, elements: { index: number }[]) => {
      if (elements.length > 0) {
        const h = data.hubRows[elements[0].index];
        if (h) onFilterHub(h.name);
      }
    },
    plugins: {
      legend: { display: false },
      avgLine: { value: data.avgShipmentsPerHub },
      tooltip: {
        callbacks: {
          label: (c: any) => {
            const h = data.hubRows[c.dataIndex];
            return [
              `Shipments: ${c.parsed.y.toLocaleString()}`,
              `Share: ${pct(h.share)}`,
              `Items: ${fmt(h.items)}`,
              `Status: ${h.status}`,
            ];
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          autoSkip: false,
          maxRotation: 90,
          minRotation: 60,
          font: { size: 9 },
          callback: function (this: any, val: any): string {
            const l = this.getLabelForValue(val);
            return String(l).length > 16 ? `${String(l).slice(0, 15)}…` : String(l);
          },
        },
      },
      y: { grid: { color: '#16224a' }, ticks: { precision: 0 } },
    },
  };

  // Table filtering and sorting
  const filteredRows = useMemo(() => {
    let list = data.hubRows;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((h) => h.name.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') {
        return av.localeCompare(bv) * sortDir;
      }
      return ((av as number) - (bv as number)) * sortDir;
    });
  }, [data.hubRows, search, sortKey, sortDir]);

  const maxShare = data.hubRows[0]?.share || 1;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const paginatedRows = filteredRows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  const handleSort = (key: keyof HubAgg) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 1 : -1);
    }
    setPage(0);
  };

  const exportCSV = () => {
    const headers = ['Rank', 'Hub', 'Shipments', '% of Shipments', 'Cumulative %', 'Items', 'vs Average', 'Status'];
    const rows = filteredRows.map((h) => [
      h.rank,
      `"${h.name.replace(/"/g, '""')}"`,
      h.n,
      pct(h.share),
      pct(h.cum),
      h.items,
      h.n === 0 ? '—' : `${(h.vs * 100).toFixed(1)}%`,
      `"${h.status}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `hub_ranking_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="sec" id="hubSection">
      <h3>Hub Performance</h3>
      <p className="lead">
        Hub volume is measured on <b>“{hubBasis}”</b> (the hub each shipment is assigned to for delivery).
        Other hub fields are <b>not</b> mixed into the ranking; they are used only to list the hubs that exist in the network.
        Averages divide by <b>active</b> hubs.
      </p>

      {/* Summary Tiles */}
      <div className="tiles">
        <div className="tile">
          <small>Highest-volume hub</small>
          <b title={hi ? hi.name : '—'}>{hi ? hi.name : '—'}</b>
          <span>{hi ? `${fmt(hi.n)} shipments · ${pct(hi.share)}` : 'None'}</span>
        </div>
        <div className="tile">
          <small>Lowest-volume active hub</small>
          <b title={lo ? lo.name : '—'}>{lo ? lo.name : '—'}</b>
          <span>{lo ? `${fmt(lo.n)} shipments · ${pct(lo.share)}` : 'None'}</span>
        </div>
        <div className="tile">
          <small>Average shipments per active hub</small>
          <b>{fmt1(data.avgShipmentsPerHub)}</b>
          <span>
            {fmt(data.activeHubs)} active hubs · {fmt(data.zeroHubs)} with none
          </span>
        </div>
        <div className="tile">
          <small>Top 10 hubs’ share of shipments</small>
          <b>{totalVolume > 0 ? pct(top10Sum / totalVolume) : '—'}</b>
          <span>
            {fmt(top10Sum)} of {fmt(totalVolume)} shipments
          </span>
        </div>
      </div>

      {/* Top 10 and Bottom 10 Row */}
      <div className="row2">
        <div className="box">
          <h4>Top 10 hubs by shipment volume</h4>
          <div className="sub">Dashed line = average shipments per active hub</div>
          <div className="cbox" style={{ height: '330px' }}>
            <Bar data={top10ChartData} options={top10ChartOptions} />
          </div>
        </div>

        <div className="box">
          <h4>Bottom 10 hubs by shipment volume</h4>
          <div className="sub">
            Active hubs only ({data.zeroHubs} hubs with no shipments are in table below)
          </div>
          <div className="cbox" style={{ height: '330px' }}>
            <Bar data={bot10ChartData} options={bot10ChartOptions} />
          </div>
        </div>
      </div>

      {/* All Hubs Comparison Bar Chart */}
      <div className="box mb-4">
        <h4>Hub performance comparison — every hub vs the average</h4>
        <div className="sub">
          Pink = below average, light blue = above average, grey = no shipments. Hover for share and items.
        </div>
        <div className="cbox" style={{ height: '360px' }}>
          <Bar data={allHubsChartData} options={allHubsChartOptions} />
        </div>
      </div>

      {/* Full Hub Table */}
      <h4 style={{ margin: '6px 0 8px' }}>Full hub ranking (all hubs, highest to lowest)</h4>
      <div className="dt-tools">
        <div className="relative">
          <input
            type="search"
            placeholder="Search hub name…"
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

        <span className="dt-info">{filteredRows.length.toLocaleString()} hubs</span>
      </div>

      <div className="dt-wrap">
        <table>
          <thead>
            <tr>
              <th onClick={() => handleSort('rank')}>
                Rank {sortKey === 'rank' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}
              </th>
              <th onClick={() => handleSort('name')}>
                Hub {sortKey === 'name' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}
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
              <th className="r" onClick={() => handleSort('vs')}>
                vs average {sortKey === 'vs' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}
              </th>
              <th onClick={() => handleSort('status')}>
                Status {sortKey === 'status' && <span className="ar">{sortDir > 0 ? '▲' : '▼'}</span>}
              </th>
            </tr>
          </thead>
          <tbody>
            {paginatedRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-slate-400 p-4">
                  No hubs match search
                </td>
              </tr>
            ) : (
              paginatedRows.map((h) => (
                <tr
                  key={h.name}
                  className="cursor-pointer"
                  onClick={() => onFilterHub(h.name)}
                  title={`Click to filter by ${h.name}`}
                >
                  <td>{h.rank}</td>
                  <td className="font-medium text-slate-200">{h.name}</td>
                  <td className="r">{fmt(h.n)}</td>
                  <td className="r">
                    <span
                      className="mb"
                      style={{
                        width: `${Math.max(1, Math.round((h.share / maxShare) * 60))}px`,
                      }}
                    />
                    {pct(h.share)}
                  </td>
                  <td className="r">{pct(h.cum)}</td>
                  <td className="r">{fmt(h.items)}</td>
                  <td className="r">
                    {h.n === 0 ? '—' : `${h.vs >= 0 ? '+' : ''}${(h.vs * 100).toFixed(1)}%`}
                  </td>
                  <td>
                    <span
                      className={`pill ${
                        h.n === 0 ? 'z' : h.n >= data.avgShipmentsPerHub ? 'up' : 'dn'
                      }`}
                    >
                      {h.status}
                    </span>
                  </td>
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
