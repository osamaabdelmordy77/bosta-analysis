import React, { useState } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import { AggregationResult } from '../types';
import { LIGHT, BLUE, PAL } from '../utils/chartSetup';
import { Calendar, TrendingUp, Award, Clock } from 'lucide-react';

interface TimeAnalyticsSectionProps {
  data: AggregationResult;
  onFilterDate: (date: string) => void;
  onFilterMonth: (month: string) => void;
}

export const TimeAnalyticsSection: React.FC<TimeAnalyticsSectionProps> = ({
  data,
  onFilterDate,
  onFilterMonth,
}) => {
  const [activeTab, setActiveTab] = useState<'daily' | 'monthly' | 'dow'>('daily');

  // Daily Trend Line Chart
  const dailyChartData = {
    labels: data.dailyTrend.map((d) => d.date),
    datasets: [
      {
        label: 'Daily Shipments',
        data: data.dailyTrend.map((d) => d.n),
        borderColor: LIGHT,
        backgroundColor: '#38bdf822',
        fill: true,
        tension: 0.25,
        pointRadius: data.dailyTrend.length > 40 ? 1 : 3,
        pointHoverRadius: 6,
      },
    ],
  };

  const dailyChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    onClick: (_e: unknown, elements: { index: number }[]) => {
      if (elements.length > 0) {
        const item = data.dailyTrend[elements[0].index];
        if (item) onFilterDate(item.date);
      }
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (c: any) => {
            const item = data.dailyTrend[c.dataIndex];
            return [
              `Shipments: ${c.parsed.y.toLocaleString()}`,
              `Items: ${item?.items.toLocaleString()}`,
            ];
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          maxTicksLimit: 14,
          maxRotation: 45,
          font: { size: 10 },
        },
      },
      y: {
        grid: { color: '#16224a' },
        ticks: { precision: 0 },
      },
    },
  };

  // Monthly Trend Bar Chart
  const monthlyChartData = {
    labels: data.monthlyTrend.map((m) => m.month),
    datasets: [
      {
        label: 'Shipments',
        data: data.monthlyTrend.map((m) => m.n),
        backgroundColor: BLUE,
        borderRadius: 4,
        maxBarThickness: 45,
      },
    ],
  };

  const monthlyChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    onClick: (_e: unknown, elements: { index: number }[]) => {
      if (elements.length > 0) {
        const item = data.monthlyTrend[elements[0].index];
        if (item) onFilterMonth(item.month);
      }
    },
    plugins: {
      legend: { display: false },
      valLabels: { show: true },
      tooltip: {
        callbacks: {
          label: (c: any) => {
            const item = data.monthlyTrend[c.dataIndex];
            return [
              `Shipments: ${c.parsed.y.toLocaleString()}`,
              `Items: ${item?.items.toLocaleString()}`,
            ];
          },
        },
      },
    },
    scales: {
      x: { grid: { display: false } },
      y: { grid: { color: '#16224a' }, ticks: { precision: 0 } },
    },
  };

  // Day of Week Distribution
  const dowChartData = {
    labels: data.dayOfWeekTrend.map((d) => d.day),
    datasets: [
      {
        label: 'Shipments by Day of Week',
        data: data.dayOfWeekTrend.map((d) => d.n),
        backgroundColor: data.dayOfWeekTrend.map((_, i) => PAL[i % PAL.length]),
        borderRadius: 4,
        maxBarThickness: 38,
      },
    ],
  };

  const dowChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      valLabels: { show: true },
      tooltip: {
        callbacks: {
          label: (c: any) => ` Shipments: ${c.parsed.y.toLocaleString()}`,
        },
      },
    },
    scales: {
      x: { grid: { display: false } },
      y: { grid: { color: '#16224a' }, ticks: { precision: 0 } },
    },
  };

  const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

  return (
    <section className="sec" id="timeSection">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
        <div>
          <h3>Time-Based Analytics &amp; Daily Reporting</h3>
          <p className="lead mb-0">
            Historical progression and performance trends calculated directly from filename dates.
            Filter by clicking any bar, date, or month.
          </p>
        </div>

        {/* Tab Controls */}
        <div className="flex gap-1.5 bg-[#0a1330] p-1 rounded-lg border border-[#1d2a4d]">
          <button
            type="button"
            className={`btn sm ${activeTab === 'daily' ? 'pri' : ''}`}
            onClick={() => setActiveTab('daily')}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Daily Trend</span>
          </button>
          <button
            type="button"
            className={`btn sm ${activeTab === 'monthly' ? 'pri' : ''}`}
            onClick={() => setActiveTab('monthly')}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Monthly Trend</span>
          </button>
          <button
            type="button"
            className={`btn sm ${activeTab === 'dow' ? 'pri' : ''}`}
            onClick={() => setActiveTab('dow')}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Day of Week</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Tiles */}
      <div className="tiles">
        <div className="tile">
          <small>Average Daily Volume</small>
          <b>{fmt(data.avgDailyShipments)}</b>
          <span>Across {data.dailyTrend.length} operational day(s)</span>
        </div>
        <div className="tile">
          <small>Peak Shipment Day</small>
          <b title={data.highestDay ? `${data.highestDay.date} (${fmt(data.highestDay.n)} shipments)` : '—'}>
            {data.highestDay ? data.highestDay.date : '—'}
          </b>
          <span>{data.highestDay ? `${fmt(data.highestDay.n)} shipments` : 'No data'}</span>
        </div>
        <div className="tile">
          <small>Lowest Active Day</small>
          <b title={data.lowestDay ? `${data.lowestDay.date} (${fmt(data.lowestDay.n)} shipments)` : '—'}>
            {data.lowestDay ? data.lowestDay.date : '—'}
          </b>
          <span>{data.lowestDay ? `${fmt(data.lowestDay.n)} shipments` : 'No data'}</span>
        </div>
        <div className="tile">
          <small>Historical Range</small>
          <b>{data.monthlyTrend.length} Month(s)</b>
          <span>
            {data.dailyTrend.length > 0
              ? `${data.dailyTrend[0].date} to ${data.dailyTrend[data.dailyTrend.length - 1].date}`
              : 'Single report'}
          </span>
        </div>
      </div>

      {/* Main Chart Box */}
      <div className="box mb-4">
        <div className="flex items-center justify-between mb-2">
          <h4>
            {activeTab === 'daily' && 'Daily Shipments Trend'}
            {activeTab === 'monthly' && 'Monthly Shipments Trend & Volume Comparison'}
            {activeTab === 'dow' && 'Shipments by Day of the Week'}
          </h4>
          <span className="text-xs text-slate-400">
            {activeTab === 'daily' && `${data.dailyTrend.length} dates recorded`}
            {activeTab === 'monthly' && `${data.monthlyTrend.length} months in dataset`}
            {activeTab === 'dow' && 'Aggregated operational volume'}
          </span>
        </div>

        <div className="cbox" style={{ height: '310px' }}>
          {activeTab === 'daily' && <Line data={dailyChartData} options={dailyChartOptions} />}
          {activeTab === 'monthly' && <Bar data={monthlyChartData} options={monthlyChartOptions} />}
          {activeTab === 'dow' && <Bar data={dowChartData} options={dowChartOptions} />}
        </div>
      </div>

      {/* Daily Top Performing Hubs & MoM Growth Tables */}
      <div className="row2">
        {/* Month-over-Month Comparison */}
        <div className="box">
          <div className="flex items-center gap-2 mb-2">
            <Award className="w-4 h-4 text-emerald-400" />
            <h4 className="mb-0">Month-over-Month (MoM) Growth</h4>
          </div>
          <div className="sub">Shipment volume variance between consecutive recorded months</div>

          <div className="dt-wrap" style={{ maxHeight: '240px' }}>
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="r">Shipments</th>
                  <th className="r">MoM Growth</th>
                  <th>Trend</th>
                </tr>
              </thead>
              <tbody>
                {data.monthlyMoM.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center text-slate-400">No monthly records</td>
                  </tr>
                ) : (
                  data.monthlyMoM.map((row) => (
                    <tr
                      key={row.month}
                      className="cursor-pointer"
                      onClick={() => onFilterMonth(row.month)}
                      title={`Filter by ${row.month}`}
                    >
                      <td className="font-semibold text-sky-400">{row.month}</td>
                      <td className="r">{fmt(row.n)}</td>
                      <td className="r font-semibold">
                        {row.growthPct === null ? (
                          <span className="text-slate-400">Base</span>
                        ) : (
                          <span className={row.growthPct >= 0 ? 'text-teal-300' : 'text-pink-400'}>
                            {row.growthPct >= 0 ? '+' : ''}
                            {row.growthPct.toFixed(1)}%
                          </span>
                        )}
                      </td>
                      <td>
                        {row.growthPct === null ? (
                          <span className="pill z">Initial</span>
                        ) : row.growthPct >= 0 ? (
                          <span className="pill up">▲ Growth</span>
                        ) : (
                          <span className="pill dn">▼ Drop</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Daily Top Hubs Highlights */}
        <div className="box">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-amber-400" />
            <h4 className="mb-0">Daily Top Performing Hubs</h4>
          </div>
          <div className="sub">Highest volume hub for each daily shipment file</div>

          <div className="dt-wrap" style={{ maxHeight: '240px' }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Top Hub</th>
                  <th className="r">Shipments</th>
                  <th className="r">Top Hub %</th>
                </tr>
              </thead>
              <tbody>
                {data.hubDailyPerformance.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center text-slate-400">No daily data</td>
                  </tr>
                ) : (
                  data.hubDailyPerformance.slice(-15).map((row) => {
                    const topH = row.topHubs[0];
                    const dayTotal = data.dailyTrend.find((d) => d.date === row.date)?.n || 1;
                    const pct = topH ? (topH.n / dayTotal) * 100 : 0;
                    return (
                      <tr
                        key={row.date}
                        className="cursor-pointer"
                        onClick={() => onFilterDate(row.date)}
                        title={`Filter by date ${row.date}`}
                      >
                        <td className="font-semibold text-slate-300">{row.date}</td>
                        <td className="truncate text-sky-300">{topH ? topH.name : '—'}</td>
                        <td className="r">{topH ? fmt(topH.n) : 0}</td>
                        <td className="r font-medium text-slate-400">{pct.toFixed(1)}%</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
};
