import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const transport = readFileSync(resolve('src/services/invoiceCollection.ts'), 'utf8');
const sync = readFileSync(resolve('src/services/invoiceCollectionSync.ts'), 'utf8');
const collectionSurface = [
  'app/collect/[stopId].tsx',
  'src/services/invoiceCollection.ts',
  'src/services/invoiceCollectionPersistence.ts',
  'src/services/invoiceCollectionSync.ts',
  'src/services/invoiceCollectionVisit.ts',
].map((path) => readFileSync(resolve(path), 'utf8')).join('\n');

assert.match(transport, /payments\/open_invoices\?stop_id=\$\{stopId\}/, 'invoice list sends only stop_id');
assert.match(transport, /payments\/collect/, 'invoice collection uses the dedicated employee endpoint');
assert.match(
  transport,
  /const response = await postRest<unknown>\('\/gf\/logistics\/api\/employee\/payments\/collect', body\);\s*return parseInvoiceCollectionServerResult\(response, request\.operation_id\);/,
  'a 409 from postRest must propagate to the sync error classifier before any success parser runs',
);
assert.match(transport, /operation_id:\s*request\.operation_id[\s\S]*stop_id:\s*request\.stop_id[\s\S]*invoice_id:\s*request\.invoice_id[\s\S]*amount:\s*request\.amount[\s\S]*payment_method:\s*request\.payment_method/, 'collection body is an exact narrow DTO');
assert.doesNotMatch(transport, /partner_id|company_id|employee_id|journal_id|payment_method_line_id|sale_order_id|odooRpc|call_kw|execute_kw/i, 'collection transport cannot carry client accounting authority or generic RPC');
assert.doesNotMatch(sync, /['"]payment['"]\s*[),]/, 'invoice intents never enter the legacy payment sync queue');
assert.equal(existsSync(resolve('src/services/collectPaymentIntent.ts')), false, 'the obsolete manual collection controller is removed');
assert.doesNotMatch(collectionSurface, /\bpartnerId\b|\bjournalId\b|enqueue\(\s*['"]payment['"]|\bpaymentQueue\b|payments\/create/, 'the scoped collection surface has no manual accounting boundary or legacy generic payment queue');

console.log('invoice collection transport contract: ok');
