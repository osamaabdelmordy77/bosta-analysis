import React, { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { ShipmentRecord } from '../types';
import { parseShipmentDateTime } from '../utils/receiveDateTime';
import { ShipmentExplorerSection } from './ShipmentExplorerSection';
import { ReceiveVolumeSection } from './ReceiveVolumeSection';

interface ReceiveSheetsSectionProps {
  shipments: ShipmentRecord[];
  organizationSlug: string;
}

interface ReceiveFilters {
  receivedFrom: string;
  receivedTo: string;
  firstReceivingBy: string;
  business: string;
  type: string;
  packageSize: string;
  pickupZone: string;
  pickupCity: string;
}

const EMPTY_FILTERS: ReceiveFilters = {
  receivedFrom: '',
  receivedTo: '',
  firstReceivingBy: '',
  business: '',
  type: '',
  packageSize: '',
  pickupZone: '',
  pickupCity: '',
};

function getUniqueValues(shipments: ShipmentRecord[], read: (shipment: ShipmentRecord) => string | null | undefined): string[] {
  return [...new Set(shipments.map(read).filter((value): value is string => Boolean(value?.trim())))].sort((a, b) => a.localeCompare(b));
}

export const ReceiveSheetsSection: React.FC<ReceiveSheetsSectionProps> = ({ shipments, organizationSlug }) => {
  const [tab, setTab] = useState<'records' | 'volume'>('records');
  const [filters, setFilters] = useState<ReceiveFilters>(EMPTY_FILTERS);
  const options = useMemo(() => ({
    receivers: getUniqueValues(shipments, (shipment) => shipment.firstReceivingBy),
    businesses: getUniqueValues(shipments, (shipment) => shipment.business),
    types: getUniqueValues(shipments, (shipment) => shipment.shipType),
    packageSizes: getUniqueValues(shipments, (shipment) => shipment.packageSize),
    pickupZones: getUniqueValues(shipments, (shipment) => shipment.pickupZone),
    pickupCities: getUniqueValues(shipments, (shipment) => shipment.pickupCity),
  }), [shipments]);

  const filteredShipments = useMemo(() => {
    const receivedFrom = filters.receivedFrom ? Date.parse(filters.receivedFrom) : null;
    const receivedTo = filters.receivedTo ? Date.parse(filters.receivedTo) + 60_000 - 1 : null;

    return shipments.filter((shipment) => {
      if (filters.type && shipment.shipType !== filters.type) return false;
      if (filters.firstReceivingBy && shipment.firstReceivingBy !== filters.firstReceivingBy) return false;
      if (filters.business && shipment.business !== filters.business) return false;
      if (filters.packageSize && shipment.packageSize !== filters.packageSize) return false;
      if (filters.pickupZone && shipment.pickupZone !== filters.pickupZone) return false;
      if (filters.pickupCity && shipment.pickupCity !== filters.pickupCity) return false;

      if (filters.receivedFrom || filters.receivedTo) {
        const received = parseShipmentDateTime(shipment.receivedTime)?.getTime();
        if (received === undefined) return false;
        if (receivedFrom !== null && received < receivedFrom) return false;
        if (receivedTo !== null && received > receivedTo) return false;
      }

      return true;
    });
  }, [shipments, filters]);

  const hasFilters = Object.values(filters).some(Boolean);
  const updateFilter = (key: keyof ReceiveFilters, value: string) => {
    setFilters((previous) => ({ ...previous, [key]: value }));
  };
  const receivingBreakdown = useMemo(() => {
    const groups = new Map<string, { receiver: string; business: string; count: number }>();
    for (const shipment of filteredShipments) {
      const receiver = shipment.firstReceivingBy?.trim() || 'Not recorded';
      const business = shipment.business?.trim() || 'Not recorded';
      const key = `${receiver}\u0000${business}`;
      const group = groups.get(key) || { receiver, business, count: 0 };
      group.count++;
      groups.set(key, group);
    }
    return [...groups.values()].sort((left, right) => left.receiver.localeCompare(right.receiver)
      || right.count - left.count || left.business.localeCompare(right.business));
  }, [filteredShipments]);
  const receivingPeople = new Set(filteredShipments.map((shipment) => shipment.firstReceivingBy?.trim()).filter(Boolean)).size;
  const missingReceivedTimes = filteredShipments.filter((shipment) => !shipment.receivedTime?.trim()).length;
  const renderSelect = (label: string, key: keyof ReceiveFilters, values: string[]) => (
    <label className="page-filter-control" key={key}>
      <span>{label}</span>
      <select value={filters[key]} onChange={(event) => updateFilter(key, event.target.value)}>
        <option value="">All</option>
        {values.map((value) => <option value={value} key={value}>{value}</option>)}
      </select>
    </label>
  );

  return (
    <div className="receive-sheets">
      <div className="receive-tabs" role="tablist" aria-label="Receive views" onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'records' : event.key === 'End' ? 'volume' : tab === 'records' ? 'volume' : 'records';
        setTab(next);
        document.getElementById(`receive-${next}-tab`)?.focus();
      }}>
        <button id="receive-records-tab" type="button" role="tab" tabIndex={tab === 'records' ? 0 : -1} aria-selected={tab === 'records'} aria-controls="receive-tab-panel" onClick={() => setTab('records')}>Records</button>
        <button id="receive-volume-tab" type="button" role="tab" tabIndex={tab === 'volume' ? 0 : -1} aria-selected={tab === 'volume'} aria-controls="receive-tab-panel" onClick={() => setTab('volume')}>Volume</button>
      </div>
      <section className="receive-filter-panel" aria-label="Receive sheet filters">
        <div className="receive-filter-heading">
          <div>
            <span className="source-kind">Combined filters</span>
            <h2>Receive records</h2>
            <p>Received Time and First Receiving By come from the imported source rows. Filter by receiver or business to inspect the matching shipments.</p>
          </div>
          <div className="receive-filter-actions">
            <span className="shipment-row-count">{filteredShipments.length.toLocaleString()} of {shipments.length.toLocaleString()} records</span>
            <button type="button" className="btn sm" onClick={() => setFilters(EMPTY_FILTERS)} disabled={!hasFilters}>
              <RotateCcw size={14} /> Clear filters
            </button>
          </div>
        </div>

        <div className="receive-filter-grid">
          <label className="page-filter-control">
            <span>Received Time from</span>
            <input type="datetime-local" value={filters.receivedFrom} onChange={(event) => updateFilter('receivedFrom', event.target.value)} />
          </label>
          <label className="page-filter-control">
            <span>Received Time to</span>
            <input type="datetime-local" value={filters.receivedTo} onChange={(event) => updateFilter('receivedTo', event.target.value)} />
          </label>
          {renderSelect('First Receiving By', 'firstReceivingBy', options.receivers)}
          {renderSelect('Business', 'business', options.businesses)}
          {renderSelect('Type', 'type', options.types)}
          {renderSelect('Package Size', 'packageSize', options.packageSizes)}
          {renderSelect('Pickup Zone', 'pickupZone', options.pickupZones)}
          {renderSelect('Pickup City', 'pickupCity', options.pickupCities)}
        </div>
      </section>

      <section className="receive-filter-panel receive-receiver-summary" aria-label="Shipments by receiver and business">
        <div className="receive-filter-heading">
          <div><span className="source-kind">First Receiving By</span><h2>Received shipments by person and business</h2><p>Choose a name above to filter the shipment records and see its business breakdown.</p></div>
          <div className="receive-filter-actions"><span className="shipment-row-count">{filteredShipments.length.toLocaleString()} shipments · {receivingPeople.toLocaleString()} named receivers</span></div>
        </div>
        {missingReceivedTimes > 0 && <p className="volume-note">{missingReceivedTimes.toLocaleString()} records in this selection have no Received Time saved in their source data.</p>}
        <div className="dt-wrap"><table className="receive-receiver-table"><thead><tr><th>First Receiving By</th><th>Business</th><th>Shipments</th></tr></thead><tbody>
          {receivingBreakdown.map(({ receiver, business, count }) => <tr key={`${receiver}\u0000${business}`}>
            <td>{receiver === 'Not recorded' ? receiver : <button type="button" className="receive-receiver-filter-button" onClick={() => { updateFilter('firstReceivingBy', receiver); setTab('records'); }}>{receiver}</button>}</td>
            <td>{business === 'Not recorded' ? business : <button type="button" className="receive-receiver-filter-button" onClick={() => { updateFilter('business', business); setTab('records'); }}>{business}</button>}</td>
            <td><button type="button" className="volume-count" onClick={() => { setFilters((previous) => ({ ...previous, firstReceivingBy: receiver === 'Not recorded' ? '' : receiver, business: business === 'Not recorded' ? '' : business })); setTab('records'); }}>{count.toLocaleString()}</button></td>
          </tr>)}
          {!receivingBreakdown.length && <tr><td colSpan={3}>No shipments match these filters.</td></tr>}
        </tbody></table></div>
      </section>

      <div id="receive-tab-panel" role="tabpanel" aria-labelledby={tab === 'records' ? 'receive-records-tab' : 'receive-volume-tab'}>
        {tab === 'records' ? <ShipmentExplorerSection shipments={filteredShipments} showReceiveFields showPickedUpDate={false} /> : <ReceiveVolumeSection shipments={filteredShipments} organizationSlug={organizationSlug} />}
      </div>
    </div>
  );
};
