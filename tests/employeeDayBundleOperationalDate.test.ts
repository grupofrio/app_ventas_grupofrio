import assert from 'node:assert/strict';
import test from 'node:test';

import { localOperationalDate } from '../src/services/employeeDayBundle.ts';

test('operational date stays on the Mexico day at 17:59, including UTC midnight', () => {
  assert.equal(localOperationalDate(new Date('2026-09-21T23:59:00Z')), '2026-09-21');
  assert.equal(localOperationalDate(new Date('2026-09-22T00:00:00Z')), '2026-09-21');
});

test('operational date rolls only at Mexico midnight, independently of device timezone', () => {
  assert.equal(localOperationalDate(new Date('2026-09-22T05:00:00Z')), '2026-09-21');
  assert.equal(localOperationalDate(new Date('2026-09-22T05:59:59Z')), '2026-09-21');
  assert.equal(localOperationalDate(new Date('2026-09-22T06:00:00Z')), '2026-09-22');
});

test('rehydration, check-in, and sale remain behind the day-bundle date and action gate', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const rehydrate = readFileSync(resolve('src/services/rehydrate.ts'), 'utf8');
  const checkin = readFileSync(resolve('app/checkin/[stopId].tsx'), 'utf8');
  const routeStart = readFileSync(resolve('app/route-start.tsx'), 'utf8');
  const sale = readFileSync(resolve('app/sale/[stopId].tsx'), 'utf8');

  assert.match(rehydrate, /useEmployeeDayBundleStore\.getState\(\)\.hydrate\(\)/);
  assert.match(checkin, /checkIn\(/);
  assert.match(routeStart, /canStartRoute/);
  assert.match(sale, /assertCurrentEmployeeDayBundleAllowsActions/);
});
