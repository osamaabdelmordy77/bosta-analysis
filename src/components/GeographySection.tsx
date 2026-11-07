import React from 'react';
import { Bar, Doughnut } from 'react-chartjs-2';
import { AggregationResult } from '../types';
import { BLUE, PAL } from '../utils/chartSetup';

interface GeographySectionProps {
  data: AggregationResult;
  onFilterPickupCity: (city: string) => void;
  onFilterDropCity: (city: string) => void;
  onFilterShipType: (st: string) => void;
}

export const GeographySection: React.FC<GeographySectionProps> = ({
  data,
  onFilterPickupCity,
  onFilterDropCity,
  onFilterShipType,
}) => {
  const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

  // Pickup City Chart
  const pcRows = data.pickupCityRows.slice(0, 12);
  const pcChartData = {
    labels: pcRows.map((r) => r.name),
    datasets: [
      {
        data: pcRows.map((r) => r.n),
        backgroundColor: BLUE,
        borderRadius: 3,
        maxBarThickness: 18,
      },
    ],
  };

  const pcChartOptions = {
    indexAxis: 'y' as const,
    responsive: true,
    maintainAspectRatio: false,
    onClick: (_e: unknown, elements: { index: number }[]) => {
      if (elements.length > 0) {
        const item = pcRows[elements[0].index];
        if (item) onFilterPickupCity(item.name);
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
      x: { grace: '14%', grid: { color: '#e7edf3' }, ticks: { precision: 0 } },
      y: { grid: { display: false }, ticks: { autoSkip: false } },
    },
  };

  // DropOff City Chart
  const dcRows = data.dropCityRows.slice(0, 12);
  const dcChartData = {
    labels: dcRows.map((r) => r.name),
    datasets: [
      {
        data: dcRows.map((r) => r.n),
        backgroundColor: BLUE,
        borderRadius: 3,
        maxBarThickness: 18,
      },
    ],
  };

  const dcChartOptions = {
    indexAxis: 'y' as const,
    responsive: true,
    maintainAspectRatio: false,
    onClick: (_e: unknown, elements: { index: number }[]) => {
      if (elements.length > 0) {
        const item = dcRows[elements[0].index];
        if (item) onFilterDropCity(item.name);
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
      x: { grace: '14%', grid: { color: '#e7edf3' }, ticks: { precision: 0 } },
      y: { grid: { display: false }, ticks: { autoSkip: false } },
    },
  };

  // Pickup Zone Chart (Top 15)
  const pzRows = data.pickupZoneRows.slice(0, 15);
  const pzChartData = {
    labels: pzRows.map((r) => r.name),
    datasets: [
      {
        data: pzRows.map((r) => r.n),
        backgroundColor: '#6e9cc9',
        borderRadius: 3,
        maxBarThickness: 16,
      },
    ],
  };

  const pzChartOptions = {
    indexAxis: 'y' as const,
    responsive: true,
    maintainAspectRatio: false,
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
      x: { grace: '14%', grid: { color: '#e7edf3' }, ticks: { precision: 0 } },
      y: { grid: { display: false }, ticks: { autoSkip: false } },
    },
  };

  // Total Items by Shipment Type
  const itemsTypeRows = [...data.shipTypeRows].sort((a, b) => b.items - a.items);
  const itemsTypeChartData = {
    labels: itemsTypeRows.map((r) => r.name),
    datasets: [
      {
        data: itemsTypeRows.map((r) => r.items),
        backgroundColor: itemsTypeRows.map((_, i) => PAL[i % PAL.length]),
        borderRadius: 3,
        maxBarThickness: 22,
      },
    ],
  };

  const itemsTypeChartOptions = {
    indexAxis: 'y' as const,
    responsive: true,
    maintainAspectRatio: false,
    onClick: (_e: unknown, elements: { index: number }[]) => {
      if (elements.length > 0) {
        const item = itemsTypeRows[elements[0].index];
        if (item) onFilterShipType(item.name);
      }
    },
    plugins: {
      legend: { display: false },
      valLabels: { show: true },
      tooltip: {
        callbacks: {
          label: (c: any) => ` Items: ${c.parsed.x.toLocaleString()}`,
        },
      },
    },
    scales: {
      x: { grace: '14%', grid: { color: '#e7edf3' }, ticks: { precision: 0 } },
      y: { grid: { display: false }, ticks: { autoSkip: false } },
    },
  };

  // Package Size Doughnut
  const totalPkgSize = data.packageSizeRows.reduce((s, r) => s + r.n, 0);
  const sizeChartData = {
    labels: data.packageSizeRows.map((r) => r.name),
    datasets: [
      {
        data: data.packageSizeRows.map((r) => r.n),
        backgroundColor: data.packageSizeRows.map((_, i) => PAL[i % PAL.length]),
        borderColor: '#ffffff',
        borderWidth: 2,
      },
    ],
  };

  const sizeChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '62%',
    plugins: {
      legend: { position: 'right' as const, labels: { color: '#52677e', boxWidth: 10 } },
      centerText: { lines: [fmt(totalPkgSize), 'shipments'] },
      tooltip: {
        callbacks: {
          label: (c: any) => {
            const pctVal = totalPkgSize > 0 ? (c.parsed / totalPkgSize) * 100 : 0;
            return ` ${c.label}: ${c.parsed.toLocaleString()} (${pctVal.toFixed(1)}%)`;
          },
        },
      },
    },
  };

  // Top 10 Routes (Lanes)
  const laneRows = data.laneRows.slice(0, 10);
  const laneChartData = {
    labels: laneRows.map((r) => r.name),
    datasets: [
      {
        data: laneRows.map((r) => r.n),
        backgroundColor: '#408274',
        borderRadius: 3,
        maxBarThickness: 18,
      },
    ],
  };

  const laneChartOptions = {
    indexAxis: 'y' as const,
    responsive: true,
    maintainAspectRatio: false,
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
      x: { grace: '14%', grid: { color: '#e7edf3' }, ticks: { precision: 0 } },
      y: {
        grid: { display: false },
        ticks: {
          autoSkip: false,
          callback: function (this: any, val: any): string {
            const l = this.getLabelForValue(val);
            return String(l).length > 26 ? `${String(l).slice(0, 25)}…` : String(l);
          },
        },
      },
    },
  };

  return (
    <section className="sec" id="geoSection">
      <h3>Geography, Packages &amp; Items</h3>
      <p className="lead">
        Pickup and drop-off distribution, package analysis and item volumes.
        Click bars in the city and package charts to filter the whole dashboard.
      </p>

      {/* Row 1: Cities & Zones */}
      <div className="row3">
        <div className="box">
          <h4>Shipments by pickup city</h4>
          <div className="cbox" style={{ height: '340px' }}>
            <Bar data={pcChartData} options={pcChartOptions} />
          </div>
        </div>

        <div className="box">
          <h4>Shipments by drop-off city</h4>
          <div className="cbox" style={{ height: '340px' }}>
            <Bar data={dcChartData} options={dcChartOptions} />
          </div>
        </div>

        <div className="box">
          <h4>Shipments by pickup zone (top 15)</h4>
          <div className="cbox" style={{ height: '340px' }}>
            <Bar data={pzChartData} options={pzChartOptions} />
          </div>
        </div>
      </div>

      {/* Row 2: Items, Sizes & Lanes */}
      <div className="row3">
        <div className="box">
          <h4>Total items by shipment type</h4>
          <div className="sub">Sum of the Items column</div>
          <div className="cbox" style={{ height: '300px' }}>
            <Bar data={itemsTypeChartData} options={itemsTypeChartOptions} />
          </div>
        </div>

        <div className="box">
          <h4>Shipments by package size</h4>
          <div className="cbox" style={{ height: '300px' }}>
            <Doughnut data={sizeChartData} options={sizeChartOptions} />
          </div>
        </div>

        <div className="box">
          <h4>Top 10 routes (pickup → drop-off)</h4>
          <div className="cbox" style={{ height: '300px' }}>
            <Bar data={laneChartData} options={laneChartOptions} />
          </div>
        </div>
      </div>
    </section>
  );
};
