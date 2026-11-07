import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Download, Filter, LayoutGrid, ListFilter, Package, Search, X } from 'lucide-react';
import { FilterState, ShipmentRecord } from '../types';
import { filterShipments } from '../utils/analytics';

type CardView =
  | 'day'
  | 'month'
  | 'hub'
  | 'business'
  | 'pickupCity'
  | 'dropCity'
  | 'shipType'
  | 'packageType'
  | 'packageSize';

interface AnalyticsCardsSectionProps {
  shipments: ShipmentRecord[];
  filteredShipments: ShipmentRecord[];
  filters: FilterState;
  hubBasis: string;
}

interface ShipmentCard {
  key: string;
  label: string;
  shipments: ShipmentRecord[];
  items: number;
}

type DimensionKey = 'hub' | 'business' | 'pickupCity' | 'dropCity' | 'shipType' | 'packageType' | 'packageSize' | 'fileName';
type CardSort = 'count-desc' | 'count-asc' | 'name-asc' | 'name-desc' | 'items-desc';
type CardDensity = 'comfortable' | 'compact';

interface AdvancedFilters {
  dimensions: Record<DimensionKey, Set<string>>;
  dateFrom: string;
  dateTo: string;
  tracking: string;
  minItems: string;
  maxItems: string;
}

interface DimensionOption {
  name: string;
  count: number;
}

const DIMENSIONS: { key: DimensionKey; label: string; getValue: (shipment: ShipmentRecord, hubBasis: string) => string | null | undefined }[] = [
  { key: 'hub', label: 'Hub', getValue: (r, basis) => r.hubs[basis] ?? r.assignedHub },
  { key: 'business', label: 'Business', getValue: (r) => r.business },
  { key: 'pickupCity', label: 'Pickup city', getValue: (r) => r.pickupCity },
  { key: 'dropCity', label: 'Drop-off city', getValue: (r) => r.dropCity },
  { key: 'shipType', label: 'Shipment type', getValue: (r) => r.shipType },
  { key: 'packageType', label: 'Package type', getValue: (r) => r.packageType },
  { key: 'packageSize', label: 'Package size', getValue: (r) => r.packageSize },
  { key: 'fileName', label: 'Source file', getValue: (r) => r.fileName },
];

const CARD_PAGE_SIZE = 30;
const DETAIL_PAGE_SIZE = 50;

const VIEWS: { id: CardView; label: string }[] = [
  { id: 'day', label: 'By day' },
  { id: 'month', label: 'By month' },
  { id: 'hub', label: 'By hub' },
  { id: 'business', label: 'By business' },
  { id: 'pickupCity', label: 'Pickup city' },
  { id: 'dropCity', label: 'Drop-off city' },
  { id: 'shipType', label: 'Shipment type' },
  { id: 'packageType', label: 'Package type' },
  { id: 'packageSize', label: 'Package size' },
];

const EXPORT_COLUMNS: { label: string; value: (shipment: ShipmentRecord, hubBasis: string) => string | number }[] = [
  { label: 'Report date', value: (r) => r.shipmentDate },
  { label: 'Tracking number', value: (r) => r.tracking },
  { label: 'Items', value: (r) => r.items },
  { label: 'Business', value: (r) => r.business || '' },
  { label: 'Shipment type', value: (r) => r.shipType || '' },
  { label: 'Package type', value: (r) => r.packageType || '' },
  { label: 'Package size', value: (r) => r.packageSize || '' },
  { label: 'Pickup city', value: (r) => r.pickupCity || '' },
  { label: 'Pickup zone', value: (r) => r.pickupZone || '' },
  { label: 'Drop-off city', value: (r) => r.dropCity || '' },
  { label: 'Assigned hub', value: (r) => r.assignedHub || '' },
  { label: 'Selected hub', value: (r, basis) => (r.hubs[basis] ?? r.assignedHub) || '' },
  { label: 'Source file', value: (r) => r.fileName },
  { label: 'Source sheet', value: (r) => r.sourceSheetIndex ?? '' },
  { label: 'Source row', value: (r) => r.sourceRowNumber ?? '' },
  { label: 'Raw date', value: (r) => r.rawDate || '' },
];

function monthLabel(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function downloadCard(card: ShipmentCard, hubBasis: string): void {
  const rows = [
    EXPORT_COLUMNS.map((column) => column.label),
    ...card.shipments.map((shipment) => EXPORT_COLUMNS.map((column) => column.value(shipment, hubBasis))),
  ];
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet['!cols'] = EXPORT_COLUMNS.map((column) => ({ wch: Math.min(28, Math.max(14, column.label.length + 2)) }));
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Shipments');
  const safeLabel = card.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  XLSX.writeFile(workbook, `shipments-${safeLabel || 'export'}.xlsx`, { compression: true });
}

function groupByValue(
  records: ShipmentRecord[],
  getValue: (shipment: ShipmentRecord) => string | null | undefined,
): ShipmentCard[] {
  const groups = new Map<string, ShipmentRecord[]>();
  records.forEach((shipment) => {
    const label = getValue(shipment)?.trim() || 'Unspecified';
    const group = groups.get(label);
    if (group) group.push(shipment);
    else groups.set(label, [shipment]);
  });
  return Array.from(groups, ([label, group]) => ({
    key: label,
    label,
    shipments: group,
    items: group.reduce((total, shipment) => total + shipment.items, 0),
  })).sort((a, b) => b.shipments.length - a.shipments.length || a.label.localeCompare(b.label));
}

function createDateFilterScope(filters: FilterState): FilterState {
  return {
    ...filters,
    month: 'all',
    specificDate: 'all',
  };
}

function createDefaultAdvancedFilters(): AdvancedFilters {
  return {
    dimensions: {
      hub: new Set(),
      business: new Set(),
      pickupCity: new Set(),
      dropCity: new Set(),
      shipType: new Set(),
      packageType: new Set(),
      packageSize: new Set(),
      fileName: new Set(),
    },
    dateFrom: '',
    dateTo: '',
    tracking: '',
    minItems: '',
    maxItems: '',
  };
}

function filterAdvancedRecords(
  records: ShipmentRecord[],
  advanced: AdvancedFilters,
  hubBasis: string,
): ShipmentRecord[] {
  const minItems = advanced.minItems === '' ? null : Number(advanced.minItems);
  const maxItems = advanced.maxItems === '' ? null : Number(advanced.maxItems);
  const tracking = advanced.tracking.trim().toLocaleLowerCase();

  return records.filter((shipment) => {
    if (advanced.dateFrom && shipment.shipmentDate < advanced.dateFrom) return false;
    if (advanced.dateTo && shipment.shipmentDate > advanced.dateTo) return false;
    if (minItems !== null && shipment.items < minItems) return false;
    if (maxItems !== null && shipment.items > maxItems) return false;
    if (tracking && !shipment.tracking.toLocaleLowerCase().includes(tracking)) return false;
    return DIMENSIONS.every(({ key, getValue }) => {
      const selected = advanced.dimensions[key];
      if (selected.size === 0) return true;
      return selected.has(getValue(shipment, hubBasis)?.trim() || 'Unspecified');
    });
  });
}

const DimensionFilter: React.FC<{
  label: string;
  options: DimensionOption[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
}> = ({ label, options, selected, onChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filterRef = useRef<HTMLDivElement>(null);
  const matchingOptions = options.filter((option) => option.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const shownOptions = matchingOptions.slice(0, 100);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className="analytics-dimension-filter" ref={filterRef}>
      <button
        type="button"
        className={`analytics-filter-trigger${selected.size ? ' active' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <span>{label}</span>
        {selected.size > 0 && <span className="analytics-filter-count">{selected.size}</span>}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="analytics-filter-popover" role="dialog" aria-label={`${label} filter`}>
          <label className="analytics-filter-search">
            <Search size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()}`} autoFocus />
          </label>
          <div className="analytics-filter-actions">
            <button type="button" onClick={() => onChange(new Set())}>Clear</button>
            <span>{selected.size ? `${selected.size} selected` : `${options.length} options`}</span>
          </div>
          <div className="analytics-filter-options">
            {shownOptions.map((option) => (
              <label key={option.name} className="analytics-filter-option">
                <input
                  type="checkbox"
                  checked={selected.has(option.name)}
                  onChange={() => {
                    const next = new Set(selected);
                    if (next.has(option.name)) next.delete(option.name);
                    else next.add(option.name);
                    onChange(next);
                  }}
                />
                <span title={option.name}>{option.name}</span>
                <small>{option.count.toLocaleString()}</small>
              </label>
            ))}
            {matchingOptions.length > shownOptions.length && <span className="analytics-filter-limit">Showing first 100 matches. Search to narrow the list.</span>}
            {matchingOptions.length === 0 && <span className="analytics-filter-limit">No matches found.</span>}
          </div>
        </div>
      )}
    </div>
  );
};

export const AnalyticsCardsSection: React.FC<AnalyticsCardsSectionProps> = ({
  shipments,
  filteredShipments,
  filters,
  hubBasis,
}) => {
  const [view, setView] = useState<CardView>('day');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  const [search, setSearch] = useState('');
  const [cardPage, setCardPage] = useState(0);
  const [detailPage, setDetailPage] = useState(0);
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilters>(createDefaultAdvancedFilters);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [sortBy, setSortBy] = useState<CardSort>('count-desc');
  const [density, setDensity] = useState<CardDensity>('comfortable');

  const dateScopeShipments = useMemo(
    () => filterShipments(shipments, createDateFilterScope(filters), hubBasis),
    [shipments, filters, hubBasis],
  );
  const advancedDateScope = useMemo(
    () => filterAdvancedRecords(dateScopeShipments, advancedFilters, hubBasis),
    [dateScopeShipments, advancedFilters, hubBasis],
  );
  const advancedFilteredShipments = useMemo(
    () => filterAdvancedRecords(filteredShipments, advancedFilters, hubBasis),
    [filteredShipments, advancedFilters, hubBasis],
  );
  const monthOptions = useMemo(
    () => Array.from(new Set(advancedDateScope.map((shipment) => shipment.shipmentDate.slice(0, 7)).filter(Boolean))).sort().reverse(),
    [advancedDateScope],
  );
  const activeMonth = selectedMonth === 'all'
    ? 'all'
    : monthOptions.includes(selectedMonth) ? selectedMonth : monthOptions[0] || 'all';

  const cards = useMemo(() => {
    if (view === 'day' || view === 'month') {
      const monthGroups = groupByValue(advancedDateScope, (shipment) => shipment.shipmentDate.slice(0, 7));
      if (view === 'month') {
        return monthGroups
          .map((month) => ({ ...month, label: monthLabel(month.key) }))
          .sort((a, b) => b.key.localeCompare(a.key));
      }
      const monthShipments = activeMonth === 'all'
        ? advancedDateScope
        : advancedDateScope.filter((shipment) => shipment.shipmentDate.startsWith(activeMonth));
      return groupByValue(monthShipments, (shipment) => shipment.shipmentDate)
        .sort((a, b) => b.key.localeCompare(a.key));
    }

    switch (view) {
      case 'hub':
        return groupByValue(advancedFilteredShipments, (shipment) => shipment.hubs[hubBasis] ?? shipment.assignedHub);
      case 'business':
        return groupByValue(advancedFilteredShipments, (shipment) => shipment.business);
      case 'pickupCity':
        return groupByValue(advancedFilteredShipments, (shipment) => shipment.pickupCity);
      case 'dropCity':
        return groupByValue(advancedFilteredShipments, (shipment) => shipment.dropCity);
      case 'shipType':
        return groupByValue(advancedFilteredShipments, (shipment) => shipment.shipType);
      case 'packageType':
        return groupByValue(advancedFilteredShipments, (shipment) => shipment.packageType);
      case 'packageSize':
        return groupByValue(advancedFilteredShipments, (shipment) => shipment.packageSize);
      default:
        return [];
    }
  }, [view, advancedDateScope, activeMonth, advancedFilteredShipments, hubBasis]);

  const visibleCards = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const filtered = query ? cards.filter((card) => card.label.toLocaleLowerCase().includes(query)) : [...cards];
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'count-asc': return a.shipments.length - b.shipments.length || a.label.localeCompare(b.label);
        case 'name-asc': return a.label.localeCompare(b.label);
        case 'name-desc': return b.label.localeCompare(a.label);
        case 'items-desc': return b.items - a.items || b.shipments.length - a.shipments.length;
        default: return (view === 'day' || view === 'month')
          ? b.key.localeCompare(a.key)
          : b.shipments.length - a.shipments.length || a.label.localeCompare(b.label);
      }
    });
    return filtered;
  }, [cards, search, view, sortBy]);

  const pageCount = Math.max(1, Math.ceil(visibleCards.length / CARD_PAGE_SIZE));
  const currentCardPage = Math.min(cardPage, pageCount - 1);
  const pagedCards = visibleCards.slice(currentCardPage * CARD_PAGE_SIZE, (currentCardPage + 1) * CARD_PAGE_SIZE);
  const visibleShipmentsCount = visibleCards.reduce((total, card) => total + card.shipments.length, 0);
  const selectedCard = cards.find((card) => card.key === selectedKey) || null;
  const selectedRows = useMemo(
    () => selectedCard ? [...selectedCard.shipments].sort((a, b) => b.shipmentDate.localeCompare(a.shipmentDate) || a.tracking.localeCompare(b.tracking)) : [],
    [selectedCard],
  );
  const detailPageCount = Math.max(1, Math.ceil(selectedRows.length / DETAIL_PAGE_SIZE));
  const currentDetailPage = Math.min(detailPage, detailPageCount - 1);
  const detailRows = selectedRows.slice(currentDetailPage * DETAIL_PAGE_SIZE, (currentDetailPage + 1) * DETAIL_PAGE_SIZE);
  const dimensionOptions = useMemo(() => {
    const counts = Object.fromEntries(DIMENSIONS.map(({ key }) => [key, new Map<string, number>()])) as Record<DimensionKey, Map<string, number>>;
    filteredShipments.forEach((shipment) => {
      DIMENSIONS.forEach(({ key, getValue }) => {
        const value = getValue(shipment, hubBasis)?.trim() || 'Unspecified';
        const map = counts[key];
        map.set(value, (map.get(value) || 0) + 1);
      });
    });
    return Object.fromEntries(DIMENSIONS.map(({ key }) => [
      key,
      Array.from(counts[key], ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    ])) as Record<DimensionKey, DimensionOption[]>;
  }, [filteredShipments, hubBasis]);
  const activeAdvancedCount = useMemo(() => {
    const dimensionCount = Object.values(advancedFilters.dimensions).filter((values) => values.size > 0).length;
    return dimensionCount
      + Number(Boolean(advancedFilters.dateFrom || advancedFilters.dateTo))
      + Number(Boolean(advancedFilters.tracking.trim()))
      + Number(Boolean(advancedFilters.minItems || advancedFilters.maxItems));
  }, [advancedFilters]);
  const activeDimensions = DIMENSIONS.filter(({ key }) => advancedFilters.dimensions[key].size > 0);
  const maxCardCount = cards.reduce((max, card) => Math.max(max, card.shipments.length), 1);
  const maxAvailableDate = advancedDateScope.reduce((latest, shipment) => shipment.shipmentDate > latest ? shipment.shipmentDate : latest, '');

  useEffect(() => {
    if (!cards.some((card) => card.key === selectedKey)) {
      setSelectedKey(cards[0]?.key || '');
      setDetailPage(0);
    }
  }, [cards, selectedKey]);

  const changeView = (nextView: CardView) => {
    setView(nextView);
    setSearch('');
    setCardPage(0);
    setDetailPage(0);
    if (nextView === 'day' && !monthOptions.includes(selectedMonth)) setSelectedMonth(monthOptions[0] || '');
  };

  const chooseMonth = (month: string) => {
    setSelectedMonth(month);
    setCardPage(0);
    setDetailPage(0);
    setSelectedKey('');
  };

  const chooseCard = (card: ShipmentCard) => {
    if (view === 'month') {
      setSelectedMonth(card.key);
      setSelectedKey('');
      setView('day');
      setCardPage(0);
      setDetailPage(0);
      return;
    }
    setSelectedKey(card.key);
    setDetailPage(0);
  };

  const updateAdvancedFilters = (update: (current: AdvancedFilters) => AdvancedFilters) => {
    setAdvancedFilters(update);
    setCardPage(0);
    setDetailPage(0);
  };

  const applyRecentDatePreset = (days: number) => {
    if (!maxAvailableDate) return;
    const end = new Date(`${maxAvailableDate}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() - (days - 1));
    const start = end.toISOString().slice(0, 10);
    updateAdvancedFilters((current) => ({ ...current, dateFrom: start, dateTo: maxAvailableDate }));
  };

  const clearAdvancedFilters = () => {
    setAdvancedFilters(createDefaultAdvancedFilters());
    setSearch('');
    setCardPage(0);
    setDetailPage(0);
  };

  const updateDimensionFilter = (key: DimensionKey, selected: Set<string>) => {
    updateAdvancedFilters((current) => ({
      ...current,
      dimensions: { ...current.dimensions, [key]: selected },
    }));
  };

  const removeDimensionValue = (key: DimensionKey, value: string) => {
    const next = new Set(advancedFilters.dimensions[key]);
    next.delete(value);
    updateDimensionFilter(key, next);
  };

  return (
    <section className="sec analytics-cards-section" id="analyticsCards">
      <div className="analytics-cards-heading">
        <div>
          <h3>Shipment overview</h3>
          <p className="lead">Choose a grouping, open a card to inspect its shipments, or export that card to Excel.</p>
        </div>
        <div className="analytics-cards-total">
          <Package size={17} />
          <span>{visibleShipmentsCount.toLocaleString()} shipments</span>
        </div>
      </div>

      <div className="analytics-view-tabs" role="group" aria-label="Group shipments by">
        {VIEWS.map((option) => (
          <button
            type="button"
            key={option.id}
            className={`analytics-view-tab${view === option.id ? ' active' : ''}`}
            aria-pressed={view === option.id}
            onClick={() => changeView(option.id)}
          >
            {option.id === 'day' && <CalendarDays size={15} />}
            {option.label}
          </button>
        ))}
      </div>

      <section className="analytics-filter-panel" aria-label="Advanced shipment filters">
        <div className="analytics-filter-panel-heading">
          <div className="analytics-filter-panel-title">
            <span className="analytics-filter-icon"><Filter size={16} /></span>
            <div>
              <strong>Refine results</strong>
              <span>{activeAdvancedCount ? `${activeAdvancedCount} filter groups active` : 'Combine filters to narrow cards and exports'}</span>
            </div>
          </div>
          <div className="analytics-filter-panel-actions">
            {activeAdvancedCount > 0 && <button type="button" className="analytics-clear-filters" onClick={clearAdvancedFilters}><X size={14} /> Clear all</button>}
            <button type="button" className="analytics-expand-filters" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>
              {filtersOpen ? 'Hide filters' : 'Show filters'} <ChevronDown size={15} className={filtersOpen ? 'expanded' : ''} />
            </button>
          </div>
        </div>

        {filtersOpen && (
          <div className="analytics-filter-panel-body">
            <div className="analytics-filter-group">
              <div className="analytics-filter-group-label"><CalendarDays size={14} /> Time range</div>
              <div className="analytics-filter-controls">
                <label className="analytics-filter-field">
                  <span>From</span>
                  <input type="date" value={advancedFilters.dateFrom} max={advancedFilters.dateTo || undefined} onChange={(event) => updateAdvancedFilters((current) => ({ ...current, dateFrom: event.target.value }))} />
                </label>
                <label className="analytics-filter-field">
                  <span>To</span>
                  <input type="date" value={advancedFilters.dateTo} min={advancedFilters.dateFrom || undefined} onChange={(event) => updateAdvancedFilters((current) => ({ ...current, dateTo: event.target.value }))} />
                </label>
                <div className="analytics-filter-presets" role="group" aria-label="Quick date ranges">
                  <button type="button" onClick={() => applyRecentDatePreset(7)}>Last 7 days</button>
                  <button type="button" onClick={() => applyRecentDatePreset(30)}>Last 30 days</button>
                </div>
              </div>
            </div>

            <div className="analytics-filter-group">
              <div className="analytics-filter-group-label"><Package size={14} /> Shipment attributes</div>
              <div className="analytics-filter-controls analytics-dimension-grid">
                {DIMENSIONS.filter(({ key }) => ['hub', 'business', 'shipType', 'packageType', 'packageSize', 'fileName'].includes(key)).map(({ key, label }) => (
                  <DimensionFilter
                    key={key}
                    label={key === 'hub' ? hubBasis : label}
                    options={dimensionOptions[key]}
                    selected={advancedFilters.dimensions[key]}
                    onChange={(selected) => updateDimensionFilter(key, selected)}
                  />
                ))}
              </div>
            </div>

            <div className="analytics-filter-group">
              <div className="analytics-filter-group-label"><ListFilter size={14} /> Route &amp; record</div>
              <div className="analytics-filter-controls analytics-dimension-grid">
                {DIMENSIONS.filter(({ key }) => key === 'pickupCity' || key === 'dropCity').map(({ key, label }) => (
                  <DimensionFilter
                    key={key}
                    label={label}
                    options={dimensionOptions[key]}
                    selected={advancedFilters.dimensions[key]}
                    onChange={(selected) => updateDimensionFilter(key, selected)}
                  />
                ))}
                <label className="analytics-filter-field analytics-tracking-field">
                  <span>Tracking number</span>
                  <input
                    type="search"
                    value={advancedFilters.tracking}
                    onChange={(event) => updateAdvancedFilters((current) => ({ ...current, tracking: event.target.value }))}
                    placeholder="Contains..."
                  />
                </label>
                <label className="analytics-filter-field">
                  <span>Min. items</span>
                  <input type="number" min="0" value={advancedFilters.minItems} onChange={(event) => updateAdvancedFilters((current) => ({ ...current, minItems: event.target.value }))} placeholder="Any" />
                </label>
                <label className="analytics-filter-field">
                  <span>Max. items</span>
                  <input type="number" min="0" value={advancedFilters.maxItems} onChange={(event) => updateAdvancedFilters((current) => ({ ...current, maxItems: event.target.value }))} placeholder="Any" />
                </label>
              </div>
            </div>

            {activeAdvancedCount > 0 && (
              <div className="analytics-active-filters" aria-label="Active filters">
                <span>Active:</span>
                {activeDimensions.flatMap(({ key, label }) => Array.from(advancedFilters.dimensions[key], (value) => (
                  <button type="button" className="analytics-filter-chip" key={`${key}:${value}`} onClick={() => removeDimensionValue(key, value)}>
                    <span>{key === 'hub' ? hubBasis : label}: {value}</span><X size={12} />
                  </button>
                )))}
                {(advancedFilters.dateFrom || advancedFilters.dateTo) && (
                  <button type="button" className="analytics-filter-chip" onClick={() => updateAdvancedFilters((current) => ({ ...current, dateFrom: '', dateTo: '' }))}>
                    <span>{advancedFilters.dateFrom || 'Any'} – {advancedFilters.dateTo || 'Any'}</span><X size={12} />
                  </button>
                )}
                {advancedFilters.tracking.trim() && (
                  <button type="button" className="analytics-filter-chip" onClick={() => updateAdvancedFilters((current) => ({ ...current, tracking: '' }))}>
                    <span>Tracking: {advancedFilters.tracking}</span><X size={12} />
                  </button>
                )}
                {(advancedFilters.minItems || advancedFilters.maxItems) && (
                  <button type="button" className="analytics-filter-chip" onClick={() => updateAdvancedFilters((current) => ({ ...current, minItems: '', maxItems: '' }))}>
                    <span>Items: {advancedFilters.minItems || 'Any'}–{advancedFilters.maxItems || 'Any'}</span><X size={12} />
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <div className="analytics-card-tools">
        {(view === 'day' || view === 'month') && (
          <label className="analytics-month-picker">
            <span>{view === 'day' ? 'Report month' : 'Available months'}</span>
            {view === 'day' ? (
              <select value={activeMonth} onChange={(event) => chooseMonth(event.target.value)}>
                <option value="all">All months</option>
                {monthOptions.map((month) => <option value={month} key={month}>{monthLabel(month)}</option>)}
              </select>
            ) : (
              <span className="analytics-month-count">{monthOptions.length.toLocaleString()} months</span>
            )}
          </label>
        )}
        <label className="analytics-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setCardPage(0);
            }}
            placeholder={view === 'day' ? 'Find a date' : 'Search cards'}
            aria-label="Search cards"
          />
        </label>
        <label className="analytics-sort-control">
          <span>Sort by</span>
          <select value={sortBy} onChange={(event) => { setSortBy(event.target.value as CardSort); setCardPage(0); }}>
            <option value="count-desc">Most shipments</option>
            <option value="count-asc">Fewest shipments</option>
            <option value="items-desc">Most items</option>
            <option value="name-asc">Name A–Z</option>
            <option value="name-desc">Name Z–A</option>
          </select>
        </label>
        <div className="analytics-density-toggle" role="group" aria-label="Card size">
          <button type="button" aria-pressed={density === 'comfortable'} className={density === 'comfortable' ? 'active' : ''} onClick={() => setDensity('comfortable')} title="Comfortable card layout"><LayoutGrid size={15} /></button>
          <button type="button" aria-pressed={density === 'compact'} className={density === 'compact' ? 'active' : ''} onClick={() => setDensity('compact')} title="Compact card layout"><ListFilter size={15} /></button>
        </div>
        <span className="analytics-result-count">{visibleCards.length.toLocaleString()} cards · {visibleShipmentsCount.toLocaleString()} shipments</span>
      </div>

      {visibleCards.length > 0 ? (
        <div className={`analytics-card-grid${density === 'compact' ? ' compact' : ''}`}>
          {pagedCards.map((card) => {
            const isSelected = view !== 'month' && card.key === selectedCard?.key;
            const share = (card.shipments.length / Math.max(1, (view === 'day' || view === 'month' ? advancedDateScope.length : advancedFilteredShipments.length))) * 100;
            const barWidth = (card.shipments.length / maxCardCount) * 100;
            return (
              <article className={`analytics-data-card${isSelected ? ' selected' : ''}`} key={card.key}>
                <button type="button" className="analytics-data-card-main" onClick={() => chooseCard(card)}>
                  <span className="analytics-data-card-label" title={card.label}>{card.label}</span>
                  <strong>{card.shipments.length.toLocaleString()}</strong>
                  <span className="analytics-data-card-meta">{share.toFixed(1)}% of results · {card.items.toLocaleString()} items</span>
                  <span className="analytics-card-meter" aria-hidden="true"><i style={{ width: `${barWidth}%` }} /></span>
                  {view === 'month' && <span className="analytics-card-hint">Open daily cards <ChevronRight size={14} /></span>}
                </button>
                <button
                  type="button"
                  className="analytics-download-button"
                  onClick={() => downloadCard(card, hubBasis)}
                  aria-label={`Download ${card.label} shipments as Excel`}
                  title="Download this card as an Excel workbook"
                >
                  <Download size={15} />
                  <span>Excel</span>
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="analytics-cards-empty">No cards match this view and the current filters.</div>
      )}

      <div className="analytics-cards-pagination">
        <button type="button" className="btn sm" disabled={currentCardPage === 0} onClick={() => setCardPage((page) => Math.max(0, page - 1))}>
          <ChevronLeft size={15} /> Previous
        </button>
        <span>Page {currentCardPage + 1} of {pageCount} · {CARD_PAGE_SIZE} cards per page</span>
        <button type="button" className="btn sm" disabled={currentCardPage >= pageCount - 1} onClick={() => setCardPage((page) => Math.min(pageCount - 1, page + 1))}>
          Next <ChevronRight size={15} />
        </button>
      </div>

      {selectedCard && view !== 'month' && (
        <section className="analytics-card-details" aria-labelledby="analytics-card-details-title">
          <div className="analytics-details-heading">
            <div>
              <h4 id="analytics-card-details-title">{selectedCard.label}</h4>
              <p>{selectedRows.length.toLocaleString()} shipments · {selectedCard.items.toLocaleString()} items</p>
            </div>
            <button type="button" className="btn sm" onClick={() => downloadCard(selectedCard, hubBasis)}>
              <Download size={15} /> Download Excel
            </button>
          </div>
          <div className="analytics-details-table-wrap">
            <table className="analytics-details-table">
              <thead>
                <tr>
                  <th>Report date</th>
                  <th>Tracking number</th>
                  <th>Business</th>
                  <th>Route</th>
                  <th>Hub</th>
                  <th>Package</th>
                  <th className="numeric-cell">Items</th>
                </tr>
              </thead>
              <tbody>
                {detailRows.map((shipment) => (
                  <tr key={shipment.id}>
                    <td>{shipment.shipmentDate || '—'}</td>
                    <td>{shipment.tracking || '—'}</td>
                    <td>{shipment.business || '—'}</td>
                    <td>{shipment.pickupCity || '—'}{shipment.dropCity ? ` → ${shipment.dropCity}` : ''}</td>
                    <td>{shipment.hubs[hubBasis] ?? shipment.assignedHub ?? '—'}</td>
                    <td>{[shipment.shipType, shipment.packageType, shipment.packageSize].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="numeric-cell">{shipment.items.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="analytics-cards-pagination analytics-details-pagination">
            <button type="button" className="btn sm" disabled={currentDetailPage === 0} onClick={() => setDetailPage((page) => Math.max(0, page - 1))}>
              <ChevronLeft size={15} /> Previous
            </button>
            <span>Page {currentDetailPage + 1} of {detailPageCount} · {DETAIL_PAGE_SIZE} rows per page</span>
            <button type="button" className="btn sm" disabled={currentDetailPage >= detailPageCount - 1} onClick={() => setDetailPage((page) => Math.min(detailPageCount - 1, page + 1))}>
              Next <ChevronRight size={15} />
            </button>
          </div>
        </section>
      )}
    </section>
  );
};
