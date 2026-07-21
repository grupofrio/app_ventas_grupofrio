import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  buildSaleTicketHtml,
  buildSaleTicketSnapshot,
} from '../src/services/saleTicket.ts';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const BRANDING_PATH = resolve(REPO_ROOT, 'src/services/saleTicketBranding.ts');
const SALE_TICKET_PATH = resolve(REPO_ROOT, 'src/services/saleTicket.ts');

test('embedded ticket logo is current', () => {
  const result = spawnSync(process.execPath, ['scripts/embed-sale-ticket-logo.mjs', '--check'], {
    cwd: REPO_ROOT,
  });

  assert.equal(result.status, 0, result.stderr.toString());
});

test('sale ticket HTML consumes the canonical shared branding', async () => {
  assert.equal(existsSync(BRANDING_PATH), true, 'shared sale ticket branding module is missing');

  const { SALE_TICKET_BRANDING } = await import(pathToFileURL(BRANDING_PATH).href);
  const html = buildSaleTicketHtml(buildSaleTicketSnapshot({
    saleId: 'sale_branding',
    customerName: 'Cliente',
    sellerName: 'Vendedor',
    paymentMethod: 'cash',
    createdAt: '2026-05-28T18:30:00.000Z',
    lines: [],
  }));

  const expectedLogoSrc = `src="data:image/png;base64,${SALE_TICKET_BRANDING.logoPngBase64}"`;
  assert.ok(html.includes(expectedLogoSrc), 'ticket HTML must embed the exact shared branding logo');
  assert.ok(html.includes(SALE_TICKET_BRANDING.legalName));
  assert.ok(html.includes(SALE_TICKET_BRANDING.rfcLabel));
  assert.ok(html.includes(SALE_TICKET_BRANDING.title));
  assert.ok(html.includes(SALE_TICKET_BRANDING.footer));

  const saleTicketSource = readFileSync(SALE_TICKET_PATH, 'utf8');
  assert.match(saleTicketSource, /import\s+\{\s*SALE_TICKET_BRANDING\s*\}\s+from\s+['"]\.\/saleTicketBranding(?:\.ts)?['"]/);
  assert.ok(!saleTicketSource.includes(SALE_TICKET_BRANDING.legalName));
  assert.ok(!saleTicketSource.includes(SALE_TICKET_BRANDING.rfcLabel));
  assert.ok(!saleTicketSource.includes(SALE_TICKET_BRANDING.title));
  assert.ok(!saleTicketSource.includes(SALE_TICKET_BRANDING.footer));
});
