import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const transport = readFileSync(resolve('src/services/invoiceCollection.ts'), 'utf8');
const sync = readFileSync(resolve('src/services/invoiceCollectionSync.ts'), 'utf8');
const legacy = readFileSync(resolve('src/services/collectPaymentIntent.ts'), 'utf8');
const connectivity = readFileSync(resolve('src/services/connectivity.ts'), 'utf8');

assert.match(transport, /payments\/open_invoices\?stop_id=\$\{stopId\}/, 'invoice list sends only stop_id');
assert.match(transport, /payments\/collect/, 'invoice collection uses the dedicated employee endpoint');
assert.match(transport, /operation_id:\s*request\.operation_id[\s\S]*stop_id:\s*request\.stop_id[\s\S]*invoice_id:\s*request\.invoice_id[\s\S]*amount:\s*request\.amount[\s\S]*payment_method:\s*request\.payment_method/, 'collection body is an exact narrow DTO');
assert.doesNotMatch(transport, /partner_id|company_id|employee_id|journal_id|payment_method_line_id|sale_order_id|odooRpc|call_kw|execute_kw/i, 'collection transport cannot carry client accounting authority or generic RPC');
assert.doesNotMatch(sync, /['"]payment['"]\s*[),]/, 'invoice intents never enter the legacy payment sync queue');
assert.doesNotMatch(legacy, /enqueue\(['"]payment['"]|partner_id|journal_id/, 'legacy generic payment enqueue is removed');
assert.match(connectivity, /requestInvoiceCollectionSync\(\)/, 'the existing connectivity wake also requests collection reconciliation');

console.log('invoice collection transport contract: ok');
