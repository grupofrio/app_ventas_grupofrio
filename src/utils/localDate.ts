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
