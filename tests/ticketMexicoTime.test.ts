import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTicketDate } from '../src/services/saleTicketFormatting.ts';

test('Odoo UTC datetimes without a zone render like explicit UTC independent of host TZ', () => {
  const original = process.env.TZ;
  try {
    for (const zone of ['UTC', 'America/Mexico_City', 'Asia/Tokyo']) {
      process.env.TZ = zone;
      for (const value of ['2026-09-09 19:22:00', '2026-09-09T19:22:00', '2026-09-09 19:22:00.123']) {
        assert.equal(formatTicketDate(value), '09/09/2026, 01:22 p.m.');
      }
    }
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

test('current CDMX tickets are correct with an Android timezone database still applying DST', () => {
  const original = Date.prototype.toLocaleString;
  Date.prototype.toLocaleString = function(this: Date, locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
    return original.call(this, locales, {
      ...options,
      timeZone: options?.timeZone === 'America/Mexico_City' ? 'Etc/GMT+5' : options?.timeZone,
    });
  };
  try {
    assert.equal(formatTicketDate('2026-09-09T19:22:00Z'), '09/09/2026, 01:22 p.m.');
    assert.equal(formatTicketDate('2026-09-10T02:22:00+07:00'), '09/09/2026, 01:22 p.m.');
    assert.equal(formatTicketDate('2026-09-10T02:05:00Z'), '09/09/2026, 08:05 p.m.');
  } finally { Date.prototype.toLocaleString = original; }
});

test('historical summer dates retain historical CDMX time and invalid values stay visible', () => {
  assert.equal(formatTicketDate('2021-07-21T16:30:00Z'), '21/07/2021, 11:30 a.m.');
  assert.equal(formatTicketDate('invalid'), 'invalid');
});
