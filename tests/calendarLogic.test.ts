/**
 * Tests for calendarLogic — date math del CalendarPicker de Preventa.
 * Mantiene el formato YYYY-MM-DD (= commitment_date).
 */
import assert from 'node:assert/strict';

interface Mod {
  isoFromYMD: (y: number, m0: number, d: number) => string;
  parseIso: (iso: string) => { year: number; month0: number; day: number } | null;
  yearMonthFromIso: (iso: string, fallback: { year: number; month0: number }) => { year: number; month0: number };
  daysInMonth: (y: number, m0: number) => number;
  firstWeekdayMondayBased: (y: number, m0: number) => number;
  buildMonthCells: (y: number, m0: number) => Array<{ day: number | null; iso: string | null }>;
  shiftMonth: (y: number, m0: number, delta: number) => { year: number; month0: number };
  monthTitle: (y: number, m0: number) => string;
  isoIsBefore: (a: string, b: string) => boolean;
  formatHumanDate: (iso: string) => string;
}

function run(m: Mod) {
  // isoFromYMD padding
  assert.equal(m.isoFromYMD(2026, 0, 5), '2026-01-05');
  assert.equal(m.isoFromYMD(2026, 11, 31), '2026-12-31');

  // parseIso valid / invalid
  assert.deepEqual(m.parseIso('2026-06-15'), { year: 2026, month0: 5, day: 15 });
  assert.equal(m.parseIso('2026-13-01'), null); // mes inexistente
  assert.equal(m.parseIso('2026-02-30'), null); // día inexistente
  assert.equal(m.parseIso('15/06/2026'), null); // formato malo

  // daysInMonth (incl. bisiesto)
  assert.equal(m.daysInMonth(2026, 1), 28); // feb 2026
  assert.equal(m.daysInMonth(2028, 1), 29); // feb 2028 bisiesto
  assert.equal(m.daysInMonth(2026, 3), 30); // abril

  // buildMonthCells: blanks + días correctos. Junio 2026: 1 de junio = lunes →
  // 0 blanks; 30 días.
  const cells = m.buildMonthCells(2026, 5);
  const realDays = cells.filter((c) => c.day != null);
  assert.equal(realDays.length, 30);
  assert.equal(realDays[0].iso, '2026-06-01');
  assert.equal(realDays[29].iso, '2026-06-30');
  // blanks = firstWeekdayMondayBased
  const blanks = cells.filter((c) => c.day == null).length;
  assert.equal(blanks, m.firstWeekdayMondayBased(2026, 5));

  // shiftMonth overflow
  assert.deepEqual(m.shiftMonth(2026, 11, 1), { year: 2027, month0: 0 });
  assert.deepEqual(m.shiftMonth(2026, 0, -1), { year: 2025, month0: 11 });
  assert.deepEqual(m.shiftMonth(2026, 5, 0), { year: 2026, month0: 5 });

  // monthTitle
  assert.equal(m.monthTitle(2026, 5), 'Junio 2026');

  // isoIsBefore (bloqueo de pasado)
  assert.equal(m.isoIsBefore('2026-06-10', '2026-06-11'), true);
  assert.equal(m.isoIsBefore('2026-06-11', '2026-06-11'), false);
  assert.equal(m.isoIsBefore('2026-06-12', '2026-06-11'), false);

  // yearMonthFromIso fallback
  assert.deepEqual(m.yearMonthFromIso('bad', { year: 2026, month0: 5 }), { year: 2026, month0: 5 });
  assert.deepEqual(m.yearMonthFromIso('2027-03-01', { year: 2026, month0: 5 }), { year: 2027, month0: 2 });

  // formatHumanDate
  assert.equal(m.formatHumanDate('2026-06-15'), '15 jun 2026');
  assert.equal(m.formatHumanDate('bad'), '');

  console.log('calendar logic tests: ok');
}

async function main() {
  const m = await import(
    // @ts-ignore
    new URL('../src/services/calendarLogic.ts', import.meta.url).pathname
  ) as Mod;
  run(m);
}
void main();
