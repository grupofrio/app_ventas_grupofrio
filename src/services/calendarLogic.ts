/**
 * Pure calendar helpers for the in-app date picker (no deps, no RN).
 *
 * Used by src/components/ui/CalendarPicker.tsx. Keeping the date math here makes
 * it unit-testable and keeps the component thin. All dates are local
 * YYYY-MM-DD strings (same format as commitment_date / presaleLogic).
 *
 * month0 = 0-based month index (0 = enero … 11 = diciembre).
 */

export const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export const MONTHS_ES_SHORT = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

/** Weekday headers, Monday-first (matches MX usage). */
export const WEEKDAYS_ES = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

export interface YearMonth {
  year: number;
  month0: number;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function isoFromYMD(year: number, month0: number, day: number): string {
  return `${year}-${pad2(month0 + 1)}-${pad2(day)}`;
}

export function parseIso(iso: string): { year: number; month0: number; day: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return { year: y, month0: m - 1, day: d };
}

/** YearMonth from an ISO date, falling back to `fallback` when invalid. */
export function yearMonthFromIso(iso: string, fallback: YearMonth): YearMonth {
  const parsed = parseIso(iso);
  return parsed ? { year: parsed.year, month0: parsed.month0 } : fallback;
}

export function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

/** Index (0=Mon … 6=Sun) of the first day of the month — Monday-first grid. */
export function firstWeekdayMondayBased(year: number, month0: number): number {
  const jsDow = new Date(year, month0, 1).getDay(); // 0=Sun … 6=Sat
  return (jsDow + 6) % 7; // shift so Monday = 0
}

export interface CalendarCell {
  day: number | null; // null = leading blank
  iso: string | null;
}

/**
 * Build the grid cells for a month (Monday-first), with leading blanks so the
 * 1st falls under the right weekday. Returns just enough cells (no trailing
 * padding needed — the UI wraps with flexWrap).
 */
export function buildMonthCells(year: number, month0: number): CalendarCell[] {
  const blanks = firstWeekdayMondayBased(year, month0);
  const total = daysInMonth(year, month0);
  const cells: CalendarCell[] = [];
  for (let i = 0; i < blanks; i++) cells.push({ day: null, iso: null });
  for (let d = 1; d <= total; d++) cells.push({ day: d, iso: isoFromYMD(year, month0, d) });
  return cells;
}

/** Shift a YearMonth by delta months (can be negative), normalizing overflow. */
export function shiftMonth(year: number, month0: number, delta: number): YearMonth {
  const total = year * 12 + month0 + delta;
  return { year: Math.floor(total / 12), month0: ((total % 12) + 12) % 12 };
}

export function monthTitle(year: number, month0: number): string {
  return `${MONTHS_ES[month0] ?? '?'} ${year}`;
}

/** ISO strings are lexicographically sortable → safe string comparison. */
export function isoIsBefore(a: string, b: string): boolean {
  return a < b;
}

/** Human label for a chosen date, e.g. "15 jun 2026". '' for invalid. */
export function formatHumanDate(iso: string): string {
  const p = parseIso(iso);
  if (!p) return '';
  return `${p.day} ${MONTHS_ES_SHORT[p.month0]} ${p.year}`;
}
