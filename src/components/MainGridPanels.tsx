import React from 'react';
import { Bar, Doughnut } from 'react-chartjs-2';
import { AggregationResult } from '../types';
import { BLUE, LIGHT, PINK, PAL } from '../utils/chartSetup';

interface MainGridPanelsProps {
  data: AggregationResult;
  onFilterHub: (hubName: string) => void;
  onFilterBiz: (bizName: string) => void;
  onFilterShipType: (st: string) => void;
  onFilterPkgType: (pt: string) => void;
}

export const MainGridPanels: React.FC<MainGridPanelsProps> = ({
  data,
  onFilterHub,
  onFilterBiz,
  onFilterShipType,
  onFilterPkgType,
}) => {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Top 10 Hubs Chart Data
  const top10Hubs = data.hubRows.filter((h) => h.n > 0).slice(0, 10);
  const hubChartData = {
    labels: top10Hubs.map((h) => h.name),
    datasets: [
      {
        data: top10Hubs.map((h) => h.n),
        backgroundColor: top10Hubs.map((h) => (h.n >= data.avgShipmentsPerHub ? LIGHT : PINK)),
        borderRadius: 3,
        maxBarThickness: 20,
      },
    ],
  };

  const hubChartOptions = {
    indexAxis: 'y' as const,
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 14, right: 12 } },
    onClick: (_e: unknown, elements: { index: number }[]) => {
      if (elements.length > 0) {
        const hub = top10Hubs[elements[0].index];
        if (hub) onFilterHub(hub.name);
      }
    },
    plugins: {
      legend: { display: false },
      avgLine: { value: data.avgShipmentsPerHub },
      valLabels: { show: true },
      tooltip: {
        callbacks: {
          label: (c: any) => {
            const h = top10Hubs[c.dataIndex];
            return [
              `Shipments: ${c.parsed.x.toLocaleString()}`,
              `Share: ${(h.share * 100).toFixed(1)}%`,
              `Items: ${h.items.toLocaleString()}`,
              `Status: ${h.status}`,
            ];
          },
        },
      },
    },
    scales: {
      x: {
        grace: '14%',
        grid: { color: '#e7edf3' },
        ticks: { precision: 0 },
      },
      y: {
        grid: { display: false },
        ticks: {
          autoSkip: false,
          callback: function (this: any, val: any): string {
            const label = this.getLabelForValue(val);
            return String(label).length > 20 ? `${String(label).slice(0, 19)}…` : String(label);
          },
        },
      },
    },
  };

  // Top 10 Businesses Chart Data
  const top10Biz = data.bizRows.slice(0, 10);
  const bizChartData = {
    labels: top10Biz.map((b) => b.name),
    datasets: [
      {
        data: top10Biz.map((b) => b.n),
        backgroundColor: top10Biz.map((b) => (b.n >= data.avgShipmentsPerBiz ? LIGHT : PINK)),
        borderRadius: 3,
        maxBarThickness: 20,
      },
    ],
  };

  const bizChartOptions = {
    indexAxis: 'y' as const,
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 14, right: 12 } },
    onClick: (_e: unknown, elements: { index: number }[]) => {
      if (elements.length > 0) {
        const b = top10Biz[elements[0].index];
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
            const b = top10Biz[c.dataIndex];
            return [
              `Shipments: ${c.parsed.x.toLocaleString()}`,
              `Share: ${(b.share * 100).toFixed(1)}%`,
              `Items: ${b.items.toLocaleString()}`,
            ];
          },
        },
      },
    },
    scales: {
      x: {
        grace: '14%',
        grid: { color: '#e7edf3' },
        ticks: { precision: 0 },
      },
      y: {
        grid: { display: false },
        ticks: {
          autoSkip: false,
          callback: function (this: any, val: any): string {
            const label = this.getLabelForValue(val);
            return String(label).length > 20 ? `${String(label).slice(0, 19)}…` : String(label);
          },
        },
      },
    },
  };

  // Shipment Type Doughnut
  const typeChartData = {
    labels: data.shipTypeRows.map((s) => s.name),
    datasets: [
      {
        data: data.shipTypeRows.map((s) => s.n),
        backgroundColor: data.shipTypeRows.map((_, i) => PAL[i % PAL.length]),
        borderColor: '#ffffff',
        borderWidth: 2,
      },
    ],
  };

  const typeChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '66%',
    onClick: (_e: unknown, elements: { index: number }[]) => {
      if (elements.length > 0) {
        const s = data.shipTypeRows[elements[0].index];
        if (s) onFilterShipType(s.name);
      }
    },
    plugins: {
      legend: {
        position: 'right' as const,
        labels: { color: '#52677e', boxWidth: 10, font: { size: 11 } },
      },
      centerText: {
        lines: [data.totalShipments.toLocaleString(), 'shipments'],
      },
      tooltip: {
        callbacks: {
          label: (c: any) => {
            const pct = data.totalShipments > 0 ? (c.parsed / data.totalShipments) * 100 : 0;
            return ` ${c.label}: ${c.parsed.toLocaleString()} (${pct.toFixed(1)}%)`;
          },
        },
      },
    },
  };

  // Package Type Horizontal Bar
  const pkgChartData = {
    labels: data.pkgTypeRows.slice(0, 8).map((p) => p.name),
    datasets: [
      {
        data: data.pkgTypeRows.slice(0, 8).map((p) => p.n),
        backgroundColor: BLUE,
        borderRadius: 3,
        maxBarThickness: 18,
      },
    ],
  };

  const pkgChartOptions = {
    indexAxis: 'y' as const,
    responsive: true,
    maintainAspectRatio: false,
    onClick: (_e: unknown, elements: { index: number }[]) => {
      if (elements.length > 0) {
        const p = data.pkgTypeRows[elements[0].index];
        if (p) onFilterPkgType(p.name);
      }
    },
    plugins: {
      legend: { display: false },
      valLabels: { show: true },
      tooltip: {
        callbacks: {
          label: (c: any) => ` Shipments: ${c.parsed.x.toLocaleString()}`,
        },
      },
    },
    scales: {
      x: {
        grace: '14%',
        grid: { color: '#e7edf3' },
        ticks: { precision: 0 },
      },
      y: {
        grid: { display: false },
        ticks: { autoSkip: false },
      },
    },
  };

  const topHubShareMax = top10Hubs[0]?.share || 1;
  const topBizShareMax = top10Biz[0]?.share || 1;

  return (
    <section className="grid3">
      {/* Hubs Panel */}
      <div className="panel">
        <div className="ph">
          <div className="ic">
            <svg viewBox="0 0 24 24">
              <path d="M3 10l2-6h14l2 6" />
              <path d="M4 10v10h16V10" />
              <path d="M9 20v-6h6v6" />
            </svg>
          </div>
          <div className="t">
            <b>Hubs</b>
            <span>
              No of Hubs: {data.totalHubs.toLocaleString()} · Active: {data.activeHubs.toLocaleString()}
            </span>
          </div>
          <button className="btn" onClick={() => scrollTo('hubSection')}>
            See more &gt;
          </button>
        </div>

        <div className="pb">
          <h4>Top 10 hubs vs average</h4>
          <div className="sub">
            Assigned hub basis. Dashed line = average per active hub
          </div>
          <div className="cbox" style={{ height: '310px' }}>
            <Bar data={hubChartData} options={hubChartOptions} />
          </div>
        </div>

        <div className="pb">
          <h4>Hub performance ranking</h4>
          <div className="sub">All active hubs, highest to lowest, with % of shipments</div>
          <div className="rklist">
            {top10Hubs.length === 0 ? (
              <div className="text-slate-400 text-xs p-3">No active hubs matching filters</div>
            ) : (
              data.hubRows
                .filter((h) => h.n > 0)
                .slice(0, 100)
                .map((h) => (
                  <div
                    key={h.name}
                    className="rk"
                    onClick={() => onFilterHub(h.name)}
                    title={`${h.name} — ${h.n.toLocaleString()} shipments (${(h.share * 100).toFixed(1)}%)`}
                  >
                    <span className="no">{h.rank}</span>
                    <span className="nm">{h.name}</span>
                    <div className="tr">
                      <i
                        className={h.n < data.avgShipmentsPerHub ? 'dn' : ''}
                        style={{
                          width: `${Math.max(2, (h.share / topHubShareMax) * 100).toFixed(1)}%`,
                        }}
                      />
                    </div>
                    <span className="pc">{(h.share * 100).toFixed(1)}%</span>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>

      {/* Businesses Panel */}
      <div className="panel">
        <div className="ph">
          <div className="ic">
            <svg viewBox="0 0 24 24">
              <rect x="3" y="7" width="18" height="13" rx="2" />
              <path d="M9 7V4h6v3" />
              <path d="M3 13h18" />
            </svg>
          </div>
          <div className="t">
            <b>Businesses</b>
            <span>No of Businesses: {data.bizRows.length.toLocaleString()}</span>
          </div>
          <button className="btn" onClick={() => scrollTo('bizSection')}>
            See more &gt;
          </button>
        </div>

        <div className="pb">
          <h4>Top 10 businesses vs average</h4>
          <div className="sub">Shipments per business; dashed line = average per business</div>
          <div className="cbox" style={{ height: '310px' }}>
            <Bar data={bizChartData} options={bizChartOptions} />
          </div>
        </div>

        <div className="pb">
          <h4>Business ranking</h4>
          <div className="sub">Top 100 businesses with % of shipments</div>
          <div className="rklist">
            {data.bizRows.length === 0 ? (
              <div className="text-slate-400 text-xs p-3">No businesses matching filters</div>
            ) : (
              data.bizRows.slice(0, 100).map((b) => (
                <div
                  key={b.name}
                  className="rk"
                  onClick={() => onFilterBiz(b.name)}
                  title={`${b.name} — ${b.n.toLocaleString()} shipments (${(b.share * 100).toFixed(1)}%)`}
                >
                  <span className="no">{b.rank}</span>
                  <span className="nm">{b.name}</span>
                  <div className="tr">
                    <i
                      className={b.n < data.avgShipmentsPerBiz ? 'dn' : ''}
                      style={{
                        width: `${Math.max(2, (b.share / topBizShareMax) * 100).toFixed(1)}%`,
                      }}
                    />
                  </div>
                  <span className="pc">{(b.share * 100).toFixed(1)}%</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Shipment Mix Panel */}
      <div className="panel">
        <div className="ph">
          <div className="ic">
            <svg viewBox="0 0 24 24">
              <path d="M3 7l9-4 9 4-9 4-9-4z" />
              <path d="M3 7v10l9 4 9-4V7" />
              <path d="M12 11v10" />
            </svg>
          </div>
          <div className="t">
            <b>Shipment Mix</b>
            <span>
              Types: {data.shipTypeRows.length} · Package Types: {data.pkgTypeRows.length}
            </span>
          </div>
          <button className="btn" onClick={() => scrollTo('geoSection')}>
            See more &gt;
          </button>
        </div>

        <div className="pb">
          <h4>Shipments by shipment type</h4>
          <div className="sub">Click a slice to filter dashboard</div>
          <div className="cbox" style={{ height: '260px' }}>
            <Doughnut data={typeChartData} options={typeChartOptions} />
          </div>
        </div>

        <div className="pb">
          <h4>Shipments by package type</h4>
          <div className="sub">Click a bar to filter dashboard</div>
          <div className="cbox" style={{ height: '230px' }}>
            <Bar data={pkgChartData} options={pkgChartOptions} />
          </div>
        </div>
      </div>
    </section>
  );
};
