/**
 * Date Extraction Utility
 * Extracts YYYY-MM-DD from filenames with high accuracy across standard formats.
 */

const MONTH_NAMES: Record<string, string> = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
};

const pad2 = (n: number | string): string => String(n).padStart(2, '0');

export function extractDateFromFilename(filename: string): string | null {
  if (!filename) return null;

  // Remove extension
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');

  // 1. Match ISO pattern: YYYY[-_.]MM[-_.]DD (e.g. 2026-07-01, 2026_07_01, 2026.07.01)
  const isoMatch = nameWithoutExt.match(/(20\d\d)[-_.\s](0[1-9]|1[0-2])[-_.\s](0[1-9]|[12]\d|3[01])/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${month}-${day}`;
  }

  // 2. Match Compact YYYYMMDD (e.g. 20260701)
  const compactMatch = nameWithoutExt.match(/(?:^|[^0-9])(20\d\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:$|[^0-9])/);
  if (compactMatch) {
    const [, year, month, day] = compactMatch;
    return `${year}-${month}-${day}`;
  }

  // 3. Match European / Day-first pattern: DD[-_.]MM[-_.]YYYY (e.g. 01-07-2026, 15_08_2025)
  const euMatch = nameWithoutExt.match(/(0[1-9]|[12]\d|3[01])[-_.\s](0[1-9]|1[0-2])[-_.\s](20\d\d)/);
  if (euMatch) {
    const [, day, month, year] = euMatch;
    return `${year}-${month}-${day}`;
  }

  // 4. Match Month Name patterns, e.g. "01_July_2026", "July_01_2026", "2026_July_01"
  const monthWords = Object.keys(MONTH_NAMES).join('|');
  const monthNameRegex1 = new RegExp(`(0?[1-9]|[12]\\d|3[01])[-_\\s]+(${monthWords})[-_\\s]+(20\\d\\d)`, 'i');
  const mMatch1 = nameWithoutExt.match(monthNameRegex1);
  if (mMatch1) {
    const day = pad2(mMatch1[1]);
    const month = MONTH_NAMES[mMatch1[2].toLowerCase()];
    const year = mMatch1[3];
    return `${year}-${month}-${day}`;
  }

  const monthNameRegex2 = new RegExp(`(${monthWords})[-_\\s]+(0?[1-9]|[12]\\d|3[01])[-_\\s]+(20\\d\\d)`, 'i');
  const mMatch2 = nameWithoutExt.match(monthNameRegex2);
  if (mMatch2) {
    const month = MONTH_NAMES[mMatch2[1].toLowerCase()];
    const day = pad2(mMatch2[2]);
    const year = mMatch2[3];
    return `${year}-${month}-${day}`;
  }

  const monthNameRegex3 = new RegExp(`(20\\d\\d)[-_\\s]+(${monthWords})[-_\\s]+(0?[1-9]|[12]\\d|3[01])`, 'i');
  const mMatch3 = nameWithoutExt.match(monthNameRegex3);
  if (mMatch3) {
    const year = mMatch3[1];
    const month = MONTH_NAMES[mMatch3[2].toLowerCase()];
    const day = pad2(mMatch3[3]);
    return `${year}-${month}-${day}`;
  }

  return null;
}

export function formatReadableDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const [y, m, d] = dateStr.split('-');
    const date = new Date(Date.UTC(+y, +m - 1, +d));
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return dateStr;
  }
}
