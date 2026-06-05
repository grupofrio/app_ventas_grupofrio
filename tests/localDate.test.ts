import assert from 'node:assert/strict';

interface LocalDateModule {
  formatLocalISODate: (date: Date, timeZone?: string) => string;
  todayLocalISO: (timeZone?: string, now?: Date) => string;
}

function testFormatsMexicoDateWhenUtcAlreadyNextDay(module: LocalDateModule) {
  const date = new Date('2026-05-31T02:30:00.000Z');
  assert.equal(module.formatLocalISODate(date, 'America/Mexico_City'), '2026-05-30');
}

function testTodayLocalISOAcceptsClockForDeterministicCalls(module: LocalDateModule) {
  const now = new Date('2026-06-01T04:15:00.000Z');
  assert.equal(module.todayLocalISO('America/Mexico_City', now), '2026-05-31');
}

async function main() {
  const module = await import(
    // @ts-ignore -- import.meta only used in test runtime.
    new URL('../src/utils/localDate.ts', import.meta.url).pathname
  ) as LocalDateModule;

  testFormatsMexicoDateWhenUtcAlreadyNextDay(module);
  testTodayLocalISOAcceptsClockForDeterministicCalls(module);

  console.log('local date tests: ok');
}

void main();
