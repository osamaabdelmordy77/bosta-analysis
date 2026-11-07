import React, { useMemo, useState } from 'react';
import { FilterState } from '../types';
import { ChevronDown, X } from 'lucide-react';

type PageName = 'Dashboard' | 'Receive' | 'Sort' | 'Transfer' | 'Loading' | 'Users' | 'Roles & Permissions';
type FilterKey = 'date' | 'fileIds' | 'hub' | 'biz' | 'pc' | 'dc' | 'st' | 'pt' | 'size' | 'lane';

interface FilterOption {
  name: string;
  value?: string;
  count?: number;
}

interface PageFilterPanelProps {
  page: PageName;
  tab: 'Sheets' | 'Live';
  centerLabel: string;
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  onClearFilters: () => void;
  availableOptions: Partial<Record<'dates' | 'fileIds' | 'hubs' | 'businesses' | 'pickupCities' | 'dropCities' | 'shipTypes' | 'pkgTypes' | 'size' | 'lane', FilterOption[]>>;
  accessOptions: Record<string, string[]>;
  accessFilters: Record<string, string>;
  onAccessFilterChange: (key: string, value: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  resultCount: number;
  totalCount: number;
}

const operationFilters: Record<Exclude<PageName, 'Users' | 'Roles & Permissions'>, { primary: [FilterKey, string][]; more: [FilterKey, string][] }> = {
  Dashboard: {
    primary: [['date', 'Report date'], ['fileIds', 'File'], ['hub', 'Center'], ['biz', 'Business'], ['pc', 'Pickup city'], ['st', 'Shipment type']],
    more: [['pt', 'Package type'], ['size', 'Package size'], ['dc', 'Drop-off city']],
  },
  Receive: {
    primary: [['date', 'Report date'], ['fileIds', 'File'], ['hub', 'Center'], ['biz', 'Business'], ['pc', 'Pickup city'], ['st', 'Shipment type']],
    more: [['pt', 'Package type'], ['size', 'Package size'], ['dc', 'Drop-off city']],
  },
  Sort: {
    primary: [['date', 'Report date'], ['hub', 'Center'], ['pt', 'Package type']],
    more: [['size', 'Package size'], ['biz', 'Business'], ['st', 'Shipment type']],
  },
  Transfer: {
    primary: [['date', 'Report date'], ['hub', 'Assigned center'], ['lane', 'Pickup → drop-off route'], ['pc', 'Pickup city'], ['dc', 'Drop-off city']],
    more: [['biz', 'Business'], ['st', 'Shipment type'], ['pt', 'Package type']],
  },
  Loading: {
    primary: [['date', 'Report date'], ['hub', 'Assigned center'], ['dc', 'Destination city'], ['st', 'Shipment type']],
    more: [['pt', 'Package type'], ['size', 'Package size'], ['biz', 'Business'], ['pc', 'Pickup city']],
  },
};

const keyForFilter: Partial<Record<FilterKey, keyof FilterState>> = {
  fileIds: 'fileIds',
  hub: 'hub',
  biz: 'biz',
  pc: 'pc',
  dc: 'dc',
  st: 'st',
  pt: 'pt',
  size: 'size',
  lane: 'lane',
};

export const PageFilterPanel: React.FC<PageFilterPanelProps> = ({
  page,
  tab,
  centerLabel,
  filters,
  onFilterChange,
  onClearFilters,
  availableOptions,
  accessOptions,
  accessFilters,
  onAccessFilterChange,
  search,
  onSearchChange,
  resultCount,
  totalCount,
}) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const isOperation = page !== 'Users' && page !== 'Roles & Permissions';

  const configured = isOperation ? operationFilters[page] : null;
  const displayLabel = (key: FilterKey, label: string) => key === 'hub' ? centerLabel : label;
  const availableFor = (key: FilterKey): FilterOption[] => {
    if (key === 'date') return availableOptions.dates || [];
    const optionKey: Record<Exclude<FilterKey, 'date'>, keyof NonNullable<PageFilterPanelProps['availableOptions']>> = {
      fileIds: 'fileIds',
      hub: 'hubs',
      biz: 'businesses',
      pc: 'pickupCities',
      dc: 'dropCities',
      st: 'shipTypes',
      pt: 'pkgTypes',
      size: 'size',
      lane: 'lane',
    };
    return availableOptions[optionKey[key]] || [];
  };
  const visibleFilters = (configured?.primary || []).filter(([key]) => availableFor(key).length > 0);
  const moreFilters = (configured?.more || []).filter(([key]) => availableFor(key).length > 0);

  const activeChips = useMemo(() => {
    if ((isOperation && tab !== 'Sheets') || (!isOperation && tab !== 'Live')) return [];
    if (!isOperation) {
      return Object.entries(accessFilters)
        .filter(([, value]) => value)
        .map(([key, value]) => ({
          key,
          value,
          label: `${key === 'role' ? 'Role' : key === 'status' ? 'Status' : key === 'group' ? 'Permission group' : 'Availability'}: ${value === '__unassigned__' ? 'No role assigned' : value}`,
          filterKey: undefined as FilterKey | undefined,
        }));
    }

    const chips: { key: string; value: string; label: string; filterKey: FilterKey }[] = [];
    for (const [filterKey, configuredLabel] of [...(configured?.primary || []), ...(configured?.more || [])]) {
      const label = displayLabel(filterKey, configuredLabel);
      if (filterKey === 'date') {
        if (filters.specificDate !== 'all') chips.push({ key: 'specificDate', value: filters.specificDate, label: `${label}: ${filters.specificDate}`, filterKey });
        if (filters.year !== 'all') chips.push({ key: 'year', value: filters.year, label: `Report year: ${filters.year}`, filterKey });
        if (filters.month !== 'all') chips.push({ key: 'month', value: filters.month, label: `Report month: ${filters.month}`, filterKey });
        if (filters.dateFrom || filters.dateTo) chips.push({ key: 'dateRange', value: `${filters.dateFrom}|${filters.dateTo}`, label: `${label}: ${filters.dateFrom || '…'} – ${filters.dateTo || '…'}`, filterKey });
        continue;
      }
      const stateKey = keyForFilter[filterKey];
      const selected = stateKey ? filters[stateKey] as Set<string> : undefined;
      selected?.forEach((value) => {
        const name = filterKey === 'fileIds'
          ? availableOptions.fileIds?.find((option) => (option.value || option.name) === value)?.name || value
          : value;
        chips.push({ key: `${filterKey}:${value}`, value, label: `${label}: ${name}`, filterKey });
      });
    }
    return chips;
  }, [accessFilters, availableOptions.fileIds, configured, filters, isOperation, tab, centerLabel]);

  const activeCount = isOperation
    ? new Set(activeChips.map((chip) => chip.filterKey || chip.key)).size
    : activeChips.length + (tab === 'Live' && search.trim() ? 1 : 0);

  const removeChip = (chip: (typeof activeChips)[number]) => {
    if (!isOperation) {
      onAccessFilterChange(chip.key, '');
      return;
    }
    if (chip.key === 'specificDate') {
      onFilterChange({ ...filters, specificDate: 'all' });
    } else if (chip.key === 'year') {
      onFilterChange({ ...filters, year: 'all' });
    } else if (chip.key === 'month') {
      onFilterChange({ ...filters, month: 'all' });
    } else if (chip.key === 'dateRange') {
      onFilterChange({ ...filters, dateFrom: '', dateTo: '' });
    } else {
      const filterKey = chip.key.slice(0, chip.key.indexOf(':')) as FilterKey;
      const stateKey = keyForFilter[filterKey];
      if (!stateKey) return;
      const selected = new Set(filters[stateKey] as Set<string>);
      selected.delete(chip.value);
      onFilterChange({ ...filters, [stateKey]: selected });
    }
  };

  const updateOperationFilter = (key: FilterKey, value: string) => {
    if (key === 'date') {
      onFilterChange({ ...filters, specificDate: value || 'all' });
      return;
    }
    const stateKey = keyForFilter[key];
    if (stateKey) onFilterChange({ ...filters, [stateKey]: value ? new Set([value]) : new Set() });
  };

  const renderOperationSelect = ([key, configuredLabel]: [FilterKey, string], idSuffix: string) => {
    const label = displayLabel(key, configuredLabel);
    const options = availableFor(key);
    if (!options.length) return null;
    const value = key === 'date'
      ? filters.specificDate === 'all' ? '' : filters.specificDate
      : Array.from(filters[keyForFilter[key]!] as Set<string>)[0] || '';
    return (
      <label className="page-filter-control" key={`${key}-${idSuffix}`}>
        <span>{label}</span>
        <select value={value} onChange={(event) => updateOperationFilter(key, event.target.value)}>
          <option value="">All {label.toLowerCase()}s</option>
          {options.map((option) => <option key={option.value || option.name} value={option.value || option.name}>{option.name}{option.count !== undefined ? ` (${option.count.toLocaleString()})` : ''}</option>)}
        </select>
      </label>
    );
  };

  const handleClear = () => {
    if (isOperation) onClearFilters();
    else {
      onSearchChange('');
      Object.keys(accessFilters).forEach((key) => onAccessFilterChange(key, ''));
    }
  };

  return (
    <section className="page-filter-panel" aria-label={`${page} ${tab} filters`}>
      {isOperation && tab === 'Live' ? (
        <div className="unsupported-filter-note">Filters are unavailable until a live operations source is connected.</div>
      ) : !isOperation && tab === 'Sheets' ? (
        <div className="unsupported-filter-note">Filters are unavailable because no sheet source is connected for this page.</div>
      ) : !isOperation ? (
        <div className="page-filter-main access-filter-main">
          <label className="page-filter-control access-search-control">
            <span>{page === 'Users' ? 'Name or email' : 'Role or permission'}</span>
            <input
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={page === 'Users' ? 'Search names and email addresses' : 'Search role names or permission keys'}
            />
          </label>
          {page === 'Users' ? (
            <>
              {accessOptions.roles?.length > 0 && <label className="page-filter-control"><span>Role</span><select value={accessFilters.role || ''} onChange={(event) => onAccessFilterChange('role', event.target.value)}><option value="">All roles</option>{accessOptions.roles.map((role) => <option key={role} value={role}>{role === '__unassigned__' ? 'No role assigned' : role}</option>)}</select></label>}
              {accessOptions.statuses?.length > 0 && <label className="page-filter-control"><span>Membership status</span><select value={accessFilters.status || ''} onChange={(event) => onAccessFilterChange('status', event.target.value)}><option value="">All statuses</option>{accessOptions.statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>}
            </>
          ) : (
            <>
              {accessOptions.groups?.length > 0 && <label className="page-filter-control"><span>Permission group</span><select value={accessFilters.group || ''} onChange={(event) => onAccessFilterChange('group', event.target.value)}><option value="">All groups</option>{accessOptions.groups.map((group) => <option key={group} value={group}>{group}</option>)}</select></label>}
              {accessOptions.scopes?.length > 0 && <label className="page-filter-control"><span>Availability</span><select value={accessFilters.scope || ''} onChange={(event) => onAccessFilterChange('scope', event.target.value)}><option value="">All scopes</option>{accessOptions.scopes.map((scope) => <option key={scope} value={scope}>{scope}</option>)}</select></label>}
            </>
          )}
        </div>
      ) : (
        <>
          <div className="page-filter-main">
            {visibleFilters.slice(0, 4).map((definition) => renderOperationSelect(definition, 'primary'))}
            {(visibleFilters.length > 4 || moreFilters.length > 0 || Boolean(availableOptions.dates?.length)) && (
              <button type="button" className={`more-filters-toggle${moreOpen ? ' is-open' : ''}`} onClick={() => setMoreOpen((open) => !open)} aria-expanded={moreOpen}>
                More filters <ChevronDown size={15} />
              </button>
            )}
          </div>
          {moreOpen && (
            <div className="more-filters-panel">
              {visibleFilters.slice(4).map((definition) => renderOperationSelect(definition, 'extra'))}
              {moreFilters.map((definition) => renderOperationSelect(definition, 'more'))}
              {Boolean(availableOptions.dates?.length) && (
                <div className="page-filter-control date-range-control">
                  <span>Report date range</span>
                  <div><input type="date" aria-label="Report date from" value={filters.dateFrom} onChange={(event) => onFilterChange({ ...filters, dateFrom: event.target.value })} /><input type="date" aria-label="Report date to" value={filters.dateTo} onChange={(event) => onFilterChange({ ...filters, dateTo: event.target.value })} /></div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <div className="page-filter-footer">
        <div className="active-filter-summary">
          <strong>{activeCount} active {activeCount === 1 ? 'filter' : 'filters'}</strong>
          <span>{resultCount.toLocaleString()} of {totalCount.toLocaleString()} results</span>
        </div>
        <button type="button" className="clear-filters-button" onClick={handleClear} disabled={activeCount === 0}>Clear</button>
      </div>

      {(activeChips.length > 0 || (!isOperation && search.trim())) && (
        <div className="active-filter-chips" aria-label="Active filters">
          {activeChips.map((chip) => (
            <button type="button" className="active-filter-chip" key={`${chip.key}:${chip.value}`} onClick={() => removeChip(chip)} aria-label={`Remove filter ${chip.label}`}>
              <span>{chip.label}</span><X size={13} />
            </button>
          ))}
          {!isOperation && tab === 'Live' && search.trim() && (
            <button type="button" className="active-filter-chip" onClick={() => onSearchChange('')} aria-label="Remove search filter">
              <span>Search: {search}</span><X size={13} />
            </button>
          )}
        </div>
      )}
    </section>
  );
};
