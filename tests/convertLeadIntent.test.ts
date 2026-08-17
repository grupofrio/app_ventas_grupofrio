import assert from 'node:assert/strict';

async function main() {
  const m = await import(
    new URL('../src/services/convertLeadIntent.ts', import.meta.url).pathname
  );

  let n = 0;
  const uuid = () => {
    n += 1;
    return `11111111-1111-4111-8111-11111111111${n}`;
  };

  const ctrl = m.createConvertLeadIntentController({ uuid });
  const first = ctrl.begin({ stopId: 10, leadId: 55 });
  assert.equal(first.status, 'ok');
  assert.equal(first.operationId, '11111111-1111-4111-8111-111111111111');

  const inflight = ctrl.begin({ stopId: 10, leadId: 55 });
  assert.equal(inflight.status, 'ignored_inflight');

  ctrl.markAmbiguous();
  assert.equal(ctrl.getPhase(), 'ambiguous');
  assert.equal(ctrl.getOperationId(), first.operationId);

  const retry = ctrl.begin({ stopId: 10, leadId: 55 });
  assert.equal(retry.status, 'ok');
  assert.equal(retry.operationId, first.operationId, 'retry must keep same UUID');

  ctrl.finalize('converted');
  assert.equal(ctrl.getOperationId(), null);
  assert.equal(ctrl.getPhase(), 'done');

  const next = ctrl.begin({ stopId: 10, leadId: 55 });
  assert.equal(next.status, 'ok');
  assert.notEqual(next.operationId, first.operationId, 'new intent after finalize');

  ctrl.finalize('review_required_duplicate');
  const other = ctrl.begin({ stopId: 99, leadId: 1 });
  assert.equal(other.status, 'ok');
  ctrl.markAmbiguous();
  const switched = ctrl.begin({ stopId: 100, leadId: 2 });
  assert.equal(switched.status, 'ok');
  assert.notEqual(switched.operationId, other.operationId);

  console.log('convert lead intent tests: ok');
}

void main();
