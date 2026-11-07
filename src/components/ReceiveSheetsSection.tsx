import React, { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { ShipmentRecord } from '../types';
import { parseShipmentDateTime, toLocalDateInputValue } from '../utils/receiveDateTime';
import { ShipmentExplorerSection } from './ShipmentExplorerSection';

interface ReceiveSheetsSectionProps {
  shipments: ShipmentRecord[];
}

interface ReceiveFilters {
  pickedUpFrom: string;
  pickedUpTo: string;
  receivedFrom: string;
  receivedTo: string;
  type: string;
  packageSize: string;
  pickupZone: string;
  pickupCity: string;
}

const EMPTY_FILTERS: ReceiveFilters = {
  pickedUpFrom: '',
  pickedUpTo: '',
  receivedFrom: '',
  receivedTo: '',
  type: '',
  packageSize: '',
  pickupZone: '',
  pickupCity: '',
};

function getUniqueValues(shipments: ShipmentRecord[], read: (shipment: ShipmentRecord) => string | null | undefined): string[] {
  return [...new Set(shipments.map(read).filter((value): value is string => Boolean(value?.trim())))].sort((a, b) => a.localeCompare(b));
}

export const ReceiveSheetsSection: React.FC<ReceiveSheetsSectionProps> = ({ shipments }) => {
  const [filters, setFilters] = useState<ReceiveFilters>(EMPTY_FILTERS);
  const options = useMemo(() => ({
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
      if (filters.packageSize && shipment.packageSize !== filters.packageSize) return false;
      if (filters.pickupZone && shipment.pickupZone !== filters.pickupZone) return false;
      if (filters.pickupCity && shipment.pickupCity !== filters.pickupCity) return false;

      if (filters.pickedUpFrom || filters.pickedUpTo) {
        const pickedUp = parseShipmentDateTime(shipment.pickedUpDate);
        if (!pickedUp) return false;
        const pickedUpDate = toLocalDateInputValue(pickedUp);
        if (filters.pickedUpFrom && pickedUpDate < filters.pickedUpFrom) return false;
        if (filters.pickedUpTo && pickedUpDate > filters.pickedUpTo) return false;
      }

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
      <section className="receive-filter-panel" aria-label="Receive sheet filters">
        <div className="receive-filter-heading">
          <div>
            <span className="source-kind">Combined filters</span>
            <h2>Receive records</h2>
            <p>Picked-Up Date and Received Time are source timestamps. Elapsed time is Received Time minus Picked-Up Date.</p>
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
            <span>Picked-Up Date from</span>
            <input type="date" value={filters.pickedUpFrom} onChange={(event) => updateFilter('pickedUpFrom', event.target.value)} />
          </label>
          <label className="page-filter-control">
            <span>Picked-Up Date to</span>
            <input type="date" value={filters.pickedUpTo} onChange={(event) => updateFilter('pickedUpTo', event.target.value)} />
          </label>
          <label className="page-filter-control">
            <span>Received Time from</span>
            <input type="datetime-local" value={filters.receivedFrom} onChange={(event) => updateFilter('receivedFrom', event.target.value)} />
          </label>
          <label className="page-filter-control">
            <span>Received Time to</span>
            <input type="datetime-local" value={filters.receivedTo} onChange={(event) => updateFilter('receivedTo', event.target.value)} />
          </label>
          {renderSelect('Type', 'type', options.types)}
          {renderSelect('Package Size', 'packageSize', options.packageSizes)}
          {renderSelect('Pickup Zone', 'pickupZone', options.pickupZones)}
          {renderSelect('Pickup City', 'pickupCity', options.pickupCities)}
        </div>
      </section>

      <ShipmentExplorerSection shipments={filteredShipments} showReceiveFields />
    </div>
  );
};
