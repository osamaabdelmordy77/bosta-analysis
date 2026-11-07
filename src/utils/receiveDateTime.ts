export function parseShipmentDateTime(value?: string | null): Date | null {
  if (!value) return null;

  const match = value.trim().match(/^(\d{2})-(\d{2})-(\d{4}), (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;

  const [, month, day, year, hour, minute, second] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  if (
    parsed.getFullYear() !== Number(year)
    || parsed.getMonth() !== Number(month) - 1
    || parsed.getDate() !== Number(day)
    || parsed.getHours() !== Number(hour)
    || parsed.getMinutes() !== Number(minute)
    || parsed.getSeconds() !== Number(second)
  ) {
    return null;
  }

  return parsed;
}

export function getElapsedMinutes(pickedUpDate?: string | null, receivedTime?: string | null): number | null {
  const pickedUp = parseShipmentDateTime(pickedUpDate);
  const received = parseShipmentDateTime(receivedTime);
  if (!pickedUp || !received) return null;
  return Math.trunc((received.getTime() - pickedUp.getTime()) / 60_000);
}

export function formatElapsedMinutes(minutes: number | null): string {
  if (minutes === null) return '—';
  const magnitude = Math.abs(minutes);
  const hours = Math.floor(magnitude / 60);
  const remainingMinutes = magnitude % 60;
  return `${minutes < 0 ? '-' : ''}${hours}h ${remainingMinutes}m`;
}

export function toLocalDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
