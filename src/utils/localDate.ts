export const DEFAULT_OPERATION_TIME_ZONE = 'America/Mexico_City';

export function formatLocalISODate(
  date: Date,
  timeZone: string = DEFAULT_OPERATION_TIME_ZONE,
): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');

  if (!year || !month || !day) {
    return date.toISOString().slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

export function todayLocalISO(
  timeZone: string = DEFAULT_OPERATION_TIME_ZONE,
  now: Date = new Date(),
): string {
  return formatLocalISODate(now, timeZone);
}

/**
 * CDMX ended DST in 2022. Older Android timezone databases still apply
 * summer UTC-5, so current instants use a fixed UTC-6 offset.
 */
export function mexicoDisplayTimeZone(date: Date): string {
  return date.getTime() >= Date.parse('2022-10-30T07:00:00Z')
    ? 'Etc/GMT+6'
    : DEFAULT_OPERATION_TIME_ZONE;
}

export function formatMexicoClock(value: Date | number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: mexicoDisplayTimeZone(date),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === 'hour')?.value;
  const minute = parts.find((part) => part.type === 'minute')?.value;
  if (!hour || !minute) return '';
  return `${hour}:${minute}`;
}

export function formatMexicoDateTime(value: Date | number | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : '';
  return date.toLocaleString('es-MX', {
    timeZone: mexicoDisplayTimeZone(date),
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function mexicoDayOf(ms: number): string {
  return formatLocalISODate(new Date(ms), mexicoDisplayTimeZone(new Date(ms)));
}

/**
 * Odoo naive datetimes on collection snapshots are UTC (`2026-10-10 02:12:42`).
 * Show them in the fixed Mexico offset used by the rest of the field app.
 */
export function formatOdooUtcAsMexico(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const hasZone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed);
  const normalized = hasZone ? trimmed : `${trimmed.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return trimmed;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: mexicoDisplayTimeZone(date),
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((part) => part.type === type)?.value ?? ''
  );
  const day = read('day');
  const month = read('month');
  const year = read('year');
  const hour = read('hour');
  const minute = read('minute');
  if (!day || !month || !year || !hour || !minute) return trimmed;
  return `${day}/${month}/${year} ${hour}:${minute}`;
}
