import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFieldLeadCreatePayload } from '../src/services/fieldLeadCreatePayload.ts';

test('field lead create payload derives operation_id without leaking the queue key', () => {
  const body = buildFieldLeadCreatePayload({
    _operationId: 'lead-operation-123',
    _source: 'nuevo_lead_ruta',
    customer_name: 'Centro de consumo',
  });

  assert.deepEqual(body, {
    _source: 'nuevo_lead_ruta',
    customer_name: 'Centro de consumo',
    operation_id: 'lead-operation-123',
  });
  assert.equal('_operationId' in body, false);
});

test('field lead create payload requires the stable queue operation id', () => {
  assert.throws(
    () => buildFieldLeadCreatePayload({ customer_name: 'Sin operación' }),
    /_operationId/i,
  );
});
