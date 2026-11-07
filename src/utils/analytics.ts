import { ShipmentRecord, FilterState, AggregationResult, HubAgg, BizAgg } from '../types';

export function filterShipments(records: ShipmentRecord[], filters: FilterState, hubBasisKey?: string): ShipmentRecord[] {
  return records.filter((r) => {
    // Hub filter
    if (filters.hub.size > 0) {
      const hVal = hubBasisKey && r.hubs[hubBasisKey] !== undefined ? r.hubs[hubBasisKey] : r.assignedHub;
      if (!hVal || !filters.hub.has(hVal)) return false;
    }

    // Business filter
    if (filters.biz.size > 0) {
      if (!r.business || !filters.biz.has(r.business)) return false;
    }

    // Shipment type filter
    if (filters.st.size > 0) {
      if (!r.shipType || !filters.st.has(r.shipType)) return false;
    }

    // Package type filter
    if (filters.pt.size > 0) {
      if (!r.packageType || !filters.pt.has(r.packageType)) return false;
    }

    if (filters.size.size > 0) {
      if (!r.packageSize || !filters.size.has(r.packageSize)) return false;
    }

    // Pickup city filter
    if (filters.pc.size > 0) {
      if (!r.pickupCity || !filters.pc.has(r.pickupCity)) return false;
    }

    // Dropoff city filter
    if (filters.dc.size > 0) {
      if (!r.dropCity || !filters.dc.has(r.dropCity)) return false;
    }

    if (filters.fileIds.size > 0 && !filters.fileIds.has(r.fileId)) return false;
    if (filters.lane.size > 0) {
      if (!r.pickupCity || !r.dropCity || !filters.lane.has(`${r.pickupCity} → ${r.dropCity}`)) return false;
    }

    // Date filters: use r.shipmentDate (YYYY-MM-DD)
    const sDate = r.shipmentDate;

    // Specific date
    if (filters.specificDate && filters.specificDate !== 'all') {
      if (sDate !== filters.specificDate) return false;
    }

    // Year
    if (filters.year && filters.year !== 'all') {
      if (!sDate.startsWith(filters.year)) return false;
    }

    // Month
    if (filters.month && filters.month !== 'all') {
      // filters.month might be "2026-07" or "07"
      if (filters.month.includes('-')) {
        if (!sDate.startsWith(filters.month)) return false;
      } else {
        const parts = sDate.split('-');
        if (parts[1] !== filters.month) return false;
      }
    }

    // Date range
    if (filters.dateFrom) {
      if (sDate < filters.dateFrom) return false;
    }
    if (filters.dateTo) {
      if (sDate > filters.dateTo) return false;
    }

    return true;
  });
}

export function computeAggregations(
  filtered: ShipmentRecord[],
  allKnownHubs: string[],
  hubBasisKey: string = 'Assigned Hub'
): AggregationResult {
  const totalShipments = filtered.length;
  let totalItems = 0;

  const hubMap = new Map<string, { n: number; items: number }>();
  const bizMap = new Map<string, { n: number; items: number }>();
  const shipTypeMap = new Map<string, { n: number; items: number }>();
  const pkgTypeMap = new Map<string, number>();
  const pkgSizeMap = new Map<string, number>();
  const pcMap = new Map<string, number>();
  const dcMap = new Map<string, number>();
  const pzMap = new Map<string, number>();
  const laneMap = new Map<string, number>();
  const dateMap = new Map<string, { n: number; items: number }>();
  const monthMap = new Map<string, { n: number; items: number }>();
  const dowMap = new Array(7).fill(0); // 0=Sun, 1=Mon, ..., 6=Sat

  // Hub performance per day and business per day
  const dayHubMap = new Map<string, Map<string, number>>();
  const dayBizMap = new Map<string, Map<string, number>>();

  for (let i = 0; i < filtered.length; i++) {
    const r = filtered[i];
    totalItems += r.items;

    // Hub
    const hubName = (hubBasisKey && r.hubs[hubBasisKey] !== undefined ? r.hubs[hubBasisKey] : r.assignedHub) || null;
    if (hubName) {
      const e = hubMap.get(hubName) || { n: 0, items: 0 };
      e.n += 1;
      e.items += r.items;
      hubMap.set(hubName, e);
    }

    // Business
    if (r.business) {
      const e = bizMap.get(r.business) || { n: 0, items: 0 };
      e.n += 1;
      e.items += r.items;
      bizMap.set(r.business, e);
    }

    // Ship Type
    if (r.shipType) {
      const e = shipTypeMap.get(r.shipType) || { n: 0, items: 0 };
      e.n += 1;
      e.items += r.items;
      shipTypeMap.set(r.shipType, e);
    }

    // Package Type
    if (r.packageType) {
      pkgTypeMap.set(r.packageType, (pkgTypeMap.get(r.packageType) || 0) + 1);
    }

    // Package Size
    if (r.packageSize) {
      pkgSizeMap.set(r.packageSize, (pkgSizeMap.get(r.packageSize) || 0) + 1);
    }

    // Pickup City
    if (r.pickupCity) {
      pcMap.set(r.pickupCity, (pcMap.get(r.pickupCity) || 0) + 1);
    }

    // Drop City
    if (r.dropCity) {
      dcMap.set(r.dropCity, (dcMap.get(r.dropCity) || 0) + 1);
    }

    // Pickup Zone
    if (r.pickupZone) {
      pzMap.set(r.pickupZone, (pzMap.get(r.pickupZone) || 0) + 1);
    }

    // Lane
    if (r.pickupCity && r.dropCity) {
      const laneKey = `${r.pickupCity} → ${r.dropCity}`;
      laneMap.set(laneKey, (laneMap.get(laneKey) || 0) + 1);
    }

    // Daily & Monthly Trends
    if (r.shipmentDate) {
      const dStr = r.shipmentDate;
      const mStr = dStr.slice(0, 7);

      const dEntry = dateMap.get(dStr) || { n: 0, items: 0 };
      dEntry.n += 1;
      dEntry.items += r.items;
      dateMap.set(dStr, dEntry);

      const mEntry = monthMap.get(mStr) || { n: 0, items: 0 };
      mEntry.n += 1;
      mEntry.items += r.items;
      monthMap.set(mStr, mEntry);

      // Day of week
      const [y, m, d] = dStr.split('-');
      const dObj = new Date(Date.UTC(+y, +m - 1, +d));
      const dow = dObj.getUTCDay();
      dowMap[dow] += 1;

      // Hub daily
      if (hubName) {
        if (!dayHubMap.has(dStr)) dayHubMap.set(dStr, new Map());
        const dh = dayHubMap.get(dStr)!;
        dh.set(hubName, (dh.get(hubName) || 0) + 1);
      }

      // Biz daily
      if (r.business) {
        if (!dayBizMap.has(dStr)) dayBizMap.set(dStr, new Map());
        const db = dayBizMap.get(dStr)!;
        db.set(r.business, (db.get(r.business) || 0) + 1);
      }
    }
  }

  // Calculate Hubs
  const hubNamesUniverse = Array.from(new Set([...allKnownHubs, ...hubMap.keys()]));
  const hubRows: HubAgg[] = hubNamesUniverse.map((name) => {
    const data = hubMap.get(name) || { n: 0, items: 0 };
    return {
      name,
      n: data.n,
      items: data.items,
      rank: 0,
      share: 0,
      cum: 0,
      vs: 0,
      status: data.n === 0 ? 'No shipments' : 'Pending',
    };
  });

  hubRows.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const activeHubsCount = hubRows.filter((h) => h.n > 0).length;
  const zeroHubsCount = hubRows.filter((h) => h.n === 0).length;
  const totalHubVolume = hubRows.reduce((sum, h) => sum + h.n, 0);
  const avgHub = activeHubsCount > 0 ? totalHubVolume / activeHubsCount : 0;

  let cumHubShare = 0;
  hubRows.forEach((h, i) => {
    h.rank = i + 1;
    h.share = totalHubVolume > 0 ? h.n / totalHubVolume : 0;
    cumHubShare += h.share;
    h.cum = cumHubShare;
    h.vs = avgHub > 0 && h.n > 0 ? h.n / avgHub - 1 : 0;
    h.status = h.n === 0 ? 'No shipments' : h.n >= avgHub ? 'Above average' : 'Below average';
  });

  const activeHubRows = hubRows.filter((h) => h.n > 0);
  const highestHub = activeHubRows.length > 0 ? { name: activeHubRows[0].name, n: activeHubRows[0].n, share: activeHubRows[0].share } : null;
  const lowestHub = activeHubRows.length > 0 ? { name: activeHubRows[activeHubRows.length - 1].name, n: activeHubRows[activeHubRows.length - 1].n, share: activeHubRows[activeHubRows.length - 1].share } : null;

  // Calculate Businesses
  const bizRows: BizAgg[] = Array.from(bizMap.entries()).map(([name, data]) => ({
    name,
    n: data.n,
    items: data.items,
    rank: 0,
    share: 0,
    cum: 0,
    ips: data.n > 0 ? data.items / data.n : 0,
  }));
  bizRows.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const totalBizVolume = bizRows.reduce((sum, b) => sum + b.n, 0);
  const avgBiz = bizRows.length > 0 ? totalBizVolume / bizRows.length : 0;

  let cumBizShare = 0;
  bizRows.forEach((b, i) => {
    b.rank = i + 1;
    b.share = totalBizVolume > 0 ? b.n / totalBizVolume : 0;
    cumBizShare += b.share;
    b.cum = cumBizShare;
  });

  // Shipment Types
  const shipTypeRows = Array.from(shipTypeMap.entries()).map(([name, data]) => ({
    name,
    n: data.n,
    items: data.items,
    share: totalShipments > 0 ? data.n / totalShipments : 0,
  })).sort((a, b) => b.n - a.n);

  // Package Types
  const pkgTypeRows = Array.from(pkgTypeMap.entries()).map(([name, n]) => ({
    name,
    n,
    share: totalShipments > 0 ? n / totalShipments : 0,
  })).sort((a, b) => b.n - a.n);

  // Package Sizes
  const packageSizeRows = Array.from(pkgSizeMap.entries()).map(([name, n]) => ({
    name,
    n,
    share: totalShipments > 0 ? n / totalShipments : 0,
  })).sort((a, b) => b.n - a.n);

  // Pickup Cities
  const pickupCityRows = Array.from(pcMap.entries()).map(([name, n]) => ({
    name,
    n,
    share: totalShipments > 0 ? n / totalShipments : 0,
  })).sort((a, b) => b.n - a.n);

  // Drop Cities
  const dropCityRows = Array.from(dcMap.entries()).map(([name, n]) => ({
    name,
    n,
    share: totalShipments > 0 ? n / totalShipments : 0,
  })).sort((a, b) => b.n - a.n);

  // Pickup Zones
  const pickupZoneRows = Array.from(pzMap.entries()).map(([name, n]) => ({
    name,
    n,
    share: totalShipments > 0 ? n / totalShipments : 0,
  })).sort((a, b) => b.n - a.n);

  // Lanes
  const laneRows = Array.from(laneMap.entries()).map(([name, n]) => ({
    name,
    n,
    share: totalShipments > 0 ? n / totalShipments : 0,
  })).sort((a, b) => b.n - a.n);

  // Daily Trend
  const dailyDates = Array.from(dateMap.keys()).sort();
  const dailyTrend = dailyDates.map((date) => ({
    date,
    n: dateMap.get(date)!.n,
    items: dateMap.get(date)!.items,
  }));

  // Monthly Trend
  const monthlyDates = Array.from(monthMap.keys()).sort();
  const monthlyTrend = monthlyDates.map((month) => ({
    month,
    n: monthMap.get(month)!.n,
    items: monthMap.get(month)!.items,
  }));

  // Day of Week Trend
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayOfWeekTrend = [1, 2, 3, 4, 5, 6, 0].map((idx) => ({
    day: dayNames[idx],
    dayIndex: idx,
    n: dowMap[idx],
  }));

  // Hub and Biz Daily Performance
  const hubDailyPerformance = dailyDates.map((date) => {
    const dh = dayHubMap.get(date) || new Map();
    const sorted = Array.from(dh.entries())
      .map(([name, n]) => ({ name, n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 5);
    return { date, topHubs: sorted };
  });

  const bizDailyPerformance = dailyDates.map((date) => {
    const db = dayBizMap.get(date) || new Map();
    const sorted = Array.from(db.entries())
      .map(([name, n]) => ({ name, n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 5);
    return { date, topBiz: sorted };
  });

  // Monthly MoM Growth
  const monthlyMoM = monthlyTrend.map((cur, idx) => {
    if (idx === 0) return { month: cur.month, n: cur.n, growthPct: null };
    const prev = monthlyTrend[idx - 1];
    const growthPct = prev.n > 0 ? ((cur.n - prev.n) / prev.n) * 100 : null;
    return { month: cur.month, n: cur.n, growthPct };
  });

  // Highest and lowest shipment days
  let highestDay: { date: string; n: number } | null = null;
  let lowestDay: { date: string; n: number } | null = null;
  if (dailyTrend.length > 0) {
    const sortedDays = [...dailyTrend].sort((a, b) => b.n - a.n);
    highestDay = { date: sortedDays[0].date, n: sortedDays[0].n };
    lowestDay = { date: sortedDays[sortedDays.length - 1].date, n: sortedDays[sortedDays.length - 1].n };
  }

  const avgDailyShipments = dailyTrend.length > 0 ? totalShipments / dailyTrend.length : 0;

  return {
    totalShipments,
    totalItems,
    activeHubs: activeHubsCount,
    zeroHubs: zeroHubsCount,
    totalHubs: hubRows.length,
    avgShipmentsPerHub: avgHub,
    avgShipmentsPerBiz: avgBiz,
    highestHub,
    lowestHub,
    hubRows,
    bizRows,
    shipTypeRows,
    pkgTypeRows,
    pickupCityRows,
    dropCityRows,
    pickupZoneRows,
    packageSizeRows,
    laneRows,
    dailyTrend,
    monthlyTrend,
    dayOfWeekTrend,
    hubDailyPerformance,
    bizDailyPerformance,
    monthlyMoM,
    highestDay,
    lowestDay,
    avgDailyShipments,
  };
}
