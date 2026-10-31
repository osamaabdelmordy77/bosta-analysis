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

  // 1. Match year-first dates, allowing unpadded month and day values.
  const isoMatch = nameWithoutExt.match(/(?:^|[^0-9])(20\d\d)[-_.\s](1[0-2]|0?[1-9])[-_.\s](3[01]|[12]\d|0?[1-9])(?:$|[^0-9])/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return toValidISODate(Number(day), Number(month), Number(year));
  }

  // 2. Match Compact YYYYMMDD (e.g. 20260701)
  const compactMatch = nameWithoutExt.match(/(?:^|[^0-9])(20\d\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:$|[^0-9])/);
  if (compactMatch) {
    const [, year, month, day] = compactMatch;
    return `${year}-${month}-${day}`;
  }

  // 3. Match European / Day-first pattern: DD[-_.]MM[-_.]YYYY (e.g. 01-07-2026, 15_08_2025)
  const euMatch = nameWithoutExt.match(/(0?[1-9]|[12]\d|3[01])[-_.\/\s](0?[1-9]|1[0-2])[-_.\/\s](20\d\d)/);
  if (euMatch) {
    const [, day, month, year] = euMatch;
    return `${year}-${pad2(month)}-${pad2(day)}`;
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

export function extractDateFromSheetNames(sheetNames: string[], year: number): string | null {
  for (const sheetName of sheetNames) {
    const fullDate = extractDateFromFilename(sheetName);
    if (fullDate) return fullDate;

    const yearFirst = sheetName.match(/(?:^|[^0-9])(20\d{2})[-_.\/\s](1[0-2]|0?[1-9])[-_.\/\s](3[01]|[12]\d|0?[1-9])(?:$|[^0-9])/);
    if (yearFirst) {
      const [, fullYear, fullMonth, fullDay] = yearFirst;
      const isoDate = toValidISODate(Number(fullDay), Number(fullMonth), Number(fullYear));
      if (isoDate) return isoDate;
    }

    const match = sheetName.match(/(?:^|[^0-9])(3[01]|[12]\d|0?[1-9])[-_.\/\s](1[0-2]|0?[1-9])(?:[-_.\/\s](20\d{2}))?(?:$|[^0-9])/);
    if (!match) continue;

    const day = Number(match[1]);
    const month = Number(match[2]);
    const dateYear = Number(match[3] || year);
    const isoDate = toValidISODate(day, month, dateYear);
    if (isoDate) return isoDate;
  }

  return null;
}

function toValidISODate(day: number, month: number, year: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
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
