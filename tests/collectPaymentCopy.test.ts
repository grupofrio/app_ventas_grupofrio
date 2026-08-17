/**
 * Collect payment UX copy: enqueue ≠ registered.
 */
import assert from 'node:assert/strict';

interface Mod {
  describeCollectPaymentAlert: (i: {
    outcome:
      | { status: 'enqueued'; operationId: string }
      | { status: 'ignored_inflight' }
      | { status: 'ignored_done' };
    amountLabel: string;
  }) => { title: string; body: string } | null;
}

function run(m: Mod) {
  const enq = m.describeCollectPaymentAlert({
    outcome: { status: 'enqueued', operationId: 'abcdef12-3456-7890-abcd-ef1234567890' },
    amountLabel: '$100.00',
  });
  assert.ok(enq);
  assert.match(enq!.title, /pendiente/i);
  assert.match(enq!.body, /cola/i);
  assert.doesNotMatch(enq!.title, /registrado/i);
  assert.doesNotMatch(enq!.body, /como cash|como efectivo|transfer/i);
  assert.match(enq!.body, /abcdef12/);

  const inflight = m.describeCollectPaymentAlert({
    outcome: { status: 'ignored_inflight' },
    amountLabel: '$1',
  });
  assert.ok(inflight);
  assert.match(inflight!.title, /proceso/i);

  const done = m.describeCollectPaymentAlert({
    outcome: { status: 'ignored_done' },
    amountLabel: '$1',
  });
  assert.ok(done);
  assert.match(done!.title, /cola/i);

  console.log('collectPaymentCopy tests: ok');
}

async function main() {
  const m = (await import(
    // @ts-ignore
    new URL('../src/services/collectPaymentCopy.ts', import.meta.url).pathname
  )) as Mod;
  run(m);
}
void main();
