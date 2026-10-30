import React from 'react';
import { AggregationResult } from '../types';

interface KPICardsProps {
  current: AggregationResult;
  base: AggregationResult;
}

export const KPICards: React.FC<KPICardsProps> = ({ current, base }) => {
  const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
  const fmt1 = (n: number) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

  // Helper for comparison delta vs baseline
  const renderDelta = (curVal: number, baseVal: number) => {
    if (!baseVal || Math.abs(curVal - baseVal) < 1e-6) return null;
    const diff = curVal / baseVal - 1;
    const tone = diff >= 0 ? 'up' : 'dn';
    return (
      <span className={`d ${tone}`}>
        {diff >= 0 ? '+' : ''}{(diff * 100).toFixed(1)}% vs all data
      </span>
    );
  };

  const getBarFrac = (raw: number, baseTotal: number) => {
    if (baseTotal <= 0) return raw > 0 ? 1 : 0;
    return Math.min(1, Math.max(0, raw / baseTotal));
  };

  const lowestVal = current.lowestHub ? current.lowestHub.n : 0;

  const cards = [
    {
      label: 'Total Shipments',
      value: fmt(current.totalShipments),
      sub: 'distinct tracking numbers',
      frac: getBarFrac(current.totalShipments, base.totalShipments),
      tone: '',
      delta: null,
    },
    {
      label: 'Total Hubs',
      value: fmt(current.totalHubs),
      sub: 'known network hubs',
      frac: getBarFrac(current.totalHubs, base.totalHubs),
      tone: '',
      delta: null,
    },
    {
      label: 'Total Businesses',
      value: fmt(current.bizRows.length),
      sub: 'with ≥1 shipment',
      frac: getBarFrac(current.bizRows.length, base.bizRows.length),
      tone: '',
      delta: null,
    },
    {
      label: 'Total Items',
      value: fmt(current.totalItems),
      sub: current.totalShipments > 0 ? `${fmt1(current.totalItems / current.totalShipments)} items / shipment` : '—',
      frac: getBarFrac(current.totalItems, base.totalItems),
      tone: '',
      delta: null,
    },
    {
      label: 'Avg Shipments per Hub',
      value: fmt1(current.avgShipmentsPerHub),
      sub: `over ${fmt(current.activeHubs)} active hub${current.activeHubs === 1 ? '' : 's'}`,
      frac: getBarFrac(current.avgShipmentsPerHub, base.avgShipmentsPerHub),
      tone: current.avgShipmentsPerHub >= base.avgShipmentsPerHub ? 'up' : 'dn',
      delta: renderDelta(current.avgShipmentsPerHub, base.avgShipmentsPerHub),
    },
    {
      label: 'Avg Shipments per Business',
      value: fmt1(current.avgShipmentsPerBiz),
      sub: `over ${fmt(current.bizRows.length)} businesses`,
      frac: getBarFrac(current.avgShipmentsPerBiz, base.avgShipmentsPerBiz),
      tone: current.avgShipmentsPerBiz >= base.avgShipmentsPerBiz ? 'up' : 'dn',
      delta: renderDelta(current.avgShipmentsPerBiz, base.avgShipmentsPerBiz),
    },
    {
      label: 'Highest Shipment Volume',
      value: current.highestHub ? fmt(current.highestHub.n) : '—',
      sub: current.highestHub ? current.highestHub.name : '—',
      frac: getBarFrac(current.highestHub ? current.highestHub.n : 0, base.highestHub ? base.highestHub.n : 1),
      tone: '',
      delta: null,
    },
    {
      label: 'Lowest Shipment Volume',
      value: current.lowestHub ? fmt(current.lowestHub.n) : '—',
      sub: current.lowestHub ? `${current.lowestHub.name} (active)` : '—',
      frac: getBarFrac(lowestVal, base.lowestHub ? Math.max(base.lowestHub.n, lowestVal) : 1),
      tone: '',
      delta: null,
    },
    {
      label: 'Active Hubs',
      value: fmt(current.activeHubs),
      sub: 'hubs with ≥1 shipment',
      frac: getBarFrac(current.activeHubs, base.totalHubs),
      tone: '',
      delta: null,
    },
    {
      label: 'Hubs with No Shipments',
      value: fmt(current.zeroHubs),
      sub: current.zeroHubs > 0 ? 'hubs known but idle' : 'every hub is active',
      frac: getBarFrac(current.zeroHubs, Math.max(1, base.totalHubs)),
      tone: current.zeroHubs > 0 ? 'dn' : '',
      delta: null,
    },
  ];

  return (
    <section className="kpis">
      {cards.map((c, i) => (
        <div key={i} className="kpi">
          <div className="l">{c.label}</div>
          <div className="v" title={c.value}>
            {c.value}
          </div>
          <div className="s">
            <span className="truncate">{c.sub}</span>
            {c.delta}
          </div>
          <div className="bar">
            <i
              className={c.tone}
              style={{ width: `${(c.frac * 100).toFixed(1)}%` }}
            />
            <u title="Unfiltered baseline (100%)" />
          </div>
        </div>
      ))}
    </section>
  );
};
