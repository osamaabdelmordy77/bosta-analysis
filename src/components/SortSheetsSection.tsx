import React, { useState } from 'react';
import type { ShipmentRecord } from '../types';
import { SortAreaSection } from './SortAreaSection';

export function SortSheetsSection({ enabled, shipments, children }: { enabled: boolean; shipments: ShipmentRecord[]; children: React.ReactNode }) {
  const [tab, setTab] = useState<'overview' | 'area'>('overview');
  if (!enabled) return <>{children}</>;
  return <div className="sort-sheets">
    <div className="receive-tabs" role="tablist" aria-label="Sort views" onKeyDown={(event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'overview' : event.key === 'End' ? 'area' : tab === 'overview' ? 'area' : 'overview';
      setTab(next);
      document.getElementById(`sort-${next}-tab`)?.focus();
    }}>
      <button id="sort-overview-tab" type="button" role="tab" tabIndex={tab === 'overview' ? 0 : -1} aria-selected={tab === 'overview'} aria-controls="sort-view-panel" onClick={() => setTab('overview')}>Overview</button>
      <button id="sort-area-tab" type="button" role="tab" tabIndex={tab === 'area' ? 0 : -1} aria-selected={tab === 'area'} aria-controls="sort-view-panel" onClick={() => setTab('area')}>Area</button>
    </div>
    <div id="sort-view-panel" role="tabpanel" aria-labelledby={`sort-${tab}-tab`}>
      {tab === 'area' ? <SortAreaSection shipments={shipments} /> : children}
    </div>
  </div>;
}
