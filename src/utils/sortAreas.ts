import type { ShipmentRecord } from '../types';
import { parseShipmentDateTime, toLocalDateInputValue } from './receiveDateTime';

export const SORT_AREAS = [
  { code: 'A', name: 'الإسكندرية والساحل', hubs: ['Alexandria Hub', 'Khorshid Hub', 'Behira Hub', 'ElAgamy Hub', 'Matrouh Hub', 'Smouha Hub', 'Box-Agamy Hub', 'Box-Alexandria Hub', 'Box-Behira Hub', 'Fulfillment Hub'] },
  { code: 'C', name: 'القناة والبحر الأحمر', hubs: ['Domiatta Hub', 'Ismailia Hub', 'Huarghada Hub', 'Suez Hub', 'Sharm el sheikh hub', 'Port Said Hub', 'Box-Damietta Hub', 'Hurghada'] },
  { code: 'D', name: 'الدلتا', hubs: ['Kafrelsheikh Hub', 'Banha Hub', 'El-Sharkia Hub', 'Tanta Hub', 'El-Mansoura Hub', 'Monufia Hub', '03DSP-Elsadat Hub', 'Mansoura-Talkha Hub', 'Faqous Hub', 'ElMahala Hub', 'Dikernis Hub', 'Qalyoub Hub', 'Box-Kafr El Sheikh Hub', 'Box-Mansoura Hub'] },
  { code: 'E', name: 'القاهرة وشرق القاهرة', hubs: ['Downtown Hub', 'Nasr City Hub', 'Heliopolis Hub', 'El Obour Hub', 'Shorouk Hub', 'Gesr Elsuez Hub', 'Shobra Hub', 'Marg Hub', 'Asher Hub', 'Cairo Sorting Facility', 'Sheraton Hub', 'Box-Nasr City Hub', 'Al Waha hub', 'Sahl 3PL Shorouk'] },
  { code: 'G', name: 'الجيزة وغرب القاهرة', hubs: ['Mohandseen Hub', 'October Hub', 'Hadayk October', 'Haram Hub', 'Hawamdya Hub', 'Imbaba Hub', 'Faisal Hub', 'New October Hub', 'Hadayk El Ahram Hub', '03- Hadayek Al Ahram', 'Box-Giza Hub', 'Giza', '03-Badrsheen Hub'] },
  { code: 'N', name: 'جنوب القاهرة والقاهرة الجديدة', hubs: ['Maadi Hub', 'Mokattam Hub', 'Katamya-New Hub', 'Madinaty Hub', 'Helwan Hub', 'Zahraa El Maadi Hub', 'New Cairo Hub', 'Zahraa Nasr City Hub', '3rd settelment'] },
  { code: 'U', name: 'الصعيد وجه قبلي', hubs: ['Assiut Hub', 'Aswan Hub', 'Qena Hub', 'Luxor Hub', 'Minya Hub', 'Beni Suef Hub', 'Fayoum Hub', 'Sohag Hub', 'Edfo hub', 'New Valley Hub'] },
  { code: 'R', name: 'مراكز FM والمرتجعات والأرشيف', hubs: ['FM Alex', 'FM Abo Rawash', 'FM-Mansoura', 'FM-Maadi', 'FM-Obour', 'FM-New Cairo', 'FM-Tanta', 'FM-Downtown', 'FM-Monufia', 'Not Used Sorting', 'SF-Reverse', 'Archive Hub'] },
] as const;

export const UNKNOWN_AREA = '?';
export const MISSING_HUB = 'Missing Assigned Hub';
export const MISSING_RECEIVED_DATE = 'Missing / invalid received date';
export interface AreaEntry { shipment: ShipmentRecord; area: string; hub: string; date: string; weekday: string }
export interface AreaDateFilters { from: string; to: string; exact: string; weekday?: string }
export interface AreaDailyRow { date: string; weekday: string; counts: Record<string, number>; total: number; items: number }

export function normalizeAssignedHub(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s\-‐‑‒–—]+/g, ' ').trim();
}

const hubLookup = new Map<string, { area: string; hub: string }>();
for (const area of SORT_AREAS) {
  for (const hub of area.hubs) hubLookup.set(normalizeAssignedHub(hub), { area: area.code, hub });
}
// The parentheses in the supplied list describe this hub; they are not part of its name.
for (const alias of ['3rd settlement', '3rd settelment (التجمع الثالث)', 'التجمع الثالث']) {
  hubLookup.set(normalizeAssignedHub(alias), { area: 'N', hub: '3rd settelment' });
}

export function classifySortAreas(shipments: ShipmentRecord[]): AreaEntry[] {
  const unknownNames = new Map<string, string>();
  return shipments.map((shipment) => {
    const rawHub = shipment.hubs['Assigned Hub']?.trim() || shipment.assignedHub?.trim() || '';
    const key = normalizeAssignedHub(rawHub);
    const known = hubLookup.get(key);
    if (!known && !unknownNames.has(key)) unknownNames.set(key, rawHub || MISSING_HUB);
    const received = parseShipmentDateTime(shipment.receivedTime);
    return {
      shipment,
      area: known?.area ?? UNKNOWN_AREA,
      hub: known?.hub ?? unknownNames.get(key)!,
      date: received ? toLocalDateInputValue(received) : '',
      weekday: received ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][received.getDay()] : '',
    };
  });
}

export function filterAreaDates(entries: AreaEntry[], filters: AreaDateFilters): AreaEntry[] {
  return entries.filter(({ date, weekday }) => {
    if (!date) return !filters.from && !filters.to && !filters.exact && !filters.weekday;
    return (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to)
      && (!filters.exact || date === filters.exact) && (!filters.weekday || weekday === filters.weekday);
  });
}

export function summarizeAreaDates(entries: AreaEntry[]): AreaDailyRow[] {
  const dates = new Map<string, AreaDailyRow>();
  for (const entry of entries) {
    let row = dates.get(entry.date);
    if (!row) {
      row = { date: entry.date, weekday: entry.weekday, counts: Object.create(null), total: 0, items: 0 };
      dates.set(entry.date, row);
    }
    row.counts[entry.hub] = (row.counts[entry.hub] ?? 0) + 1;
    row.total++;
    row.items += Number.isFinite(entry.shipment.items) ? entry.shipment.items : 0;
  }
  return [...dates.values()].sort((a, b) => !a.date ? 1 : !b.date ? -1 : a.date.localeCompare(b.date));
}
