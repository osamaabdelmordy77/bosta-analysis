import React, { useState, useRef, useEffect, useMemo } from 'react';
import { FilterState } from '../types';
import { ChevronDown, Search, X } from 'lucide-react';

interface MultiSelectProps {
  label: string;
  options: { name: string; count: number }[];
  selected: Set<string>;
  onChange: (newSelected: Set<string>) => void;
}

const MultiSelect: React.FC<MultiSelectProps> = ({
  label,
  options,
  selected,
  onChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const popRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isOpen]);

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;
    // selected first, then by count descending, then alphabetical
    return [...list].sort((a, b) => {
      const aSel = selected.has(a.name) ? 1 : 0;
      const bSel = selected.has(b.name) ? 1 : 0;
      return bSel - aSel || b.count - a.count || a.name.localeCompare(b.name);
    });
  }, [options, search, selected]);

  const toggleOption = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    onChange(next);
  };

  const clearSelection = () => {
    onChange(new Set());
  };

  const displayText = useMemo(() => {
    if (selected.size === 0) return 'All';
    if (selected.size === 1) return Array.from(selected)[0];
    return `${selected.size} selected`;
  }, [selected]);

  return (
    <div className="fl" ref={popRef}>
      <span>{label}</span>
      <button
        type="button"
        className={`ms-btn ${selected.size > 0 ? 'on' : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className="ms-v">{displayText}</span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      </button>

      {isOpen && (
        <div className="ms-pop">
          <div className="relative">
            <input
              type="search"
              placeholder={`Search ${label.toLowerCase()}…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
            {search && (
              <button
                type="button"
                className="absolute right-2 top-2 text-slate-400 hover:text-white"
                onClick={() => setSearch('')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="ms-act">
            <a onClick={clearSelection}>Clear selection</a>
            <a onClick={() => setIsOpen(false)}>Close</a>
          </div>

          <div className="ms-list">
            {filteredOptions.slice(0, 250).map((opt) => {
              const isChecked = selected.has(opt.name);
              return (
                <label key={opt.name} className={`ms-opt ${opt.count === 0 ? 'z' : ''}`}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleOption(opt.name)}
                  />
                  <span className="truncate">{opt.name}</span>
                  <span className="n">{opt.count.toLocaleString()}</span>
                </label>
              );
            })}
            {filteredOptions.length > 250 && (
              <div className="p-1.5 text-xs text-slate-400 text-center">
                Showing top 250 options. Type to filter more.
              </div>
            )}
            {filteredOptions.length === 0 && (
              <div className="p-3 text-xs text-slate-400 text-center">No matches found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface FilterBarProps {
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  onClearFilters: () => void;
  availableOptions: {
    hubs: { name: string; count: number }[];
    businesses: { name: string; count: number }[];
    shipTypes: { name: string; count: number }[];
    pkgTypes: { name: string; count: number }[];
    pickupCities: { name: string; count: number }[];
    dropCities: { name: string; count: number }[];
    years: string[];
    months: string[];
    dates: string[];
  };
}

export const FilterBar: React.FC<FilterBarProps> = ({
  filters,
  onFilterChange,
  onClearFilters,
  availableOptions,
}) => {
  const activeCount = useMemo(() => {
    let count = 0;
    if (filters.hub.size > 0) count++;
    if (filters.biz.size > 0) count++;
    if (filters.st.size > 0) count++;
    if (filters.pt.size > 0) count++;
    if (filters.pc.size > 0) count++;
    if (filters.dc.size > 0) count++;
    if (filters.year && filters.year !== 'all') count++;
    if (filters.month && filters.month !== 'all') count++;
    if (filters.specificDate && filters.specificDate !== 'all') count++;
    if (filters.dateFrom || filters.dateTo) count++;
    return count;
  }, [filters]);

  return (
    <section className="card filters">
      <div className="fbar">
        {/* Year Filter */}
        <div className="fl">
          <span>Year</span>
          <select
            value={filters.year}
            onChange={(e) => onFilterChange({ ...filters, year: e.target.value })}
            className={filters.year !== 'all' ? 'on' : ''}
          >
            <option value="all">All Years</option>
            {availableOptions.years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        {/* Month Filter */}
        <div className="fl">
          <span>Month</span>
          <select
            value={filters.month}
            onChange={(e) => onFilterChange({ ...filters, month: e.target.value })}
            className={filters.month !== 'all' ? 'on' : ''}
          >
            <option value="all">All Months</option>
            {availableOptions.months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        {/* Specific Date Filter */}
        <div className="fl">
          <span>Specific Date</span>
          <select
            value={filters.specificDate}
            onChange={(e) => onFilterChange({ ...filters, specificDate: e.target.value })}
            className={filters.specificDate !== 'all' ? 'on' : ''}
          >
            <option value="all">All Dates ({availableOptions.dates.length} days)</option>
            {availableOptions.dates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        {/* Multi-Select Filters */}
        <MultiSelect
          label="Assigned Hub"
          options={availableOptions.hubs}
          selected={filters.hub}
          onChange={(hub) => onFilterChange({ ...filters, hub })}
        />

        <MultiSelect
          label="Business"
          options={availableOptions.businesses}
          selected={filters.biz}
          onChange={(biz) => onFilterChange({ ...filters, biz })}
        />

        <MultiSelect
          label="Shipment Type"
          options={availableOptions.shipTypes}
          selected={filters.st}
          onChange={(st) => onFilterChange({ ...filters, st })}
        />

        <MultiSelect
          label="Package Type"
          options={availableOptions.pkgTypes}
          selected={filters.pt}
          onChange={(pt) => onFilterChange({ ...filters, pt })}
        />

        <MultiSelect
          label="Pickup City"
          options={availableOptions.pickupCities}
          selected={filters.pc}
          onChange={(pc) => onFilterChange({ ...filters, pc })}
        />

        <MultiSelect
          label="DropOff City"
          options={availableOptions.dropCities}
          selected={filters.dc}
          onChange={(dc) => onFilterChange({ ...filters, dc })}
        />

        {/* Date Range Filter */}
        <div className="fl">
          <span>Date Range</span>
          <div className="fgo">
            <input
              type="date"
              title="From Date"
              value={filters.dateFrom}
              onChange={(e) => onFilterChange({ ...filters, dateFrom: e.target.value })}
            />
            <input
              type="date"
              title="To Date"
              value={filters.dateTo}
              onChange={(e) => onFilterChange({ ...filters, dateTo: e.target.value })}
            />
          </div>
        </div>

        {/* Clear All Filters Button */}
        <div className="fl">
          <span>&nbsp;</span>
          <button
            type="button"
            className="btn pri"
            onClick={onClearFilters}
            title="Reset all active filters"
          >
            ✕ Clear all {activeCount > 0 ? `(${activeCount})` : ''}
          </button>
        </div>
      </div>
    </section>
  );
};
