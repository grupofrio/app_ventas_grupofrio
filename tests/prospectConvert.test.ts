import assert from 'node:assert/strict';

async function main() {
  const m = await import(
    new URL('../src/services/prospectConvert.ts', import.meta.url).pathname
  );

  const stop = {
    id: 10,
    customer_id: 0,
    customer_name: 'Tienda X',
    state: 'pending' as const,
    source_model: 'gf.route.stop' as const,
    _entityType: 'lead' as const,
    _leadId: 55,
    _partnerId: null,
  };

  const converted = m.applyLeadConvertToStop(stop, {
    status: 'converted',
    lead_id: 55,
    partner_id: 9001,
    partner_name: 'Tienda X SA',
  });
  assert.equal(converted._partnerId, 9001);
  assert.equal(converted.customer_id, 9001);
  assert.equal(converted.customer_name, 'Tienda X SA');

  const already = m.applyLeadConvertToStop(stop, {
    status: 'already_converted',
    lead_id: 55,
    partner_id: 9002,
    partner_name: 'Existente',
  });
  assert.equal(already._partnerId, 9002);

  const reviewErr = Object.assign(
    new Error('Encontramos un posible cliente existente. La conversión requiere revisión.'),
    {
      code: 'review_required_duplicate',
      data: {
        status: 'REVIEW_REQUIRED_DUPLICATE',
        candidates: [{ partner_id: 1, display_name: 'Cliente A' }],
      },
    },
  );
  assert.equal(m.isReviewRequiredDuplicateError(reviewErr), true);
  assert.match(m.reviewRequiredMessage(reviewErr), /Cliente A/);

  assert.equal(
    m.describeProspectionSyncLabel({
      status: 'pending',
      payload: { _source: 'nuevo_lead_ruta' },
    }),
    'Prospecto pendiente de sincronizar',
  );
  assert.equal(
    m.describeProspectionSyncLabel({
      status: 'done',
      payload: { _source: 'nuevo_lead_ruta' },
    }),
    'Prospecto registrado',
  );
  assert.equal(
    m.describeProspectionSyncLabel({ status: 'pending', payload: {} }),
    'Datos de prospecto pendientes',
  );

  console.log('prospect convert tests: ok');
}

void main();
