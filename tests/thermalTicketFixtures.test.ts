import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { buildLongSaleThermalTicketFixture } from '../src/services/thermalTicketFixtures.ts';
import { SALE_TICKET_BRANDING } from '../src/services/saleTicketBranding.ts';

test('long sale fixture injects canonical branding into sale-shaped JSON data', () => {
  const fixture = buildLongSaleThermalTicketFixture();

  assert.equal(fixture.schemaVersion, 1);
  assert.deepEqual(fixture.branding, {
    logoPngBase64: SALE_TICKET_BRANDING.logoPngBase64,
    logoVersion: SALE_TICKET_BRANDING.version,
    legalName: SALE_TICKET_BRANDING.legalName,
    rfcLabel: SALE_TICKET_BRANDING.rfcLabel,
    title: SALE_TICKET_BRANDING.title,
    footer: SALE_TICKET_BRANDING.footer,
  });
  assert.match(fixture.folio, /^VENTA-/);
  assert.ok(fixture.lines.length >= 30);
  assert.ok(fixture.lines.every((line) => (
    Number.isSafeInteger(line.productId)
      && line.productId > 0
      && line.productName.length > 0
      && line.quantityAndUnitPrice.includes('$')
      && line.lineTotal.startsWith('$')
  )));
  assert.match(fixture.creditNote ?? '', /Pagaré|Pagare/);
});

test('long sale JSON remains distinct from the diagnostic calibration document', () => {
  const source = readFileSync(
    new URL('../fixtures/mp210-long-sale-ticket.json', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /GS v 0|x=383|checker|DIAGNOSTICO/i);
  assert.doesNotMatch(source, /logoPngBase64|logoVersion|legalName|rfcLabel/);
});
